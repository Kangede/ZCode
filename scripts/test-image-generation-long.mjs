import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", "tests/image-generation/long-request.test.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, ZCODE_IMAGE_TEST_LONG: "1" },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", () => {
  process.exitCode = 1;
});
