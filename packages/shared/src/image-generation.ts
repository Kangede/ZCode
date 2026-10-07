import { z } from "zod";

export const IMAGE_GENERATION_TOOL_NAME = "GenerateImage";
export const IMAGE_GENERATION_SKILL_NAME = "image-generation";
export const IMAGE_GENERATION_TIMEOUT_MS = 1_200_000;
export const IMAGE_REFERENCE_MAX_BYTES = 50 * 1024 * 1024;
export const IMAGE_BODY_MAX_BYTES = 256 * 1024 * 1024;
export const IMAGE_RESPONSE_MAX_BYTES = 128 * 1024 * 1024;
export const IMAGE_CHUNK_BYTES = 512 * 1024;
export const IMAGE_MAX_REFERENCES = 5;
export const IMAGE_ASPECT_RATIOS = [
  { label: "1:1", ratio: 1, width: 2048, height: 2048 },
  { label: "4:3", ratio: 4 / 3, width: 2400, height: 1792 },
  { label: "3:4", ratio: 3 / 4, width: 1792, height: 2400 },
  { label: "3:2", ratio: 3 / 2, width: 2528, height: 1696 },
  { label: "2:3", ratio: 2 / 3, width: 1696, height: 2528 },
  { label: "16:9", ratio: 16 / 9, width: 2752, height: 1536 },
  { label: "9:16", ratio: 9 / 16, width: 1536, height: 2752 },
] as const;

export function validateImageSize(size: string): string {
  const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(size);
  if (!match) throw new Error("Image size must be WIDTHxHEIGHT");
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width % 32 || height % 32) throw new Error("Image dimensions must be multiples of 32");
  const ratio = width / height;
  const family = [...IMAGE_ASPECT_RATIOS].sort(
    (a, b) => Math.abs(ratio / a.ratio - 1) - Math.abs(ratio / b.ratio - 1),
  )[0]!;
  if (Math.abs(ratio / family.ratio - 1) > 0.02 || width > family.width || height > family.height) {
    throw new Error("Image dimensions exceed the supported aspect ratio or size");
  }
  return family.label;
}

// A40 48 GB / BF16 / text-encoder layerwise offload, serial requests.
// Keep hardware admission separate from schemas used to restore historical jobs.
// 参考图按输出面积放大；按实测连续成功范围及更高档的失败边界准入。
// 早期筛选用的显存停测线不是硬件上限。依据见 image-generation-capacity-acceptance.md。
const IMAGE_REFERENCE_CAPACITY = [
  { pixels: 1536 * 1536, references: 5 },
  { pixels: 1792 * 1792, references: 3 },
  { pixels: Infinity, references: 2 },
] as const;
const IMAGE_REFERENCE_CAPACITY_DESCRIPTION =
  "Total references include the edit target. Limits by output pixel count: " +
  IMAGE_REFERENCE_CAPACITY.map(
    (tier) =>
      `${Number.isFinite(tier.pixels) ? `up to ${tier.pixels} pixels` : "larger supported sizes"}: ${tier.references}`,
  ).join("; ") +
  ". Remove references or reduce size when over the limit.";

export function getImageReferenceLimit(size: string): number | undefined {
  try {
    validateImageSize(size);
  } catch {
    return undefined;
  }
  const [width, height] = size.split("x").map(Number);
  return IMAGE_REFERENCE_CAPACITY.find((tier) => width! * height! <= tier.pixels)!.references;
}

export function getImageReferenceCapacity(input: {
  size: string;
  references: readonly string[];
  parentId?: string;
}) {
  const limit = getImageReferenceLimit(input.size);
  const count =
    input.references.length +
    (input.parentId && !input.references.includes(input.parentId) ? 1 : 0);
  return { limit, count, exceeded: limit !== undefined && count > limit };
}

export function imageReferenceCapacityMessage(size: string, limit: number, zh = false): string {
  return zh
    ? `${size} 最多支持 ${limit} 张参考图（含编辑目标）。请移除参考图或降低输出尺寸。`
    : `${size} supports at most ${limit} reference images, including the edit target. Remove references or reduce the output size.`;
}

export const imageGenerationSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  providerId: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).max(80).default("Qwen-Image-2.1"),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).default(IMAGE_GENERATION_TIMEOUT_MS),
});
export type ImageGenerationSettings = z.infer<typeof imageGenerationSettingsSchema>;

export const imageGenerationInputSchema = z
  .object({
    operation: z.enum(["generate", "edit"]).default("generate"),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(64 * 1024),
    references: z
      .array(z.string().min(1).max(32_768))
      .max(IMAGE_MAX_REFERENCES)
      .describe(IMAGE_REFERENCE_CAPACITY_DESCRIPTION)
      .default([]),
    parentId: z.string().min(1).max(128).optional(),
    mask: z.string().min(1).max(32_768).optional(),
    size: z.string().default("1024x1024"),
    seed: z.number().int().min(0).max(0xffffffff).optional(),
    background: z.enum(["auto", "transparent"]).optional(),
    outputFormat: z.enum(["png", "jpeg"]).default("png"),
    guidanceScale: z.number().min(1).max(20).default(1),
    negativePrompt: z
      .string()
      .max(64 * 1024)
      .optional(),
    outputCompression: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const issue = (message: string, path: string) =>
      context.addIssue({ code: "custom", message, path: [path] });
    try {
      validateImageSize(input.size);
    } catch (error) {
      issue((error as Error).message, "size");
    }
    if (input.operation === "edit" && input.references.length === 0 && !input.parentId)
      issue("Editing requires a reference image", "references");
    if (input.operation === "generate" && (input.references.length || input.parentId))
      issue("Use edit for reference images", "references");
    if (input.mask) {
      if (input.operation !== "edit") issue("A mask requires an edit", "mask");
      if (input.outputFormat !== "png")
        issue("Regional edits require PNG to preserve exterior pixels", "outputFormat");
      if (input.parentId && input.references.length && input.references[0] !== input.parentId)
        issue("The masked edit target must be Picture 1", "references");
    }
    if (input.background === "transparent" && input.outputFormat !== "png")
      issue("Transparency requires PNG", "outputFormat");
    if (input.guidanceScale > 1 && !input.negativePrompt)
      issue("Guidance above 1 requires a negative prompt", "negativePrompt");
    if (input.negativePrompt && input.guidanceScale <= 1)
      issue("Negative prompt requires guidance above 1", "guidanceScale");
    if (input.outputCompression !== undefined && input.outputFormat !== "jpeg")
      issue("Compression is JPEG-only", "outputCompression");
  });
export type ImageGenerationInput = z.infer<typeof imageGenerationInputSchema>;
export const imageGenerationInputJsonSchema = z.toJSONSchema(imageGenerationInputSchema, {
  io: "input",
  unrepresentable: "any",
});

export const imageArtifactSchema = z.object({
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
});
export type ImageArtifact = z.infer<typeof imageArtifactSchema>;
export const imageJobSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  commandId: z.string().min(1),
  requestHash: z.string().optional(),
  origin: z.enum(["agent", "user"]),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]),
  input: imageGenerationInputSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  artifact: imageArtifactSchema.optional(),
  error: z
    .object({ code: z.string(), message: z.string(), status: z.number().optional() })
    .optional(),
});
export type ImageJob = z.infer<typeof imageJobSchema>;
export const imageGenerationDisplaySchema = z
  .object({
    kind: z.literal("image_generation"),
    schemaVersion: z.literal(1),
    jobId: z.string(),
    artifact: imageArtifactSchema.optional(),
  })
  .strict();

const sessionFields = { sessionId: z.string().min(1) };
export const imageGenerationRequestSchema = z.discriminatedUnion("action", [
  z.object({ ...sessionFields, action: z.literal("list") }),
  z.object({
    ...sessionFields,
    action: z.literal("configure"),
    settings: imageGenerationSettingsSchema,
  }),
  z.object({
    ...sessionFields,
    action: z.literal("submit"),
    commandId: z.string().min(1).max(128),
    input: imageGenerationInputSchema,
  }),
  z.object({ ...sessionFields, action: z.literal("cancel"), jobId: z.string().min(1).max(128) }),
  z.object({
    ...sessionFields,
    action: z.literal("import"),
    uploadId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    name: z.string().max(255),
    offset: z.number().int().nonnegative(),
    data: z.string().max(Math.ceil(IMAGE_CHUNK_BYTES / 3) * 4),
    final: z.boolean(),
  }),
  z.object({
    ...sessionFields,
    action: z.literal("read"),
    artifactId: z.string().min(1).max(128),
    preview: z.enum(["canvas", "reference"]).optional(),
    offset: z.number().int().nonnegative().default(0),
  }),
  z.object({
    ...sessionFields,
    action: z.literal("export"),
    artifactId: z.string().min(1).max(128),
  }),
]);
export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;
export const imageGenerationReplySchema = z.object({
  capabilities: z.object({ maskEditing: z.boolean() }).optional(),
  settings: imageGenerationSettingsSchema.optional(),
  jobs: z.array(imageJobSchema).optional(),
  job: imageJobSchema.optional(),
  references: z.array(imageArtifactSchema).optional(),
  artifact: imageArtifactSchema.optional(),
  data: z.string().optional(),
  nextOffset: z.number().nullable().optional(),
  totalBytes: z.number().optional(),
  path: z.string().optional(),
});
export type ImageGenerationReply = z.infer<typeof imageGenerationReplySchema>;
