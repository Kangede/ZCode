import assert from "node:assert/strict";
import test from "node:test";
import {
  publicProviderView,
  preserveProviderSecrets,
  SAVED_PROVIDER_SECRET,
} from "../../packages/services/src/model-provider/providerSecretProjection.js";
import {
  createProviderSettingsService,
  createModelSelectionService,
} from "../../packages/services/src/model-provider/providerFacadeServices.js";

const config = () => ({
  access: { type: "api-key", apiKey: "fixture-only-secret" },
  api: {
    type: "openai-chat-completions",
    baseUrl: "https://example.test/v1",
    headers: {
      Authorization: "Bearer header-secret",
      "X-API-Key": "header-key",
      "X-Request-Mode": "normal",
    },
  },
});

test("public provider projections remove keys and auth headers without mutating private data", () => {
  const privateValue = { providers: [{ effectiveConfig: config(), personalConfig: config() }] };
  const visible = publicProviderView(privateValue);
  assert.equal(visible.providers[0]!.effectiveConfig.access.apiKey, SAVED_PROVIDER_SECRET);
  assert.equal(
    visible.providers[0]!.effectiveConfig.api.headers.Authorization,
    SAVED_PROVIDER_SECRET,
  );
  assert.equal(visible.providers[0]!.effectiveConfig.api.headers["X-Request-Mode"], "normal");
  assert.equal(JSON.stringify(visible).includes("fixture-only-secret"), false);
  assert.equal(privateValue.providers[0]!.effectiveConfig.access.apiKey, "fixture-only-secret");
});

test("masked saves preserve only the matching provider and allow explicit replace or clear", () => {
  const current = config();
  assert.deepEqual(preserveProviderSecrets(publicProviderView(current), current), current);
  assert.throws(
    () => preserveProviderSecrets(publicProviderView(current), undefined),
    /No saved credential/,
  );
  for (const apiKey of ["new-key", ""]) {
    assert.equal(preserveProviderSecrets({ access: { apiKey } }, current).access.apiKey, apiKey);
  }
});

test("settings reads, events and mutation replies stay redacted while host writes keep the secret", async () => {
  let changed: (view: any) => void = () => {};
  let saved: any;
  const view = {
    revision: 1,
    providerOrder: ["fixture"],
    providerTemplates: [],
    providers: [{ providerId: "fixture", effectiveConfig: config() }],
  };
  const facade: any = {
    getView: () => view,
    onDidChange: (listener: any) => {
      changed = listener;
      return () => {};
    },
    savePersonalProviderOverlay: async (id: string, value: any, _metadata: any, resolve: any) => {
      saved = resolve ? resolve(id === "fixture" ? config() : undefined) : value;
      return view;
    },
  };
  const service = createProviderSettingsService(facade);
  const visible = await service.getView();
  assert.equal(JSON.stringify(visible).includes("fixture-only-secret"), false);
  let event: any;
  const listener = service.onDidChange((value) => {
    event = value;
  });
  changed(view);
  assert.equal(JSON.stringify(event).includes("fixture-only-secret"), false);
  const response = await service.savePersonalProviderOverlay(
    "fixture",
    publicProviderView(config()),
  );
  assert.equal(saved.access.apiKey, "fixture-only-secret");
  assert.equal(JSON.stringify(response).includes("fixture-only-secret"), false);
  await assert.rejects(
    service.savePersonalProviderOverlay("other-provider", publicProviderView(config())),
    /No saved credential/,
  );
  listener.dispose();
});

test("model selection projection also keeps the API key on the host", async () => {
  const service = createModelSelectionService({
    getView: () => ({
      revision: 1,
      providers: [{ providerId: "fixture", config: config(), models: [] }],
    }),
    onDidChange: () => () => {},
  } as any);
  try {
    assert.equal(JSON.stringify(await service.getView()).includes("fixture-only-secret"), false);
  } finally {
    service.dispose();
  }
});

test("metadata saves preserve a key rotated earlier in the existing provider mutation queue", async () => {
  const { ProviderSettingsFacade } = await import("../../packages/provider/src/facades.js");
  let stored = config();
  const snapshot: any = {
    config: { personalRevision: "fixture" },
    resolution: { resolvedProviders: [{ providerId: "fixture", models: [] }] },
  };
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const facade = new ProviderSettingsFacade(
    { getSnapshot: () => snapshot } as any,
    {
      async savePersonalProviderOverlay(_id: string, value: any) {
        if (++writes === 1) {
          started();
          await gate;
        }
        stored = value.toJSON();
      },
      async refresh() {
        return snapshot;
      },
    } as any,
  );
  facade.getView = () =>
    ({
      revision: 1,
      providerOrder: ["fixture"],
      providerTemplates: [],
      providers: [{ providerId: "fixture", effectiveConfig: stored }],
    }) as any;
  const service = createProviderSettingsService(facade);
  const first = service.savePersonalProviderOverlay("fixture", {
    ...stored,
    access: { type: "api-key", apiKey: "rotated-secret" },
  });
  await entered;
  const second = service.savePersonalProviderOverlay("fixture", publicProviderView(config()));
  release();
  await Promise.all([first, second]);
  assert.equal(stored.access.apiKey, "rotated-secret");
});
