import { useRef, useState } from "react";
import { isApiKeyAccess } from "@zcode/provider";
import { useServices } from "./useServices.js";
import { useProviderSettingsServiceView } from "./useProviderSettingsView.js";

export function useImageProviders() {
  const { providerSettingsService } = useServices();
  const view = useProviderSettingsServiceView(providerSettingsService);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const busy = useRef(false);
  const currentService = useRef(providerSettingsService);
  currentService.current = providerSettingsService;
  const providers =
    view.state.status === "ready"
      ? view.state.view.providers.filter((provider) =>
          isApiKeyAccess(provider.effectiveConfig.access),
        )
      : [];
  return {
    providers,
    saving,
    error,
    state: view.state,
    reload: view.reload,
    async save(input: { providerId?: string; name: string; baseUrl: string; apiKey: string }) {
      if (busy.current) return;
      busy.current = true;
      setSaving(true);
      setError(undefined);
      try {
        const url = new URL(input.baseUrl.trim());
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error("Use an HTTP(S) base URL without credentials or query parameters");
        const existing = input.providerId
          ? providers.find((provider) => provider.providerId === input.providerId)
          : undefined;
        if (input.providerId && !existing) throw new Error("Image provider is no longer available");
        const savedAccess = existing?.effectiveConfig.access;
        const apiKey =
          input.apiKey.trim() || (isApiKeyAccess(savedAccess) ? savedAccess.apiKey : undefined);
        if (!apiKey) throw new Error("Enter the image provider API key");
        const config = {
          ...existing?.personalConfig,
          access: {
            ...savedAccess,
            type: isApiKeyAccess(savedAccess) ? savedAccess.type : ("api-key" as const),
            apiKey,
          },
          api: {
            ...existing?.effectiveConfig.api,
            type: existing?.effectiveConfig.api?.type ?? ("openai-chat-completions" as const),
            baseUrl: url.toString().replace(/\/$/, ""),
          },
        };
        let id = input.providerId;
        if (id)
          view.commit(
            await providerSettingsService.savePersonalProviderOverlay(id, config, {
              providerName: input.name.trim() || "Qwen Image",
              enabled: true,
            }),
          );
        else {
          const result = await providerSettingsService.createPersonalProvider({
            providerName: input.name.trim() || "Qwen Image",
            initialConfig: config,
          });
          id = result.providerId;
          view.commit(result.view);
        }
        return currentService.current === providerSettingsService ? id : undefined;
      } catch (cause) {
        if (currentService.current === providerSettingsService)
          setError(cause instanceof Error ? cause.message : String(cause));
        return undefined;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
  };
}
