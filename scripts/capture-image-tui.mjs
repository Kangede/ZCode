import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import pty from "node-pty";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    cli: { type: "string" },
    workspace: { type: "string" },
    session: { type: "string" },
    output: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help || !values.env || !values.cli || !values.workspace || !values.output) {
  console.log(
    "Usage: node scripts/capture-image-tui.mjs --env PRIVATE_ENV.json --cli zcode/bin/zcode.mjs --workspace DIRECTORY --output NEW_DIRECTORY [--session sess_...]",
  );
  process.exit(values.help ? 0 : 1);
}
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw new Error("Run in an interactive terminal to preserve genuine TUI input and display.");
const directory = resolve(values.output);
await mkdir(directory, { recursive: true });
const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
const supplied = JSON.parse(await readFile(resolve(values.env), "utf8"));
for (const [key, value] of Object.entries(supplied)) {
  if (!key.startsWith("ZCODE_") || typeof value !== "string")
    throw new Error("The private environment file must contain only string-valued ZCODE_ options.");
  env[key] = value;
}
const columns = process.stdout.columns || 100;
const rows = process.stdout.rows || 32;
const output = createWriteStream(join(directory, "terminal.ansi"), { flags: "wx", mode: 0o600 });
const args = [
  resolve(values.cli),
  "--cwd",
  resolve(values.workspace),
  ...(values.session ? ["--resume", values.session] : []),
];
const terminal = pty.spawn(process.execPath, args, {
  name: "xterm-256color",
  cols: columns,
  rows,
  cwd: resolve(values.workspace),
  env,
});
process.stdin.setRawMode(true);
process.stdin.resume();
const input = (data) => terminal.write(data.toString());
const resize = () =>
  terminal.resize(process.stdout.columns || columns, process.stdout.rows || rows);
process.stdin.on("data", input);
process.stdout.on("resize", resize);
terminal.onData((data) => {
  output.write(data);
  process.stdout.write(data);
});
terminal.onExit(async (event) => {
  process.stdin.off("data", input);
  process.stdout.off("resize", resize);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  await new Promise((resolveOutput) => output.end(resolveOutput));
  await writeFile(
    join(directory, "terminal.json"),
    JSON.stringify(
      {
        columns,
        rows,
        exitCode: event.exitCode,
        signal: event.signal,
        sessionId: values.session,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  process.exitCode = event.exitCode;
});
process.once("SIGTERM", () => terminal.kill());
