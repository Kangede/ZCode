import { Jimp } from "jimp";
import { inspectImage } from "../../apps/zcode-cli/packages/adapters/src/image-generation/binary.js";

export async function fixtureImage(transparent = false) {
  const image = new Jimp({ width: 512, height: 512, color: transparent ? 0x00000000 : 0xcc4422ff });
  if (transparent)
    for (let y = 128; y < 384; y++)
      for (let x = 128; x < 384; x++) image.setPixelColor(0xcc4422ff, x, y);
  return inspectImage(await image.getBuffer("image/png"));
}

export const exampleConnection = {
  providerId: "local-test",
  baseUrl: "http://127.0.0.1:9/v1",
  apiKey: "fixture-secret",
};

export function jsonResponse(value: unknown, status = 200) {
  const body = Buffer.from(JSON.stringify(value));
  return {
    url: "http://127.0.0.1:9",
    status,
    statusText: "",
    headers: {},
    body,
    bytes: body.length,
    durationMs: 1,
  };
}
