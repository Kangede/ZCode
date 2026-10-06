import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
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
    reference: { type: "string" },
    mask: { type: "string" },
    prompt: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.connection || !values.reference || !values.mask || !values.prompt || !values.output)
  throw new Error(
    "Usage: --connection PRIVATE.json --reference IMAGE --mask MASK.png --prompt TEXT --output NEW_DIRECTORY",
  );
const directory = resolve(values.output);
await mkdir(directory); // Exclusive run directory: do not silently retry an uncertain image POST.
const connection = JSON.parse(await readFile(resolve(values.connection), "utf8"));
const target = await inspectImage(await readFile(resolve(values.reference)));
const mask = await inspectImage(await readFile(resolve(values.mask)));
const adapter = createQwenImageAdapter(
  new NodeHttpClientAdapter({ env: process.env, noProxy: "*", requestDeadlineOnly: true }),
);
const result = await adapter.generate({
  connection,
  model: connection.model ?? "Qwen-Image-2.1",
  timeoutMs: 1_200_000,
  request: imageGenerationInputSchema.parse({
    operation: "edit",
    prompt: values.prompt,
    references: ["target"],
    mask: "mask",
    size: `${target.width}x${target.height}`,
    outputFormat: "png",
  }),
  references: [target],
  mask,
});
await writeFile(join(directory, "repaint.png"), result.bytes);
const source = await Jimp.read(Buffer.from(target.bytes));
const selection = await Jimp.read(Buffer.from(mask.bytes));
const edited = await Jimp.read(Buffer.from(result.bytes));
let preserved = 0,
  changed = 0,
  selected = 0;
for (let i = 0; i < source.bitmap.data.length; i += 4) {
  const before = source.bitmap.data.subarray(i, i + 4),
    after = edited.bitmap.data.subarray(i, i + 4);
  if (selection.bitmap.data[i + 3] === 255) {
    assert.deepEqual(after, before, `Exterior pixel ${i / 4} changed`);
    preserved++;
  } else {
    selected++;
    if (!before.equals(after)) changed++;
  }
}
assert.ok(selected > 0 && changed > 0, "Selected area must change");
const report = {
  width: result.width,
  height: result.height,
  mimeType: result.mimeType,
  preservedPixels: preserved,
  selectedPixels: selected,
  changedSelectedPixels: changed,
  visualReview: "pending",
};
await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
