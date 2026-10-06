import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { Jimp } from "jimp";

/** Actual HTTP fixture: the renderer must never contact this listener. */
export async function mockImageProvider(apiKey = "fixture-only-secret", imageFixture?: Uint8Array) {
  const requests: Array<{ path: string; fields: Record<string, unknown>; references: string[] }> =
    [];
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${apiKey}`) {
        res.writeHead(401).end("Missing private fixture credential");
        return;
      }
      if (req.url === "/v1/models") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: [{ id: "fixture-chat" }, { id: "Qwen-Image-2.1" }] }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      if (req.url?.includes("chat/completions")) {
        const body = JSON.parse(bytes.toString());
        const lastUser =
          body.messages?.findLastIndex((message: any) => message.role === "user") ?? -1;
        const capacity =
          lastUser >= 0 &&
          JSON.stringify(body.messages[lastUser].content).includes("[native-capacity]");
        const repaint =
          lastUser >= 0 &&
          JSON.stringify(body.messages[lastUser].content).includes("[native-repaint]");
        const marker =
          lastUser >= 0 &&
          (capacity ||
            repaint ||
            JSON.stringify(body.messages[lastUser].content).includes("[native-image]"));
        const handled = body.messages
          ?.slice(lastUser + 1)
          .some((message: any) => message.role === "tool");
        const native =
          marker &&
          !handled &&
          body.tools?.some((tool: any) => tool.function?.name === "GenerateImage");
        const toolPath = JSON.stringify(
          body.messages?.filter((message: any) => message.role === "tool") ?? [],
        ).match(/\/[^"\s]+?\.png/)?.[0];
        const content = handled
          ? capacity
            ? `Image request rejected: ${JSON.stringify(body.messages?.filter((message: any) => message.role === "tool"))}`
            : `Generated image saved. ${toolPath ?? ""}`
          : "Image acceptance session";
        const delta = native
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "fixture-image-call",
                  type: "function",
                  function: {
                    name: "GenerateImage",
                    arguments: JSON.stringify({
                      operation: repaint || capacity ? "edit" : "generate",
                      ...(repaint ? { references: ["source.png"], mask: "mask.png" } : {}),
                      prompt: repaint ? "Make the selected part blue" : "Legacy image result",
                      ...(capacity ? { references: Array(5).fill("source.png") } : {}),
                      size: capacity ? "2048x2048" : "512x512",
                      outputFormat: "png",
                    }),
                  },
                },
              ],
            }
          : { role: "assistant", content };
        res.setHeader("Content-Type", body.stream ? "text/event-stream" : "application/json");
        if (body.stream) {
          res.end(
            `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: native ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
          );
        } else
          res.end(
            JSON.stringify({
              id: "fixture",
              choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
          );
        return;
      }
      let fields: Record<string, unknown>;
      const references: string[] = [];
      if (req.headers["content-type"]?.startsWith("multipart/")) {
        const form = await new Request("http://fixture.test", {
          method: "POST",
          headers: { "Content-Type": req.headers["content-type"] },
          body: bytes,
        }).formData();
        fields = Object.fromEntries(
          [...form.entries()].filter(([, value]) => typeof value === "string"),
        );
        for (const file of form.getAll("image[]") as File[])
          references.push(
            createHash("sha256")
              .update(Buffer.from(await file.arrayBuffer()))
              .digest("hex"),
          );
      } else fields = JSON.parse(bytes.toString());
      requests.push({ path: req.url!, fields, references });
      if (String(fields.prompt).includes("[fail403]")) {
        res
          .writeHead(403, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "fixture-only-secret must not leak" }));
        return;
      }
      const timer = setTimeout(
        async () => {
          if (res.destroyed) return;
          const [width, height] = String(fields.size).split("x").map(Number);
          const transparent = fields.background === "transparent";
          const image = new Jimp({
            width: width!,
            height: height!,
            color: transparent ? 0x00000000 : 0xe9debcff,
          });
          const color = req.url?.endsWith("edits") ? 0x2255ddff : 0xdd4422ff;
          for (let y = height! / 4; y < (height! * 3) / 4; y++)
            for (let x = width! / 4; x < (width! * 3) / 4; x++) image.setPixelColor(color, x, y);
          const data = imageFixture
            ? Buffer.from(imageFixture)
            : await image.getBuffer(fields.output_format === "jpeg" ? "image/jpeg" : "image/png");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data: [{ b64_json: data.toString("base64") }] }));
        },
        String(fields.prompt).includes("[hold]") ? 90_000 : 2500,
      );
      res.on("close", () => clearTimeout(timer));
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return {
    requests,
    port,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
