import assert from "node:assert/strict";
import test from "node:test";
import { imageGenerationDisplaySchema as cliDisplay } from "../../apps/zcode-cli/packages/contracts/src/tools/image-generation-display.js";
import { imageGenerationDisplaySchema as sharedDisplay } from "../../packages/shared/src/image-generation.js";
import { withoutImageGenerationDisplay } from "../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/image-generation-legacy.js";

test("Zod 3 producer and Zod 4 client accept the same image display", () => {
  const display = {
    kind: "image_generation",
    schemaVersion: 1,
    jobId: "image-one",
    artifact: {
      id: "image-one",
      name: "image",
      uri: "artifact://one",
      mimeType: "image/png",
      width: 512,
      height: 512,
      bytes: 200,
      sha256: "a".repeat(64),
      transparent: true,
      seed: 42,
    },
  };
  assert.deepEqual(cliDisplay.parse(display), sharedDisplay.parse(display));
  for (const malformed of [
    { ...display, schemaVersion: 2 },
    { ...display, extra: "unexpected" },
    { ...display, artifact: { ...display.artifact, sha256: "bad" } },
  ]) {
    assert.equal(cliDisplay.safeParse(malformed).success, false);
    assert.equal(sharedDisplay.safeParse(malformed).success, false);
  }
});

test("legacy projection strips only image display in snapshots and deltas", () => {
  const image = { kind: "image_generation", schemaVersion: 1, jobId: "one" };
  const value = {
    rows: {
      window: [
        {
          toolName: "GenerateImage",
          output: { text: "Saved /example/image.png", display: image },
          display: image,
        },
        { display: { kind: "file_diff", filePath: "a.ts" } },
      ],
    },
  };
  const result = withoutImageGenerationDisplay(value);
  assert.equal("display" in result.rows.window[0]!, false);
  assert.equal(result.rows.window[0]!.output!.text, "Saved /example/image.png");
  assert.equal("display" in result.rows.window[0]!.output!, false);
  assert.equal(result.rows.window[1]!.display!.kind, "file_diff");
  assert.ok(value.rows.window[0]!.display, "must not mutate current client state");
});

test("legacy image projection leaves unrelated object payloads and identity unchanged", () => {
  const payload = {
    output: { raw: { date: new Date("2026-01-01T00:00:00Z"), bytes: new Uint8Array([1, 2]) } },
  };
  assert.equal(withoutImageGenerationDisplay(payload), payload);
  assert.equal(JSON.stringify(withoutImageGenerationDisplay(payload)), JSON.stringify(payload));
});
