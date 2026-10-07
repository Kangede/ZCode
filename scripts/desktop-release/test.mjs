import { readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../spawn-command.mjs";
import { installedApplication } from "./installed.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const output = join(root, "dist/desktop-release");
const manifestPath = join(output, "artifacts", `manifest-${process.platform}-${process.arch}.json`);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const { executable, resources } = await installedApplication(output, manifest);
const require = createRequire(import.meta.url);
const { extractFile } = require("@electron/asar");
const metadata = JSON.parse(extractFile(join(resources, "app.asar"), "package.json").toString());
if (metadata.version !== manifest.version || metadata.zcodeImageWorkbench !== true)
  throw new Error("The installer is not the expected isolated Qwen edition");
const evidenceRoot = join(root, ".evidence/automated");
const before = new Set(
  await readdir(evidenceRoot).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  }),
);
const result = runCommand(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    "--test-name-pattern=^(desktop |actual Electron )",
    "tests/image-generation/capacity.e2e.ts",
    "tests/image-generation/desktop.e2e.ts",
  ],
  { cwd: root, env: { ...process.env, ZCODE_IMAGE_TEST_ELECTRON: executable }, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`Packaged desktop test failed: ${result.status ?? result.signal}`);
const directories = (await readdir(evidenceRoot)).filter(
  (name) => !before.has(name) && name.startsWith("desktop-"),
);
if (directories.length !== 2) throw new Error("Expected both native desktop acceptance scenarios");
for (const directory of directories) {
  const actual = JSON.parse(await readFile(join(evidenceRoot, directory, "electron.json"), "utf8"));
  if (
    !actual.packaged ||
    actual.version !== manifest.version ||
    actual.platform !== process.platform ||
    actual.arch !== process.arch
  )
    throw new Error(
      "The installed application's version, architecture or packaging state is wrong",
    );
}
manifest.acceptance = {
  passed: true,
  installedFrom:
    process.platform === "darwin" ? "dmg" : process.platform === "win32" ? "nsis" : "deb",
  scenarios: directories.length,
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
