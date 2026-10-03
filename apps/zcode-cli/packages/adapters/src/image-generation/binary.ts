import { Jimp } from "jimp";
import { ImageGenerationError, type ImageGenerationBinary } from "@zcode/contracts";

export async function inspectImage(bytes: Uint8Array): Promise<ImageGenerationBinary> {
  const png =
    bytes.length >= 24 &&
    Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216;
  if (!png && !jpeg)
    throw new ImageGenerationError("invalid_image", "Only valid PNG and JPEG images are supported");
  try {
    // 解码用于验证和读取 Alpha，保存与上传仍使用原始字节，避免预览压缩污染参考图。
    const dimensions = png
      ? { width: Buffer.from(bytes).readUInt32BE(16), height: Buffer.from(bytes).readUInt32BE(20) }
      : jpegDimensions(bytes);
    if (
      !dimensions ||
      dimensions.width <= 0 ||
      dimensions.height <= 0 ||
      dimensions.width * dimensions.height > 40_000_000
    )
      throw new Error("Image dimensions too large");
    const decoded = await Jimp.read(Buffer.from(bytes));
    const { width, height, data } = decoded.bitmap;
    if (width * height > 40_000_000) throw new Error("Image dimensions too large");
    let transparent = false;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] !== 255) {
        transparent = true;
        break;
      }
    }
    return { bytes, mimeType: png ? "image/png" : "image/jpeg", width, height, transparent };
  } catch {
    throw new ImageGenerationError(
      "invalid_image",
      "The image is damaged or exceeds the supported dimensions",
    );
  }
}

export function decodeImageBase64(data: string, maxBytes: number): Uint8Array {
  if (
    data.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data) ||
    data.length > Math.ceil(maxBytes / 3) * 4
  ) {
    throw new ImageGenerationError("invalid_base64", "Invalid or oversized image data");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > maxBytes || bytes.toString("base64") !== data) {
    throw new ImageGenerationError("invalid_base64", "Invalid or oversized image data");
  }
  return bytes;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const data = Buffer.from(bytes);
  let offset = 2;
  const frames = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset + 3 < data.length) {
    if (data[offset++] !== 0xff) return undefined;
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === undefined || offset + 2 > data.length)
      return undefined;
    if (marker >= 0xd0 && marker <= 0xd8) continue;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) return undefined;
    if (frames.has(marker) && length >= 8)
      return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
    offset += length;
  }
  return undefined;
}

/** JPEG cannot represent alpha; conversion is an explicit requested output format. */
export async function encodeImageJpeg(
  image: ImageGenerationBinary,
  quality = 90,
): Promise<ImageGenerationBinary> {
  const source = await Jimp.read(Buffer.from(image.bytes));
  const flattened = new Jimp({ width: image.width, height: image.height, color: 0xffffffff });
  flattened.composite(source, 0, 0);
  // jpeg-js 把 0 当作默认质量 50；显式映射到最低可编码质量 1。
  const effectiveQuality = Math.max(1, quality);
  const result = await inspectImage(
    await flattened.getBuffer("image/jpeg", { quality: effectiveQuality }),
  );
  return {
    ...result,
    encoding: { sourceFormat: "png", quality: effectiveQuality, matte: "white" },
  };
}

export async function createImagePreview(
  bytes: Uint8Array,
  mimeType: "image/png" | "image/jpeg",
  edge: number,
): Promise<Uint8Array> {
  const source = await Jimp.read(Buffer.from(bytes));
  if (Math.max(source.bitmap.width, source.bitmap.height) > edge) {
    source.scaleToFit({ w: edge, h: edge });
  }
  return source.getBuffer(mimeType);
}
