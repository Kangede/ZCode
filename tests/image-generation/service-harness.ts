import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ImageTaskService } from "../../apps/zcode-cli/packages/bootstrap/src/app/image-generation-service.js";
import { createImageJournal } from "../../apps/zcode-cli/packages/adapters/src/image-generation/journal.js";
import { imageGenerationInputSchema } from "../../packages/shared/src/image-generation.js";
import { exampleConnection, fixtureImage } from "./fixtures.js";

export const input = (extra = {}) =>
  imageGenerationInputSchema.parse({ prompt: "red teapot", size: "512x512", ...extra });

export async function harness(t: any, generate?: any) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-image-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, "workspace");
  await mkdir(workspace);
  const journal = createImageJournal({
    rootDir: join(directory, "journal"),
    sessionId: "session-one",
    workspace,
  });
  const saved = new Map<string, Uint8Array>();
  let calls = 0;
  const image = await fixtureImage();
  const artifacts: any = {
    async writeToolResultBinaryArtifact(request: any) {
      const uri = `artifact://${randomUUID()}`;
      saved.set(uri, request.content);
      return {
        id: uri,
        uri,
        path: "/fixture/image.png",
        bytes: request.content.length,
        contentType: request.contentType,
        createdAt: new Date(),
      };
    },
    async readToolResultBinaryArtifact(request: any) {
      return { uri: request.uri, bytes: saved.get(request.uri)!, contentType: "image/png" };
    },
  };
  const options = {
    sessionId: "session-one",
    journal,
    artifacts,
    initialSettings: { enabled: true },
    connection: () => ({ ...exampleConnection }),
    adapter: {
      async generate(request: any) {
        calls++;
        return generate ? generate(request) : image;
      },
    },
  };
  const service = new ImageTaskService(options);
  await service.initialize();
  t.after(() => service.close());
  return { service, journal, saved, options, directory, workspace, image, calls: () => calls };
}
