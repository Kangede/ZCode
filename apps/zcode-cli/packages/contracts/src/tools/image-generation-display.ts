import { z } from "zod";

// CLI contracts use Zod 3 while shared/UI uses Zod 4. Keep this wire mirror
// explicit; cross-version fixture tests verify both parsers accept the same data.
export const imageGenerationDisplaySchema = z
  .object({
    kind: z.literal("image_generation"),
    schemaVersion: z.literal(1),
    jobId: z.string(),
    artifact: z
      .object({
        id: z.string().min(1),
        name: z.string(),
        uri: z.string().min(1),
        path: z.string().optional(),
        mimeType: z.enum(["image/png", "image/jpeg"]),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        bytes: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        transparent: z.boolean(),
        encoding: z
          .object({
            sourceFormat: z.literal("png"),
            quality: z.number().int().min(0).max(100),
            matte: z.literal("white"),
          })
          .optional(),
        seed: z.number().int().optional(),
      })
      .optional(),
  })
  .strict();
