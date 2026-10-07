import test from "node:test";
import { uiHarness } from "./ui-harness.js";
import { imageUiScenarios } from "./ui-scenarios.js";

test(
  "actual Electron image workbench preserves file imports and exports",
  { timeout: 240_000 },
  async (t) => {
    const h = await uiHarness("desktop");
    t.after(() => h.close());
    t.diagnostic(
      `Evidence: ${h.directory}; file chooser replaced by Playwright setInputFiles, actual bytes verified`,
    );
    await imageUiScenarios(h);
  },
);
