import { spawn } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const cases = [
  [
    "--import",
    "tsx",
    "--test",
    "packages/shared/test/image-generation.test.ts",
    "tests/image-generation/adapter.test.ts",
    "tests/image-generation/service.test.ts",
    "tests/image-generation/compatibility.test.ts",
    "tests/image-generation/resources.test.ts",
    "tests/image-generation/provider-secrets.test.ts",
    "tests/image-generation/provider.test.ts",
    "tests/image-generation/repaint.test.ts",
  ],
  ["scripts/test-image-generation-long.mjs"],
  ["--import", "tsx", "--test", "tests/image-generation/web.e2e.ts"],
  ["--import", "tsx", "--test", "tests/image-generation/desktop.e2e.ts"],
  ["--import", "tsx", "--test", "tests/image-generation/cli.e2e.ts"],
];
if (process.env.ZCODE_IMAGE_TEST_BASELINE)
  cases.push(["--import", "tsx", "--test", "tests/image-generation/mixed-versions.e2e.ts"]);
for (const args of cases) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0 ? resolveRun() : reject(new Error(`Image acceptance failed: ${code ?? signal}`)),
    );
  });
}
