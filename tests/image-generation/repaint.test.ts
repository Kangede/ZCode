import assert from "node:assert/strict";
import test from "node:test";
import { Jimp } from "jimp";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageGenerationInputSchema } from "../../packages/shared/src/image-generation.js";
import { createQwenImageAdapter } from "../../apps/zcode-cli/packages/adapters/src/image-generation/qwen.js";
import { inspectImage } from "../../apps/zcode-cli/packages/adapters/src/image-generation/binary.js";
import { exampleConnection, fixtureImage, jsonResponse } from "./fixtures.js";
import { harness, input } from "./service-harness.js";

test("mask contract rejects generation, JPEG and a displaced parent target", () => {
  for (const patch of [{ operation: "generate" }, { outputFormat: "jpeg" }, { parentId: "other" }])
    assert.throws(() =>
      imageGenerationInputSchema.parse({
        operation: "edit",
        prompt: "blue",
        references: ["target"],
        mask: "mask",
        ...patch,
      }),
    );
});

test("repaint guides Picture 1 and preserves every exterior RGBA pixel with soft edges", async () => {
  const original = new Jimp({ width: 512, height: 512, color: 0xdd442280 });
  const generated = new Jimp({ width: 512, height: 512, color: 0x2255ddff });
  const selection = new Jimp({ width: 512, height: 512, color: 0xffffffff });
  selection.setPixelColor(0xffffff00, 200, 200);
  selection.setPixelColor(0xffffff80, 201, 200);
  const source = await inspectImage(await original.getBuffer("image/png"));
  const mask = await inspectImage(await selection.getBuffer("image/png"));
  let posts = 0;
  const adapter = createQwenImageAdapter({
    async request(request) {
      if (request.url.endsWith("/models"))
        return jsonResponse({ data: [{ id: "Qwen-Image-2.1" }] });
      posts++;
      const form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: Buffer.from(request.body!),
      }).formData();
      assert.equal(form.has("mask"), false, "current proxy rejects a native mask part");
      const files = form.getAll("image[]") as File[];
      assert.equal(files.length, 2);
      assert.notDeepEqual(Buffer.from(await files[0]!.arrayBuffer()), source.bytes);
      assert.deepEqual(Buffer.from(await files[1]!.arrayBuffer()), source.bytes);
      assert.match(String(form.get("prompt")), /highlighted/);
      return jsonResponse({
        data: [{ b64_json: (await generated.getBuffer("image/png")).toString("base64") }],
      });
    },
  });
  const result = await adapter.generate({
    connection: exampleConnection,
    model: "Qwen-Image-2.1",
    timeoutMs: 1000,
    request: input({ operation: "edit", references: ["target", "second"], mask: "selection" }),
    references: [source, source],
    mask,
  });
  const decoded = await Jimp.read(Buffer.from(result.bytes));
  for (let i = 0; i < original.bitmap.data.length; i += 4) {
    if (i === (200 * 512 + 200) * 4 || i === (200 * 512 + 201) * 4) continue;
    assert.deepEqual(
      decoded.bitmap.data.subarray(i, i + 4),
      original.bitmap.data.subarray(i, i + 4),
    );
  }
  assert.equal(decoded.getPixelColor(200, 200), generated.getPixelColor(200, 200));
  const edge = (200 * 512 + 201) * 4;
  assert.ok(decoded.bitmap.data[edge + 3]! > 128 && decoded.bitmap.data[edge + 3]! < 255);
  assert.equal(posts, 1);
});

test("invalid masks fail before any HTTP request", async () => {
  const source = await fixtureImage();
  const opaque = new Jimp({ width: 512, height: 512, color: 0xffffffff });
  const wrongSize = new Jimp({ width: 32, height: 32, color: 0xffffff00 });
  let calls = 0;
  const adapter = createQwenImageAdapter({
    async request() {
      calls++;
      throw new Error("must not call");
    },
  });
  for (const bytes of [
    await opaque.getBuffer("image/png"),
    await wrongSize.getBuffer("image/png"),
    await opaque.getBuffer("image/jpeg"),
  ]) {
    await assert.rejects(
      adapter.generate({
        connection: exampleConnection,
        model: "Qwen-Image-2.1",
        timeoutMs: 1000,
        request: input({ operation: "edit", references: ["target"], mask: "mask" }),
        references: [source],
        mask: await inspectImage(bytes),
      }),
    );
  }
  assert.equal(calls, 0);
});

test("session masks retain identity and original bytes through journal reload", async (t) => {
  let received: any;
  const h = await harness(t, async (request: any) => {
    received = request;
    return h.image;
  });
  const first = await h.service.execute(input(), { commandId: "first" });
  const mask = await fixtureImage(true);
  const imported = await h.service.request({
    action: "import",
    sessionId: "session-one",
    uploadId: "mask",
    name: "mask.png",
    offset: 0,
    data: Buffer.from(mask.bytes).toString("base64"),
    final: true,
  });
  const edited = await h.service.execute(
    input({ operation: "edit", parentId: first.id, mask: imported.artifact!.id }),
    { commandId: "edit" },
  );
  assert.equal(edited.input.mask, imported.artifact!.id);
  assert.deepEqual(Buffer.from(received.mask.bytes), Buffer.from(mask.bytes));
  assert.deepEqual(received.references[0].bytes, h.image.bytes);
  assert.equal(
    (await h.journal.load()).jobs.find((job) => job.id === edited.id)!.input.mask,
    imported.artifact!.id,
  );
});

test("panel mask references are session IDs even when a workspace file exists", async (t) => {
  const h = await harness(t);
  const first = await h.service.execute(input(), { commandId: "source" });
  await writeFile(join(h.workspace, "mask.png"), (await fixtureImage(true)).bytes);
  const request = input({ operation: "edit", references: [first.id], mask: "mask.png" });
  await h.service.request({
    action: "submit",
    sessionId: "session-one",
    commandId: "panel",
    input: request,
  });
  await assert.rejects(
    h.service.execute(request, { commandId: "panel" }),
    /not found in this session/,
  );
  assert.equal(h.calls(), 1, "the invalid mask must not reach the adapter");
});
