import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  createQwenImageAdapter,
  normalizeImagesBaseUrl,
} from "../../apps/zcode-cli/packages/adapters/src/image-generation/qwen.js";
import { NodeHttpClientAdapter } from "../../apps/zcode-cli/packages/adapters/src/http/index.js";
import { imageGenerationInputSchema } from "../../packages/shared/src/image-generation.js";
import { exampleConnection, fixtureImage, jsonResponse } from "./fixtures.js";

test("provider paths are normalized without changing their origin", () => {
  assert.equal(normalizeImagesBaseUrl("http://localhost:8090"), "http://localhost:8090/v1");
  assert.equal(
    normalizeImagesBaseUrl("https://proxy.example/api/v1/"),
    "https://proxy.example/api/v1",
  );
  for (const url of [
    "file:///tmp/image",
    "https://user:secret@example.test",
    "https://example.test/?key=x",
  ])
    assert.throws(() => normalizeImagesBaseUrl(url));
});

test("JSON generation locks quality fields, keeps keys out of payload and retains binary bytes", async () => {
  const image = await fixtureImage();
  const requests: any[] = [];
  const adapter = createQwenImageAdapter({
    async request(request) {
      requests.push(request);
      return request.url.endsWith("/models")
        ? jsonResponse({ data: [{ id: "Qwen-Image-2.1" }] })
        : jsonResponse({ data: [{ b64_json: Buffer.from(image.bytes).toString("base64") }] });
    },
  });
  const result = await adapter.generate({
    connection: exampleConnection,
    request: imageGenerationInputSchema.parse({ prompt: "teapot", size: "512x512" }),
    model: "Qwen-Image-2.1",
    timeoutMs: 1200000,
    references: [],
  });
  assert.equal(requests.length, 2);
  const payload = JSON.parse(Buffer.from(requests[1].body).toString());
  assert.deepEqual(
    [
      payload.n,
      payload.num_inference_steps,
      payload.response_format,
      payload.generator_device,
      payload.enable_cache_dit,
    ],
    [1, 40, "b64_json", "cpu", false],
  );
  assert.equal(requests[1].timeoutMs, 1200000);
  assert.equal(requests[1].redirect, "manual");
  assert.equal(JSON.stringify(payload).includes(exampleConnection.apiKey), false);
  assert.deepEqual(result.bytes, image.bytes);
});

test("multipart sends original PNG bytes in reference order", async () => {
  const first = await fixtureImage();
  const second = await fixtureImage(true);
  let form: FormData | undefined;
  const adapter = createQwenImageAdapter({
    async request(request) {
      if (request.url.endsWith("/models"))
        return jsonResponse({ data: [{ id: "Qwen-Image-2.1" }] });
      form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: Buffer.from(request.body!),
      }).formData();
      return jsonResponse({ data: [{ b64_json: Buffer.from(second.bytes).toString("base64") }] });
    },
  });
  await adapter.generate({
    connection: exampleConnection,
    request: imageGenerationInputSchema.parse({
      operation: "edit",
      prompt: "preserve transparency",
      size: "512x512",
      references: ["first", "second"],
      background: "transparent",
    }),
    model: "Qwen-Image-2.1",
    timeoutMs: 1200000,
    references: [first, second],
  });
  const files = form!.getAll("image[]") as File[];
  assert.equal(files.length, 2);
  assert.deepEqual(Buffer.from(await files[0]!.arrayBuffer()), first.bytes);
  assert.deepEqual(Buffer.from(await files[1]!.arrayBuffer()), second.bytes);
  assert.match(String(form!.get("prompt")), /RGBA/);
  assert.equal(form!.get("num_inference_steps"), "40");
});

test("HTTP failures are classified without leaking provider bodies or retrying POST", async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    let posts = 0;
    const adapter = createQwenImageAdapter({
      async request(request) {
        if (request.url.endsWith("/models"))
          return jsonResponse({ data: [{ id: "Qwen-Image-2.1" }] });
        posts++;
        return jsonResponse({ error: exampleConnection.apiKey }, status);
      },
    });
    await assert.rejects(
      adapter.generate({
        connection: exampleConnection,
        request: imageGenerationInputSchema.parse({ prompt: "test" }),
        model: "Qwen-Image-2.1",
        timeoutMs: 1000,
        references: [],
      }),
      (error: any) => error.status === status && !error.message.includes(exampleConnection.apiKey),
    );
    assert.equal(posts, 1);
  }
});

test("model discovery does not substitute another model", async () => {
  let calls = 0;
  const adapter = createQwenImageAdapter({
    async request() {
      calls++;
      return jsonResponse({ data: [{ id: "other" }] });
    },
  });
  await assert.rejects(
    adapter.generate({
      connection: exampleConnection,
      request: imageGenerationInputSchema.parse({ prompt: "test" }),
      model: "Qwen-Image-2.1",
      timeoutMs: 1000,
      references: [],
    }),
    /not advertised/,
  );
  assert.equal(calls, 1);
});

test("real HTTP cancellation closes the pending generation and never retries", async () => {
  let posts = 0;
  let closeResolve!: () => void;
  const closed = new Promise<void>((resolve) => {
    closeResolve = resolve;
  });
  const server = createServer((request, response) => {
    if (request.url === "/v1/models") {
      response.end(JSON.stringify({ data: [{ id: "Qwen-Image-2.1" }] }));
      return;
    }
    posts++;
    request.resume();
    response.on("close", closeResolve);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const controller = new AbortController();
  const adapter = createQwenImageAdapter(
    new NodeHttpClientAdapter({ env: {}, noProxy: "*", requestDeadlineOnly: true }),
  );
  const timer = setInterval(() => {
    if (posts) controller.abort();
  }, 10);
  try {
    await assert.rejects(
      adapter.generate({
        connection: { ...exampleConnection, baseUrl: `http://127.0.0.1:${port}` },
        request: imageGenerationInputSchema.parse({ prompt: "test" }),
        model: "Qwen-Image-2.1",
        timeoutMs: 10000,
        references: [],
        signal: controller.signal,
      }),
    );
    await closed;
    assert.equal(posts, 1);
  } finally {
    clearInterval(timer);
    server.closeAllConnections();
    server.close();
  }
});

test("auto-background edit never adds transparency instructions for incidental alpha", async () => {
  const image = await fixtureImage(true);
  const prompt = "Change the teapot to blue. Keep the room.";
  const adapter = createQwenImageAdapter({
    async request(request) {
      if (request.url.endsWith("/models"))
        return jsonResponse({ data: [{ id: "Qwen-Image-2.1" }] });
      const form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: Buffer.from(request.body!),
      }).formData();
      assert.equal(form.get("prompt"), prompt);
      assert.equal(form.get("background"), "auto");
      return jsonResponse({ data: [{ b64_json: Buffer.from(image.bytes).toString("base64") }] });
    },
  });
  await adapter.generate({
    connection: exampleConnection,
    request: imageGenerationInputSchema.parse({
      operation: "edit",
      prompt,
      size: "512x512",
      references: ["one"],
      background: "auto",
    }),
    references: [image],
    model: "Qwen-Image-2.1",
    timeoutMs: 1000,
  });
});

test("JPEG uses one lossless upstream request and explicit white-matte Host encoding", async () => {
  const image = await fixtureImage(true);
  let posts = 0;
  const adapter = createQwenImageAdapter({
    async request(request) {
      if (request.url.endsWith("/models"))
        return jsonResponse({ data: [{ id: "Qwen-Image-2.1" }] });
      posts++;
      const fields = JSON.parse(Buffer.from(request.body!).toString());
      assert.equal(fields.output_format, "png");
      assert.equal(fields.output_compression, undefined);
      return jsonResponse({ data: [{ b64_json: Buffer.from(image.bytes).toString("base64") }] });
    },
  });
  const result = await adapter.generate({
    connection: exampleConnection,
    request: imageGenerationInputSchema.parse({
      prompt: "red square",
      size: "512x512",
      outputFormat: "jpeg",
      outputCompression: 85,
    }),
    model: "Qwen-Image-2.1",
    timeoutMs: 1000,
    references: [],
  });
  assert.equal(posts, 1);
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(result.transparent, false);
  assert.equal(result.width, 512);
  assert.deepEqual(result.encoding, { sourceFormat: "png", quality: 85, matte: "white" });
  const { Jimp } = await import("jimp");
  const decoded = await Jimp.read(result.bytes);
  assert.ok(decoded.bitmap.data[0]! >= 250, "transparent corners are composited onto white");
});

test("malformed, multiple and invalid binary responses fail after exactly one POST", async () => {
  for (const payload of [
    null,
    { data: [] },
    { data: [{ b64_json: "!!!!" }] },
    { data: [{ b64_json: "AAAA" }, { b64_json: "AAAA" }] },
    { data: [{ b64_json: Buffer.from("not an image").toString("base64") }] },
  ]) {
    let posts = 0;
    const adapter = createQwenImageAdapter({
      async request(request) {
        if (request.url.endsWith("/models"))
          return jsonResponse({ data: [{ id: "Qwen-Image-2.1" }] });
        posts++;
        return jsonResponse(payload);
      },
    });
    await assert.rejects(
      adapter.generate({
        connection: exampleConnection,
        request: imageGenerationInputSchema.parse({ prompt: "fixture", size: "512x512" }),
        model: "Qwen-Image-2.1",
        timeoutMs: 1000,
        references: [],
      }),
    );
    assert.equal(posts, 1);
  }
});
