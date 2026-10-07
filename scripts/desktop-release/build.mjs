import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand, runCommandAndReadStdout } from "../spawn-command.mjs";
import { cleanDesktopProductionOutput } from "../../packages/desktop/scripts/run-production-build.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const desktop = join(root, "packages/desktop");
const release = JSON.parse(
  await readFile(join(root, "scripts/desktop-release/release.json"), "utf8"),
);
if (!/^\d+\.\d+\.\d+-qwen\.\d+$/.test(release.version))
  throw new Error("Invalid Qwen release version");
const platform = process.platform;
const arch = process.arch;
if (!["linux-x64", "win32-x64", "darwin-arm64", "darwin-x64"].includes(`${platform}-${arch}`))
  throw new Error(`Unsupported desktop release target: ${platform}-${arch}`);
const output = join(root, "dist/desktop-release");
const artifacts = join(output, "artifacts");
const env = {
  ...process.env,
  ZCODE_ENV: "production",
  ZCODE_PREVIEW_IDENTITY: "1",
  ZCODE_TARGET_OS: platform,
  ZCODE_TARGET_ARCH: arch,
  ZCODE_SKIP_REMOTE_ASSETS: "1",
  ZCODE_ENABLE_MAC_SIGN: "0",
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
  ZCODE_ELECTRON_RUNTIME_MIRROR: "https://github.com/electron/electron/releases/download/",
  PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
};
delete env.ELECTRON_MIRROR;
function run(command, args, cwd = root) {
  const result = runCommand(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}
const packagePath = join(root, "package.json");
const original = await readFile(packagePath, "utf8");
try {
  await writeFile(
    packagePath,
    JSON.stringify({ ...JSON.parse(original), version: release.version }, null, 2) + "\n",
  );
  await mkdir(artifacts, { recursive: true });
  // 顺序准备和构建，避免运行资产读取仍在变化的 tsc 输出。
  run("pnpm", ["--filter", "@zcode/desktop", "prepare:runtime-assets"]);
  await cleanDesktopProductionOutput({ cwd: desktop });
  run("pnpm", ["prepare:build-meta"], desktop);
  run("pnpm", ["exec", "tsup"], desktop);
  run("pnpm", ["exec", "vite", "build"], desktop);
  const target = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
  run(
    "pnpm",
    [
      "exec",
      "electron-builder",
      "--config",
      join(root, "scripts/desktop-release/electron-builder.config.mjs"),
      `--${target}`,
      `--${arch}`,
      "--publish",
      "never",
      `-c.directories.output=${output}`,
    ],
    desktop,
  );
  const extensions =
    platform === "linux"
      ? [".AppImage", ".deb"]
      : platform === "win32"
        ? [".exe"]
        : [".dmg", ".zip"];
  const files = (await readdir(output)).filter((name) =>
    extensions.some((extension) => name.endsWith(extension)),
  );
  if (files.length !== extensions.length)
    throw new Error(`Expected ${extensions.length} installers, found ${files.length}`);
  const manifest = {
    version: release.version,
    commit: runCommandAndReadStdout("git", ["rev-parse", "HEAD"], { cwd: root }).trim(),
    platform,
    arch,
    signing: platform === "darwin" ? "ad-hoc; not notarized" : "unsigned",
    files: [],
  };
  for (const name of files) {
    if (!name.startsWith(`ZCode-Qwen-${release.version}-`))
      throw new Error(`Unexpected installer: ${name}`);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(join(output, name))) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    manifest.files.push({ name, bytes, sha256: hash.digest("hex") });
    const { copyFile } = await import("node:fs/promises");
    await copyFile(join(output, name), join(artifacts, name));
  }
  await writeFile(
    join(artifacts, `manifest-${platform}-${arch}.json`),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const executable =
    platform === "darwin"
      ? join(
          output,
          arch === "arm64" ? "mac-arm64" : "mac",
          "ZCode Preview.app/Contents/MacOS/ZCode Preview",
        )
      : platform === "win32"
        ? join(output, "win-unpacked/ZCode Preview.exe")
        : join(output, "linux-unpacked/zcode-preview");
  const { access } = await import("node:fs/promises");
  await access(executable);
  await writeFile(join(output, "executable.json"), JSON.stringify({ executable }));
  console.log(`Desktop release prepared: ${platform}-${arch}`);
} finally {
  await writeFile(packagePath, original);
}
