import {
  IMAGE_GENERATION_TOOL_NAME,
  imageGenerationInputSchema,
  imageGenerationInputJsonSchema,
  imageJobSchema,
} from "@zcode/shared/image-generation";
import type { ToolEntry } from "../types.js";

export const generateImageToolEntry: ToolEntry = {
  capability: "Generate or edit raster images through the configured Images provider",
  metadata: {
    name: IMAGE_GENERATION_TOOL_NAME,
    description:
      "Generate a new image or edit existing images with Qwen-Image-2.1. Use this tool for image creation and image adjustments. Read the image-generation skill for prompting guidance. Reference images by returned image ID or workspace file path, in Picture 1–5 order. For edits use a previous job ID as parentId. For regional edits provide mask as a same-size PNG artifact ID or workspace path: transparent mask pixels are edited, opaque pixels are preserved; keep the target as Picture 1 and use original size with PNG output. Desktop and Web show images in the native workbench; terminal sessions receive file paths only; do not read their Base64 into context or claim visual inspection without a vision tool. Never run a separate shell image client when this tool is available.",
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    sideEffectScope: "workspace",
    riskLevel: "medium",
    needsApproval: true,
    timeoutMs: 3_600_000,
    maxOutputBytes: 4096,
  },
  inputSchema: imageGenerationInputJsonSchema,
  outputSchema: { type: "object" },
  runtimeInputSchema: imageGenerationInputSchema,
  runtimeOutputSchema: imageJobSchema,
  async handler(input, context) {
    if (!context.imageGenerationPort?.isEnabled())
      throw new Error("Image generation is disabled or unavailable in this session");
    return context.imageGenerationPort.execute(imageGenerationInputSchema.parse(input), {
      commandId: `tool:${context.turnId}:${context.toolCallId}`,
      signal: context.abortSignal,
      trace: context.traceContext,
    });
  },
  formatModelContent(output) {
    const job = imageJobSchema.parse(output);
    return [
      {
        type: "text",
        text: JSON.stringify({
          jobId: job.id,
          status: job.status,
          parentId: job.input.parentId,
          path: job.artifact?.path,
          width: job.artifact?.width,
          height: job.artifact?.height,
          format: job.input.outputFormat,
          seed: job.input.seed,
          transparent: job.artifact?.transparent,
          encoding: job.artifact?.encoding,
          message:
            "Report the saved path and verified metadata. Use jobId as parentId for edits. Do not assert which interface the user is viewing. The text model has not visually inspected the image.",
        }),
      },
    ];
  },
  permission: {
    permission: "image_generation",
    reason: "Generate an image using the configured provider and save its binary artifact",
    riskLevel: "medium",
    sideEffectScope: "workspace",
    needsApproval: true,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: { maxInlineBytes: 4096, maxModelBytes: 4096, strategy: "inline" },
  // 整体截止时间由会话服务拥有，避免通用工具计时器先于生图配置截断长请求。
  timeout: { kind: "none" },
  cancellation: {
    supported: true,
    cleanup: "required",
    userVisibleMessage: "Image request cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
