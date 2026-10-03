import { IMAGE_GENERATION_TOOL_NAME } from "@zcode/shared/image-generation";
import type { AgentRuntimeInternal } from "../internal.js";
import { generateImageToolEntry } from "../../tool/handlers/generate-image.js";
import { resolveBuiltInToolAllowlist, resolveRuntimeDisallowedTools } from "./tool-allowlist.js";
import { isToolNameDisallowed } from "../../tool/tool-visibility.js";

export function refreshImageGenerationTool(runtime: AgentRuntimeInternal): void {
  const existing = runtime.registry.get(IMAGE_GENERATION_TOOL_NAME);
  if (existing && existing.handler !== generateImageToolEntry.handler) {
    if (runtime.imageGenerationPort?.isEnabled())
      throw new Error("GenerateImage tool name is already owned by another feature");
    return;
  }
  runtime.registry.unregister(IMAGE_GENERATION_TOOL_NAME);
  const allowed = resolveBuiltInToolAllowlist(runtime.config);
  if (
    runtime.imageGenerationPort?.isEnabled() &&
    (!allowed || allowed.includes(IMAGE_GENERATION_TOOL_NAME)) &&
    !isToolNameDisallowed(IMAGE_GENERATION_TOOL_NAME, resolveRuntimeDisallowedTools(runtime.config))
  ) {
    runtime.registry.register({
      ...generateImageToolEntry,
      metadata: {
        ...generateImageToolEntry.metadata,
        description: [
          generateImageToolEntry.metadata.description,
          runtime.imageGenerationPort.describeRecentImages(),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    });
  }
  runtime.cachedTools = null;
}
