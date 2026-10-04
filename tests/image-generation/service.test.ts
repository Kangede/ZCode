import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageTaskService } from "../../apps/zcode-cli/packages/bootstrap/src/app/image-generation-service.js";
import { exampleConnection, fixtureImage } from "./fixtures.js";
import { input, harness } from "./service-harness.js";

test("concurrent duplicate commands share one execution; conflicting replay is rejected", async (t) => {
  const h = await harness(t);
  const results = await Promise.all([
    h.service.execute(input(), { commandId: "one" }),
    h.service.execute(input(), { commandId: "one" }),
  ]);
  assert.equal(results[0]!.id, results[1]!.id);
  assert.equal(h.calls(), 1);
  assert.equal(h.saved.size, 1);
  await assert.rejects(
    h.service.execute(input({ prompt: "different" }), { commandId: "one" }),
    /different request/,
  );
});

test("edits retain their parent, original bytes and transparency with a fresh seed", async (t) => {
  const transparent = await fixtureImage(true);
  const received: any[] = [];
  const h = await harness(t, async (request: any) => {
    received.push(request);
    return transparent;
  });
  const first = await h.service.execute(input({ background: "transparent" }), { commandId: "one" });
  const second = await h.service.execute(
    input({ operation: "edit", prompt: "blue teapot", parentId: first.id }),
    { commandId: "two" },
  );
  assert.equal(second.input.parentId, first.id);
  assert.equal(second.input.background, "transparent");
  assert.notEqual(first.input.seed, second.input.seed);
  assert.deepEqual(received[1].references[0].bytes, transparent.bytes);
  assert.equal(
    (await h.service.request({ action: "list", sessionId: "session-one" })).jobs!.length,
    2,
  );
  assert.equal(h.saved.size, 2);
});

test("cancellation wins over a late adapter result", async (t) => {
  let finish!: (image: any) => void;
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const h = await harness(t, () => {
    start();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const submitted = await h.service.request({
    action: "submit",
    sessionId: "session-one",
    commandId: "slow",
    input: input(),
  });
  await started;
  await h.service.request({ action: "cancel", sessionId: "session-one", jobId: submitted.job!.id });
  finish(h.image);
  await h.service.close();
  const job = (await h.service.request({ action: "list", sessionId: "session-one" })).jobs![0]!;
  assert.equal(job.status, "cancelled");
  assert.equal(h.saved.size, 0);
});

test("journal reload marks unfinished work interrupted without POST replay", async (t) => {
  const h = await harness(t);
  const completed = await h.service.execute(input(), { commandId: "one" });
  await h.journal.writeJob({
    ...completed,
    id: "unfinished",
    commandId: "unfinished",
    status: "running",
    artifact: undefined,
  });
  const resumed = new ImageTaskService(h.options);
  await resumed.initialize();
  const reply = await resumed.request({ action: "list", sessionId: "session-one" });
  assert.equal(reply.jobs!.find((job) => job.id === "unfinished")!.status, "interrupted");
  assert.equal(reply.jobs!.find((job) => job.id === completed.id)!.status, "succeeded");
  assert.equal(h.calls(), 1);
  await resumed.close();
});

test("success metadata failure is reported as failed, never as a finished image", async (t) => {
  const h = await harness(t);
  const write = h.journal.writeJob.bind(h.journal);
  h.journal.writeJob = async (job) => {
    if (job.status === "succeeded") throw new Error("disk failure");
    await write(job);
  };
  await assert.rejects(h.service.execute(input(), { commandId: "one" }));
  const job = (await h.service.request({ action: "list", sessionId: "session-one" })).jobs![0]!;
  assert.equal(job.status, "failed");
  assert.equal(job.artifact, undefined);
});

test("cross-session access, changed bytes, workspace escape and export collisions", async (t) => {
  const h = await harness(t);
  const first = await h.service.execute(input(), { commandId: "one" });
  await assert.rejects(
    h.service.request({ action: "read", sessionId: "another", artifactId: first.id, offset: 0 }),
    /not found/,
  );
  await assert.rejects(
    h.service.request({
      action: "read",
      sessionId: "session-one",
      artifactId: "foreign",
      offset: 0,
    }),
    /not found/,
  );
  const a = await h.service.request({
    action: "export",
    sessionId: "session-one",
    artifactId: first.id,
  });
  const b = await h.service.request({
    action: "export",
    sessionId: "session-one",
    artifactId: first.id,
  });
  assert.notEqual(a.path, b.path);
  assert.deepEqual(await readFile(a.path!), h.image.bytes);
  const external = join(h.directory, "external.png");
  await writeFile(external, h.image.bytes);
  await symlink(external, join(h.workspace, "escape.png"));
  await assert.rejects(h.journal.readWorkspaceImage("escape.png"), /external images/);
  h.saved.set(first.artifact!.uri, new Uint8Array([1, 2]));
  await assert.rejects(
    h.service.request({
      action: "read",
      sessionId: "session-one",
      artifactId: first.id,
      offset: 0,
    }),
    /no longer match/,
  );
});

test("chunk uploads are ordered, repeatable, bounded and preserve original alpha", async (t) => {
  const h = await harness(t);
  const image = await fixtureImage(true);
  const midpoint = Math.floor(image.bytes.length / 2);
  const request = {
    action: "import" as const,
    sessionId: "session-one",
    uploadId: "reference-one",
    name: "transparent.png",
    offset: 0,
    data: Buffer.from(image.bytes.subarray(0, midpoint)).toString("base64"),
    final: false,
  };
  await h.service.request(request);
  await h.service.request(request);
  await assert.rejects(h.service.request({ ...request, offset: midpoint + 1 }), /offset/);
  const result = await h.service.request({
    ...request,
    offset: midpoint,
    data: Buffer.from(image.bytes.subarray(midpoint)).toString("base64"),
    final: true,
  });
  assert.equal(result.artifact?.transparent, true);
  assert.equal(result.artifact?.bytes, image.bytes.length);
  const repeated = await h.service.request({ ...request, final: true });
  assert.equal(repeated.artifact?.id, result.artifact?.id);
  const records = await readdir(join(h.directory, "journal", "sessions"));
  for (const file of await readdir(join(h.directory, "journal", "sessions", records[0]!))) {
    if (file.endsWith(".json"))
      assert.equal(
        (
          await readFile(join(h.directory, "journal", "sessions", records[0]!, file), "utf8")
        ).includes(exampleConnection.apiKey),
        false,
      );
  }
});

test("disabled feature rejects generation before provider and network access", async (t) => {
  const h = await harness(t);
  await h.service.request({
    action: "configure",
    sessionId: "session-one",
    settings: { enabled: false, model: "Qwen-Image-2.1", timeoutMs: 1200000 },
  });
  await assert.rejects(h.service.execute(input(), { commandId: "one" }), /Enable image generation/);
  assert.equal(h.calls(), 0);
});

test("incidental alpha in an auto-background image does not request background removal on edit", async (t) => {
  const image = await fixtureImage(true);
  const received: any[] = [];
  const h = await harness(t, async (request: any) => {
    received.push(request);
    return image;
  });
  const first = await h.service.execute(input({ background: "auto" }), {
    commandId: "opaque-intent",
  });
  const edited = await h.service.execute(
    input({ operation: "edit", parentId: first.id, prompt: "change color, keep background" }),
    { commandId: "edit-opaque-intent" },
  );
  assert.equal(first.artifact!.transparent, true);
  assert.equal(edited.input.background, "auto");
  assert.equal(received[1].request.background, "auto");
});

test("missing optional image skill disables submission but preserves history access", async (t) => {
  const h = await harness(t);
  const first = await h.service.execute(input(), { commandId: "one" });
  const withoutAsset = new ImageTaskService({ ...h.options, available: false });
  await withoutAsset.initialize();
  assert.equal(withoutAsset.isEnabled(), false);
  assert.equal(
    (await withoutAsset.request({ action: "list", sessionId: "session-one" })).jobs![0]!.id,
    first.id,
  );
  await assert.rejects(withoutAsset.execute(input(), { commandId: "two" }), /skill is missing/);
  assert.equal(h.calls(), 1);
  await withoutAsset.close();
});

test("large PNG metadata survives chunk import while previews are separately derived", async (t) => {
  const { crc32 } = await import("node:zlib");
  const h = await harness(t);
  const png = Buffer.from(h.image.bytes);
  const payload = Buffer.concat([Buffer.from("Comment\0"), Buffer.alloc(12 * 1024 * 1024, 97)]);
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write("tEXt", 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const original = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
  const step = 512 * 1024;
  let artifact: any;
  for (let offset = 0; offset < original.length; offset += step) {
    artifact =
      (
        await h.service.request({
          action: "import",
          sessionId: "session-one",
          uploadId: "large-reference",
          name: "large.png",
          offset,
          data: original.subarray(offset, offset + step).toString("base64"),
          final: offset + step >= original.length,
        })
      ).artifact ?? artifact;
  }
  assert.equal(artifact.bytes, original.length);
  assert.equal(Buffer.from(h.saved.get(artifact.uri)!).equals(original), true);
  const preview = await h.service.request({
    action: "read",
    sessionId: "session-one",
    artifactId: artifact.id,
    offset: 0,
    preview: "reference",
  });
  assert.ok(preview.totalBytes! < original.length);
  const { Jimp } = await import("jimp");
  assert.equal((await Jimp.read(Buffer.from(preview.data!, "base64"))).bitmap.width, 128);
  assert.equal(
    Buffer.from(h.saved.get(artifact.uri)!).equals(original),
    true,
    "preview must not replace the original",
  );
  assert.equal(h.calls(), 0);
  await assert.rejects(
    h.journal.uploadChunk("oversized", 50 * 1024 * 1024, Uint8Array.of(1), false),
    /50 MiB/,
  );
});

test("each accepted request captures its provider and carries the session trace", async (t) => {
  const received: any[] = [];
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const image = await fixtureImage();
  const h = await harness(t, async (request: any) => {
    received.push(request);
    if (received.length === 1) {
      started();
      await gate;
    }
    return image;
  });
  let providerId = "first-provider";
  h.options.connection = () => ({ ...exampleConnection, providerId });
  Object.assign(h.options, { trace: { traceId: "fixture-trace", spanId: "fixture-span" } });
  const first = h.service.execute(input(), { commandId: "first" });
  await entered;
  providerId = "second-provider";
  const second = h.service.execute(input(), { commandId: "second" });
  release();
  await Promise.all([first, second]);
  assert.deepEqual(
    received.map((request) => request.connection.providerId),
    ["first-provider", "second-provider"],
  );
  assert.equal(received[0].trace.traceId, "fixture-trace");
});

test("a short session request budget aborts the adapter without a retry", async (t) => {
  const h = await harness(
    t,
    (request: any) =>
      new Promise((_resolve, reject) =>
        request.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      ),
  );
  await h.service.request({
    action: "configure",
    sessionId: "session-one",
    settings: { enabled: true, model: "Qwen-Image-2.1", timeoutMs: 1000 },
  });
  await assert.rejects(h.service.execute(input(), { commandId: "deadline" }));
  const job = (await h.service.request({ action: "list", sessionId: "session-one" })).jobs![0]!;
  assert.equal(job.error?.code, "timeout");
  assert.equal(h.calls(), 1);
  assert.equal(job.artifact, undefined);
});
