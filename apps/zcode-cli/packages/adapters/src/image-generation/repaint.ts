import { Jimp } from "jimp";
import { ImageGenerationError, type ImageGenerationBinary } from "@zcode/contracts";
import { inspectImage } from "./binary.js";

const GUIDE_COLOR = [255, 0, 255] as const;
const GUIDE_OPACITY = 0.35;

/** Qwen edits has no native mask field: guide a derived reference, then preserve the exterior. */
export async function prepareRepaint(
  target: ImageGenerationBinary | undefined,
  mask: ImageGenerationBinary,
  size: string,
) {
  if (
    !target ||
    mask.mimeType !== "image/png" ||
    mask.width !== target.width ||
    mask.height !== target.height ||
    size !== `${target.width}x${target.height}`
  )
    throw new ImageGenerationError(
      "invalid_mask",
      "Use a PNG mask matching Picture 1 and keep the original image size",
    );
  const original = await Jimp.read(Buffer.from(target.bytes));
  const selection = await Jimp.read(Buffer.from(mask.bytes));
  const guide = original.clone();
  let selected = false;
  for (let i = 0; i < selection.bitmap.data.length; i += 4) {
    const amount = 1 - selection.bitmap.data[i + 3]! / 255;
    if (!amount) continue;
    selected = true;
    for (let channel = 0; channel < 3; channel++)
      guide.bitmap.data[i + channel] = Math.round(
        original.bitmap.data[i + channel]! * (1 - amount * GUIDE_OPACITY) +
          GUIDE_COLOR[channel]! * amount * GUIDE_OPACITY,
      );
    guide.bitmap.data[i + 3] = Math.max(
      original.bitmap.data[i + 3]!,
      Math.round(255 * amount * GUIDE_OPACITY),
    );
  }
  if (!selected)
    throw new ImageGenerationError("empty_mask", "Paint an area before applying a regional edit");
  return {
    reference: await inspectImage(await guide.getBuffer("image/png")),
    instruction:
      "Edit only the area highlighted in magenta on Picture 1. The magenta is a selection guide, not part of the image: remove its tint in the edited result. Keep the framing, scale and all other areas unchanged. Apply this instruction to the highlighted region: ",
    async composite(generated: ImageGenerationBinary): Promise<ImageGenerationBinary> {
      if (generated.width !== target.width || generated.height !== target.height)
        throw new ImageGenerationError("invalid_response", "Regional edit dimensions changed");
      const result = original.clone();
      const candidate = await Jimp.read(Buffer.from(generated.bytes));
      for (let i = 0; i < selection.bitmap.data.length; i += 4) {
        const amount = 1 - selection.bitmap.data[i + 3]! / 255;
        if (!amount) continue;
        if (amount === 1) {
          candidate.bitmap.data.copy(result.bitmap.data, i, i, i + 4);
          continue;
        }
        const originalAlpha = original.bitmap.data[i + 3]! / 255;
        const generatedAlpha = candidate.bitmap.data[i + 3]! / 255;
        const alpha = originalAlpha * (1 - amount) + generatedAlpha * amount;
        for (let channel = 0; channel < 3; channel++)
          result.bitmap.data[i + channel] = alpha
            ? Math.round(
                (original.bitmap.data[i + channel]! * originalAlpha * (1 - amount) +
                  candidate.bitmap.data[i + channel]! * generatedAlpha * amount) /
                  alpha,
              )
            : 0;
        result.bitmap.data[i + 3] = Math.round(alpha * 255);
      }
      return inspectImage(await result.getBuffer("image/png"));
    },
  };
}
