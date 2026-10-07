import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderConfigResolver,
  ProviderConfigMap,
  ProviderConfig,
  ProviderApiConfig,
  ApiKeyAccessConfig,
  ModelConfigRules,
} from "../../packages/provider/src/index.js";
import { resolveImageProvider } from "../../apps/zcode-cli/packages/bootstrap/src/app/image-provider.js";

function registry(enabled = true, apiKey = "private-image-key") {
  const resolution = new ProviderConfigResolver().resolve({
    zcodeBuiltinProviders: ProviderConfigMap.empty(),
    accountProviders: ProviderConfigMap.empty(),
    zcodeBuiltinModelRules: ModelConfigRules.empty(),
    personalModels: ModelConfigRules.empty(),
    personalProviders: new ProviderConfigMap([
      {
        providerId: "dedicated-qwen",
        enabled,
        config: new ProviderConfig({
          group: "standard-personal",
          access: new ApiKeyAccessConfig({ apiKey }),
          api: new ProviderApiConfig({
            type: "openai-chat-completions",
            baseUrl: "https://images.example/v1",
          }),
        }),
      },
    ]),
  });
  return { resolution, getSnapshot: () => ({ resolution }) };
}

test("an image-only connection works without adding a chat model to the registry", () => {
  const source = registry();
  assert.equal(source.resolution.registryProviders.length, 0);
  assert.equal(source.resolution.resolvedProviders[0]!.models.length, 0);
  const connection = resolveImageProvider(source, "dedicated-qwen");
  assert.equal(connection.providerId, "dedicated-qwen");
  assert.equal(connection.apiKey, "private-image-key");
});

test("missing, deleted, disabled and incomplete providers never fall back to chat", () => {
  assert.throws(
    () =>
      resolveImageProvider({
        getSnapshot() {
          throw new Error("must not read");
        },
      }),
    /Select an independent/,
  );
  for (const [source, id] of [
    [registry(), "deleted"],
    [registry(false), "dedicated-qwen"],
    [registry(true, ""), "dedicated-qwen"],
  ] as const)
    assert.throws(() => resolveImageProvider(source, id), /configured API-key/);
});
