import { ImageGenerationError, type ImageGenerationConnection } from "@zcode/contracts";
import { isApiKeyAccess } from "@zcode/provider";
import type { ProviderRegistryModelSource } from "./provider-registry-model-runtime.js";

/** Image settings select a registry connection independently of conversation models. */
export function resolveImageProvider(
  registry: Pick<ProviderRegistryModelSource, "getSnapshot">,
  providerId?: string,
): ImageGenerationConnection {
  // 旧设置缺少 providerId 时不能继续跟随会话，否则切换聊天模型会悄悄改变生图服务。
  if (!providerId)
    throw new ImageGenerationError(
      "missing_provider",
      "Select an independent image provider in the image workbench settings",
    );
  // 聊天 Registry 会排除零聊天模型的纯生图服务；连接应来自同一 Owner 已校验的配置快照。
  const provider = registry
    .getSnapshot?.()
    ?.resolution.resolvedProviders.find((item) => item.providerId === providerId);
  if (
    !provider ||
    !provider.enabled ||
    provider.providerIssues.length ||
    !isApiKeyAccess(provider.config.access) ||
    !provider.config.access.apiKey ||
    !provider.config.api?.baseUrl
  )
    throw new ImageGenerationError(
      "missing_credentials",
      "Select a configured API-key provider for image generation",
    );
  return {
    providerId: provider.providerId,
    baseUrl: provider.config.api.baseUrl,
    apiKey: provider.config.access.apiKey,
  };
}
