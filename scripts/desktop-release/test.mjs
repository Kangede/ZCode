import { readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../spawn-command.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const { executable } = JSON.parse(
  await readFile(join(root, "dist/desktop-release/executable.json"), "utf8"),
);
await access(executable);
const result = runCommand(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    "--test-name-pattern=^(desktop |Electron )",
    "tests/image-generation/capacity.e2e.ts",
    "tests/image-generation/desktop.e2e.ts",
  ],
  { cwd: root, env: { ...process.env, ZCODE_IMAGE_TEST_ELECTRON: executable }, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`Packaged desktop test failed: ${result.status ?? result.signal}`);
