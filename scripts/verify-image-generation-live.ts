import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { Jimp } from "jimp";
import {
  createQwenImageAdapter,
  inspectImage,
} from "../apps/zcode-cli/packages/adapters/src/image-generation/index.js";
import { NodeHttpClientAdapter } from "../apps/zcode-cli/packages/adapters/src/http/index.js";
import { imageGenerationInputSchema } from "../packages/shared/src/image-generation.js";

const { values } = parseArgs({
  options: {
    connection: { type: "string" },
    output: { type: "string" },
    reference: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
  },
});
if (!values.connection || !values.output || values.reference?.length !== 5) {
  throw new Error(
    "Usage: node --import tsx scripts/verify-image-generation-live.ts --connection PRIVATE.json --output DIRECTORY --reference IMAGE (exactly five times)",
  );
}
const connection = JSON.parse(await readFile(resolve(values.connection), "utf8"));
const directory = resolve(values.output);
await mkdir(directory, { recursive: true });
const reportFile = join(directory, "report.json");
let report: any[];
try {
  report = JSON.parse(await readFile(reportFile, "utf8"));
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
  report = [];
}
if (report.some((item) => item.status !== "succeeded"))
  throw new Error(
    "Previous request has an uncertain or failed result. Inspect it before starting a separate run; no automatic replay.",
  );
const references = await Promise.all(
  values.reference.map(async (file) => inspectImage(await readFile(resolve(file)))),
);
const adapter = createQwenImageAdapter(
  new NodeHttpClientAdapter({ env: process.env, noProxy: "*", requestDeadlineOnly: true }),
);
const matrix = [512, 1024].flatMap((size) =>
  [1, 3, 5].map((count) => ({
    name: `${size}-${count}-references`,
    size: `${size}x${size}`,
    count,
    format: "png",
  })),
);
matrix.push(
  { name: "landscape-jpeg", size: "768x512", count: 1, format: "jpeg" },
  { name: "portrait-png", size: "512x768", count: 1, format: "png" },
);
for (const scenario of matrix) {
  if (values.case?.length && !values.case.includes(scenario.name)) continue;
  if (report.some((item) => item.name === scenario.name)) continue;
  const seed = randomBytes(4).readUInt32LE();
  const selected = references.slice(0, scenario.count);
  const request = imageGenerationInputSchema.parse({
    operation: "edit",
    prompt:
      "Picture 1 is the edit target. Change only its ceramic teapot to cobalt blue. Preserve the table, window, complete photographic background and lighting. Other pictures, if present, are only color and material references; do not add their objects. No words or labels.",
    references: selected.map((_, index) => `Picture ${index + 1}`),
    size: scenario.size,
    seed,
    outputFormat: scenario.format,
    background: "auto",
    ...(scenario.format === "jpeg" ? { outputCompression: 90 } : {}),
  });
  const record: any = {
    ...scenario,
    seed,
    status: "running",
    startedAt: new Date().toISOString(),
    referenceHashes: selected.map((image) =>
      createHash("sha256").update(image.bytes).digest("hex"),
    ),
    request,
  };
  report.push(record);
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  const started = Date.now();
  try {
    const result = await adapter.generate({
      request,
      connection,
      model: connection.model ?? "Qwen-Image-2.1",
      timeoutMs: 1_200_000,
      references: selected,
    });
    const filename = `${scenario.name}.${scenario.format === "jpeg" ? "jpg" : "png"}`;
    await writeFile(join(directory, filename), result.bytes, { flag: "wx" });
    const decoded = await Jimp.read(result.bytes);
    let min = 255,
      max = 0,
      transparent = 0;
    for (let offset = 3; offset < decoded.bitmap.data.length; offset += 4) {
      const alpha = decoded.bitmap.data[offset]!;
      min = Math.min(min, alpha);
      max = Math.max(max, alpha);
      if (alpha < 255) transparent++;
    }
    Object.assign(record, {
      status: "succeeded",
      durationMs: Date.now() - started,
      filename,
      width: result.width,
      height: result.height,
      mimeType: result.mimeType,
      encoding: result.encoding,
      bytes: result.bytes.length,
      sha256: createHash("sha256").update(result.bytes).digest("hex"),
      alpha: { min, max, transparentPixels: transparent },
      visualReview: "pending",
    });
    console.log(
      `${scenario.name}: saved ${result.width}x${result.height}, ${record.durationMs} ms`,
    );
  } catch (error: any) {
    Object.assign(record, {
      status: "failed",
      code: error.code ?? "request_failed",
      durationMs: Date.now() - started,
    });
    throw new Error(`${scenario.name} failed (${record.code}); request not retried`);
  } finally {
    await writeFile(reportFile, JSON.stringify(report, null, 2));
  }
}
