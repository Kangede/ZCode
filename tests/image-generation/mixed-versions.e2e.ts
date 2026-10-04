import assert from "node:assert/strict";
import test from "node:test";
import { resolve, join } from "node:path";
import { uiHarness } from "./ui-harness.js";

const baseline = process.env.ZCODE_IMAGE_TEST_BASELINE;
async function enterChat(page: Awaited<ReturnType<typeof uiHarness>>["page"]) {
  const composer = page.locator('[contenteditable="true"]');
  const api = page.getByRole("button", { name: /Use API key|使用 API key/i });
  await composer.or(api).first().waitFor();
  if (await api.isVisible()) {
    await api.click();
    await page.getByRole("button", { name: /Skip for now|暂时跳过/i }).click();
  }
  await composer.waitFor();
  return composer;
}

test(
  "new client connects to original Host without advertising unsupported image fields",
  { skip: !baseline, timeout: 120_000 },
  async (t) => {
    const h = await uiHarness("web", {
      server: join(resolve(baseline!), "packages/server/dist/entry-http.js"),
      agent: join(resolve(baseline!), "apps/zcode-cli/packages/cli/dist/zcode.cjs"),
    });
    t.after(() => h.close());
    t.diagnostic(`Evidence: ${h.directory}`);
    const composer = await enterChat(h.page);
    await composer.fill("Say hello for the compatibility check.");
    await h.page.getByTestId("v4-composer-send").click();
    await h.page.getByText("Image acceptance session", { exact: true }).last().waitFor();
    assert.equal(await h.page.getByTestId("image-workbench-open").count(), 0);
    assert.deepEqual(h.consoleErrors, []);
    await h.screenshot("new-client-old-host");
  },
);

test(
  "original client receives native image results as text and file references",
  { skip: !baseline, timeout: 120_000 },
  async (t) => {
    const h = await uiHarness("web", {
      webRoot: join(resolve(baseline!), "packages/web/dist"),
      nativeEnabled: true,
    });
    t.after(() => h.close());
    t.diagnostic(`Evidence: ${h.directory}`);
    const composer = await enterChat(h.page);
    await composer.fill("[native-image] Generate a 512x512 image of a red square.");
    await h.page.getByTestId("v4-composer-send").click();
    await h.page.getByText("Always allow in this project", { exact: true }).click();
    await h.page
      .getByText(/Generated image saved\./)
      .last()
      .waitFor();
    assert.equal(h.provider.requests.length, 1);
    assert.ok((await h.page.locator("body").innerText()).includes(".png"));
    assert.deepEqual(h.consoleErrors, []);
    assert.deepEqual(h.leakedCredentials, []);
    await h.screenshot("old-client-new-host");
  },
);
