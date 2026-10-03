import { join } from "node:path";
import { createImageJournal, createQwenImageAdapter } from "@zcode/adapters/image-generation";
import {
  ImageGenerationError,
  type HttpClientPort,
  type TraceContext,
  type ToolArtifactStorePort,
} from "@zcode/contracts";
import { isApiKeyAccess } from "@zcode/provider";
import type { AgentRuntime } from "@zcode/core";
import type { ImageGenerationSettings } from "@zcode/shared/image-generation";
import type { ProviderRegistryModelSource } from "./provider-registry-model-runtime.js";
import { ImageTaskService } from "./image-generation-service.js";

export async function createImageTaskService(options: {
  trace: TraceContext;
  available: boolean;
  storageRoot: string;
  sessionId: string;
  workingDirectory: string;
  artifacts: ToolArtifactStorePort;
  http: HttpClientPort;
  registry: ProviderRegistryModelSource;
  runtime: () => AgentRuntime;
  settings?: Partial<ImageGenerationSettings>;
  disallowedTools: readonly string[];
}): Promise<ImageTaskService> {
  const service = new ImageTaskService({
    trace: options.trace,
    available: options.available,
    sessionId: options.sessionId,
    journal: createImageJournal({
      rootDir: join(options.storageRoot, "cli", "image-generation"),
      sessionId: options.sessionId,
      workspace: options.workingDirectory,
    }),
    artifacts: options.artifacts,
    adapter: createQwenImageAdapter(options.http),
    initialSettings: options.settings,
    connection(providerId) {
      const selectedId = providerId ?? options.runtime().getSessionModelSelection()?.providerId;
      const provider = selectedId ? options.registry.getProvider(selectedId) : undefined;
      if (!provider || !isApiKeyAccess(provider.config.access) || !provider.config.access.apiKey) {
        throw new ImageGenerationError(
          "missing_credentials",
          "Select a configured API-key provider for image generation",
        );
      }
      return {
        providerId: provider.providerId,
        baseUrl: provider.config.api.baseUrl,
        apiKey: provider.config.access.apiKey,
      };
    },
    assertUserSubmission() {
      if (options.runtime().getMode() === "plan" || options.runtime().getPlanEnabled())
        throw new ImageGenerationError(
          "plan_mode",
          "Switch to build mode before changing image resources",
        );
      if (options.disallowedTools.some((tool) => tool === "GenerateImage" || tool === "*"))
        throw new ImageGenerationError(
          "permission_denied",
          "Image generation is disabled by the tool permission policy",
        );
    },
    async beforeUserSubmission(input) {
      await options.runtime().ensureSessionPersistedForExternalActivity(input.prompt);
    },
    onJobCompleted() {
      options.runtime().refreshImageGeneration();
    },
    onSettingsChanged() {
      options.runtime().refreshImageGeneration();
    },
  });
  await service.initialize();
  return service;
}
