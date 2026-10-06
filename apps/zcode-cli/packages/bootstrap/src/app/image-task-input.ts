import { randomBytes } from "node:crypto";
import { ImageGenerationError } from "@zcode/contracts";
import { inspectImage } from "@zcode/adapters/image-generation";
import {
  imageGenerationInputSchema,
  type ImageArtifact,
  type ImageJob,
} from "@zcode/shared/image-generation";

/** Resolve immutable session references once on the existing owner execution path. */
export async function resolveImageTaskInput(
  job: ImageJob,
  access: {
    artifact(id: string): ImageArtifact | undefined;
    job(id: string): ImageJob | undefined;
    read(artifact: ImageArtifact): Promise<Uint8Array>;
    readWorkspace(path: string): Promise<Uint8Array>;
  },
) {
  const input = { ...job.input, references: [...job.input.references] };
  if (input.parentId && !input.references.includes(input.parentId))
    input.references.unshift(input.parentId);
  if (input.references.length > 5)
    throw new ImageGenerationError(
      "invalid_references",
      "At most five reference images, including the edit target",
    );
  const read = async (reference: string) => {
    const artifact = access.artifact(reference);
    // 面板只接受会话产物 ID；本地文件路径仅由已有工具权限边界内的 Agent 使用。
    if (!artifact && job.origin === "user")
      throw new ImageGenerationError("not_found", "Image artifact not found in this session");
    return inspectImage(
      artifact ? await access.read(artifact) : await access.readWorkspace(reference),
    );
  };
  const knownSeeds = new Set(input.references.map((id) => access.artifact(id)?.seed));
  const references = [];
  for (const reference of input.references) references.push(await read(reference));
  const mask = input.mask ? await read(input.mask) : undefined;
  if (input.seed === undefined) {
    input.seed = input.operation === "generate" ? 42 : randomBytes(4).readUInt32LE();
    while (knownSeeds.has(input.seed)) input.seed = (input.seed + 1) >>> 0;
  }
  // Alpha 是文件事实，不等于抠图意图；只继承编辑目标明确要求的透明背景。
  const target = access.job(input.parentId ?? input.references[0] ?? "");
  input.background ??= input.operation === "edit" ? (target?.input.background ?? "auto") : "auto";
  if (input.outputFormat === "jpeg") input.outputCompression ??= 90;
  return { input: imageGenerationInputSchema.parse(input), references, mask };
}
