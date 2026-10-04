import { runCommand } from "./spawn-command.mjs";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: { "skip-build": { type: "boolean" }, "base-url": { type: "string" } },
});
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = `${metadata.version}-qwen.1`;
const pnpm = "pnpm";
const env = {
  ...process.env,
  ZCODE_ENV: "production",
  ZCODE_PREVIEW_IDENTITY: "1",
  RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS ?? "2",
};
function run(command, args, cwd = root) {
  console.log(`[image-workbench] ${command} ${args.join(" ")}`);
  const result = runCommand(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build failed with ${result.status ?? result.signal}`);
}
// 构建、类型输出和资源收集不能并发：跨平台资产哈希需要稳定的同一份 dist。
if (!values["skip-build"]) {
  run(process.execPath, ["scripts/build-desktop-agent-cli.mjs"]);
  // shared 在开发态走源码入口，没有 build script；CLI 发行资源需要它的 JS 输出。
  run(pnpm, ["exec", "tsc", "-b", "packages/shared"]);
  run(pnpm, ["--filter", "@zcode/tui...", "--workspace-concurrency=1", "build"]);
  run(pnpm, ["--filter", "@zcode/server", "build"]);
  run(pnpm, ["--filter", "@zcode/web", "build"]);
  run(pnpm, ["prepare:build-meta"], join(root, "packages/desktop"));
  run(pnpm, ["exec", "tsup"], join(root, "packages/desktop"));
  run(pnpm, ["exec", "vite", "build"], join(root, "packages/desktop"));
}
run(process.execPath, [
  "scripts/build-zcode.mjs",
  "--skip-build",
  "--image-workbench",
  "--version",
  version,
  "--out-dir",
  "dist/image-cli",
  "--base-url",
  values["base-url"] ?? "https://example.invalid/zcode/",
]);
if (process.platform !== "linux" || process.arch !== "x64") {
  console.log(
    "CLI/Web archive built. Desktop release acceptance currently targets Linux x64; use the upstream platform builder on a target host.",
  );
} else {
  run(
    pnpm,
    [
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.config.js",
      "--linux",
      "AppImage",
      "--x64",
      "--publish",
      "never",
      `-c.electronDist=${join(root, "node_modules/electron/dist")}`,
      "-c.extraMetadata.zcodeImageWorkbench=true",
      "-c.directories.output=../../dist/image-desktop",
    ],
    join(root, "packages/desktop"),
  );
}
