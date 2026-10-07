import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    columns: { type: "string", default: "100" },
    rows: { type: "string", default: "32" },
    help: { type: "boolean" },
  },
});
if (values.help || !values.input || !values.output) {
  console.log(
    "Usage: node scripts/render-image-tui.mjs --input terminal.ansi --output terminal.png [--columns 100 --rows 32]",
  );
  process.exit(values.help ? 0 : 1);
}
const columns = Number(values.columns),
  rows = Number(values.rows);
if (![columns, rows].every((n) => Number.isInteger(n) && n > 0 && n < 500))
  throw new Error("Invalid terminal dimensions");
const root = resolve(import.meta.dirname, "..");
const browser = await chromium.launch({
  channel: process.env.ZCODE_IMAGE_TEST_BROWSER ?? "chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: columns * 10 + 20, height: rows * 20 + 20 },
  });
  await page.setContent(
    '<body style="margin:10px;background:#0f1419"><div id="terminal"></div></body>',
  );
  await page.addStyleTag({ path: join(root, "node_modules/@xterm/xterm/css/xterm.css") });
  await page.addScriptTag({ path: join(root, "node_modules/@xterm/xterm/lib/xterm.js") });
  // 截图来自真实 PTY 字节；不伪造终端文本。去掉退出时恢复备用屏幕的指令，保留最后一帧。
  const transcript = (await readFile(resolve(values.input), "utf8")).replaceAll("\x1b[?1049l", "");
  await page.evaluate(
    async ({ transcript, columns, rows }) => {
      const terminal = new globalThis.Terminal({
        cols: columns,
        rows,
        fontSize: 15,
        lineHeight: 1.2,
        theme: { background: "#0f1419", foreground: "#e6edf3" },
      });
      terminal.open(document.querySelector("#terminal"));
      await new Promise((resolveWrite) => terminal.write(transcript, resolveWrite));
    },
    { transcript, columns, rows },
  );
  await page.screenshot({ path: resolve(values.output) });
} finally {
  await browser.close();
}
