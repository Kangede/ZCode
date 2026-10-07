import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_ASPECT_RATIOS,
  imageGenerationInputSchema,
  imageGenerationSettingsSchema,
  validateImageSize,
} from "../src/image-generation.js";

test("old settings keep image generation disabled", () => {
  assert.equal(imageGenerationSettingsSchema.parse({}).enabled, false);
  assert.equal(imageGenerationSettingsSchema.parse({}).model, "Qwen-Image-2.1");
});

test("each ratio accepts its upper bound and rejects larger dimensions", () => {
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    assert.equal(validateImageSize(`${ratio.width}x${ratio.height}`), ratio.label);
    assert.throws(() => validateImageSize(`${ratio.width * 2}x${ratio.height * 2}`));
  }
  for (const size of ["0x0", "1025x1024", "1024x64", "NaNx1024", "1024", "-32x32"]) {
    assert.throws(() => validateImageSize(size), size);
  }
});

test("generation defaults and edit reference constraints", () => {
  const generated = imageGenerationInputSchema.parse({ prompt: "red teapot" });
  assert.equal(generated.operation, "generate");
  assert.equal(generated.size, "1024x1024");
  for (const count of [1, 3, 5]) {
    const references = Array.from({ length: count }, (_, i) => `ref-${i}`);
    assert.deepEqual(
      imageGenerationInputSchema.parse({ operation: "edit", prompt: "blue", references })
        .references,
      references,
    );
  }
  for (const count of [0, 6]) {
    assert.throws(() =>
      imageGenerationInputSchema.parse({
        operation: "edit",
        prompt: "blue",
        references: Array(count).fill("ref"),
      }),
    );
  }
  assert.throws(() => imageGenerationInputSchema.parse({ prompt: "test", references: ["ref"] }));
});

test("transparency, guidance, seed and quality remain valid together", () => {
  const invalid = [
    { background: "transparent", outputFormat: "jpeg" },
    { guidanceScale: 2 },
    { negativePrompt: "noise" },
    { outputCompression: 90 },
    { seed: -1 },
    { seed: 0x100000000 },
    { seed: 1.5 },
    { prompt: "" },
  ];
  for (const patch of invalid) {
    assert.throws(() => imageGenerationInputSchema.parse({ prompt: "test", ...patch }));
  }
  assert.equal(imageGenerationInputSchema.parse({ prompt: "test", seed: 0 }).seed, 0);
  assert.equal(
    imageGenerationInputSchema.parse({ prompt: "test", guidanceScale: 2, negativePrompt: "noise" })
      .guidanceScale,
    2,
  );
  assert.equal(
    imageGenerationInputSchema.parse({ prompt: "test", outputFormat: "jpeg", outputCompression: 0 })
      .outputCompression,
    0,
  );
});
