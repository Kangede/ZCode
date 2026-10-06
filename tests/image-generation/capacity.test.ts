import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  IMAGE_ASPECT_RATIOS,
  getImageReferenceLimit,
  getImageReferenceCapacity,
  imageGenerationInputSchema,
  imageJobSchema,
} from "../../packages/shared/src/image-generation.js";
import { createQwenImageAdapter } from "../../apps/zcode-cli/packages/adapters/src/image-generation/qwen.js";
import { ImageTaskService } from "../../apps/zcode-cli/packages/bootstrap/src/app/image-generation-service.js";
import { exampleConnection, fixtureImage, jsonResponse } from "./fixtures.js";
import { input, harness } from "./service-harness.js";

test("measured successes stay allowed and both confirmed upstream OOM cases are rejected", async () => {
  const evidence = JSON.parse(
    await readFile(
      new URL("../../docs/features/image-generation-capacity-evidence.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(evidence.qualificationComplete, true);
  let successes = 0,
    oom = 0;
  for (const cell of evidence.cells) {
    const capacity = getImageReferenceCapacity({
      size: cell.size,
      references: Array(cell.count).fill("reference"),
    });
    if (cell.status === "succeeded") {
      successes++;
      assert.equal(capacity.exceeded, false, cell.name);
    } else if (cell.operatorConfirmedOOM) {
      oom++;
      assert.equal(capacity.exceeded, true, cell.name);
    }
  }
  assert.equal(successes, 34);
  assert.equal(oom, 2);
});

test("capacity follows total output pixels, including portrait and landscape boundaries", () => {
  for (const [size, expected] of [
    ["1024x1024", 5],
    ["1280x1280", 5],
    ["1536x1024", 5],
    ["1024x1536", 5],
    ["1312x1312", 5],
    ["1536x1536", 5],
    ["1568x1568", 3],
    ["1792x1792", 3],
    ["1824x1824", 2],
    ["2048x2048", 2],
  ] as const)
    assert.equal(getImageReferenceLimit(size), expected, size);
  for (const ratio of IMAGE_ASPECT_RATIOS)
    assert.equal(getImageReferenceLimit(`${ratio.width}x${ratio.height}`), 2);
  for (const size of ["", "2048x", "4096x4096", "NaNx1024", "1025x1024"])
    assert.equal(getImageReferenceLimit(size), undefined);
});

test("implicit parent counts once and the regional mask never counts as another reference", () => {
  const draft = input({ operation: "edit", size: "2048x2048", parentId: "parent" });
  assert.deepEqual(getImageReferenceCapacity(draft), { limit: 2, count: 1, exceeded: false });
  assert.equal(
    getImageReferenceCapacity({ ...draft, mask: "mask", references: ["parent"] }).count,
    1,
  );
  assert.equal(getImageReferenceCapacity({ ...draft, references: ["extra"] }).exceeded, false);
  assert.equal(
    getImageReferenceCapacity({ ...draft, references: ["extra", "other"] }).exceeded,
    true,
  );
  assert.equal(getImageReferenceCapacity(input({ size: "2048x2048" })).count, 0);
});

test("new over-capacity requests fail before admission, provider resolution or image reads", async (t) => {
  const h = await harness(t);
  h.options.connection = () => {
    throw new Error("Provider must not be resolved");
  };
  for (const origin of ["agent", "user"] as const) {
    const request = input({
      operation: "edit",
      size: "2048x2048",
      parentId: "parent",
      references: ["extra", "other"],
    });
    const pending =
      origin === "agent"
        ? h.service.execute(request, { commandId: origin })
        : h.service.request({
            action: "submit",
            sessionId: "session-one",
            commandId: origin,
            input: request,
          });
    await assert.rejects(
      pending,
      (error: any) =>
        error.code === "reference_capacity_exceeded" && /2048x2048/.test(error.message),
    );
  }
  assert.equal(h.calls(), 0);
  assert.deepEqual(
    (await h.service.request({ action: "list", sessionId: "session-one" })).jobs,
    [],
  );
});

test("adapter rejects excess references before any HTTP, even when bypassing the service", async () => {
  let calls = 0;
  const adapter = createQwenImageAdapter({
    async request() {
      calls++;
      throw new Error("Must not call HTTP");
    },
  });
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const size = `${ratio.width}x${ratio.height}`;
    const references = ["one", "two", "three"];
    await assert.rejects(
      adapter.generate({
        connection: exampleConnection,
        model: "Qwen-Image-2.1",
        timeoutMs: 1000,
        request: input({ operation: "edit", size, references }),
        references: references.map(() => ({
          bytes: new Uint8Array(),
          mimeType: "image/png",
          width: 512,
          height: 512,
          transparent: false,
        })),
      }),
      (error: any) => error.code === "reference_capacity_exceeded",
    );
  }
  assert.equal(calls, 0);
});

test("exactly the allowed boundary reaches the existing multipart request path", async () => {
  const reference = await fixtureImage();
  for (const size of [
    "1280x1280",
    "1536x1536",
    "1792x1792",
    ...IMAGE_ASPECT_RATIOS.map((ratio) => `${ratio.width}x${ratio.height}`),
  ]) {
    const count = getImageReferenceLimit(size)!;
    const stop = new Error("test stops after inspecting the POST");
    let posts = 0;
    const adapter = createQwenImageAdapter({
      async request(request) {
        if (request.url.endsWith("/models"))
          return jsonResponse({ data: [{ id: "Qwen-Image-2.1" }] });
        const form = await new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: Buffer.from(request.body!),
        }).formData();
        assert.equal(form.getAll("image[]").length, count);
        assert.equal(form.get("size"), size);
        posts++;
        throw stop;
      },
    });
    await assert.rejects(
      adapter.generate({
        connection: exampleConnection,
        model: "Qwen-Image-2.1",
        timeoutMs: 1000,
        request: input({
          operation: "edit",
          size,
          references: Array.from({ length: count }, (_, i) => `ref-${i}`),
        }),
        references: Array(count).fill(reference),
      }),
      (error) => error === stop,
    );
    assert.equal(posts, 1);
  }
});

test("stricter admission preserves old high-resolution history and command replay", async (t) => {
  const h = await harness(t);
  const raw = imageGenerationInputSchema.parse({
    operation: "edit",
    prompt: "old edit",
    size: "2048x2048",
    references: ["a", "b", "c", "d", "e"],
  });
  const commandId = "legacy";
  const job = imageJobSchema.parse({
    schemaVersion: 1,
    id: `image-${createHash("sha256").update(`session-one\0${commandId}`).digest("hex").slice(0, 32)}`,
    commandId,
    requestHash: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
    origin: "agent",
    status: "succeeded",
    input: raw,
    createdAt: 1,
    updatedAt: 2,
  });
  await h.journal.writeJob(job);
  const restored = new ImageTaskService(h.options);
  t.after(() => restored.close());
  await restored.initialize();
  assert.equal(
    (await restored.request({ action: "list", sessionId: "session-one" })).jobs![0]!.input
      .references.length,
    5,
  );
  assert.equal((await restored.execute(raw, { commandId })).id, job.id);
  assert.equal(h.calls(), 0, "replay cannot send a new POST");
  await assert.rejects(
    restored.execute(raw, { commandId: "new-command" }),
    (error: any) => error.code === "reference_capacity_exceeded",
  );
});
