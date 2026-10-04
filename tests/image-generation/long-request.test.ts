import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createQwenImageAdapter } from "../../apps/zcode-cli/packages/adapters/src/image-generation/qwen.js";
import { NodeHttpClientAdapter } from "../../apps/zcode-cli/packages/adapters/src/http/index.js";
import { imageGenerationInputSchema } from "../../packages/shared/src/image-generation.js";
import { exampleConnection, fixtureImage } from "./fixtures.js";

test(
  "a silent upstream response survives beyond 300 seconds",
  { skip: process.env.ZCODE_IMAGE_TEST_LONG !== "1", timeout: 370000 },
  async () => {
    const image = await fixtureImage();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const server = createServer((request, response) => {
      request.resume();
      if (request.url === "/v1/models") {
        response.end(JSON.stringify({ data: [{ id: "Qwen-Image-2.1" }] }));
        return;
      }
      timers.push(
        setTimeout(
          () =>
            response.end(
              JSON.stringify({ data: [{ b64_json: Buffer.from(image.bytes).toString("base64") }] }),
            ),
          310000,
        ),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const start = Date.now();
    try {
      const result = await createQwenImageAdapter(
        new NodeHttpClientAdapter({ env: {}, noProxy: "*", requestDeadlineOnly: true }),
      ).generate({
        connection: { ...exampleConnection, baseUrl: `http://127.0.0.1:${port}` },
        request: imageGenerationInputSchema.parse({ prompt: "long request", size: "512x512" }),
        model: "Qwen-Image-2.1",
        timeoutMs: 1200000,
        references: [],
      });
      assert.ok(Date.now() - start >= 300000);
      assert.equal(result.width, 512);
    } finally {
      timers.forEach(clearTimeout);
      server.closeAllConnections();
      server.close();
    }
  },
);
