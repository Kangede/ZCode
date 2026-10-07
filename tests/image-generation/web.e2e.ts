import test from "node:test";
import { uiHarness } from "./ui-harness.js";
import { imageUiScenarios } from "./ui-scenarios.js";

test(
  "Web image workbench uses host-owned jobs and original artifacts",
  { timeout: 240_000 },
  async (t) => {
    const h = await uiHarness("web");
    t.after(() => h.close());
    t.diagnostic(`Evidence: ${h.directory}`);
    await imageUiScenarios(h);
  },
);
