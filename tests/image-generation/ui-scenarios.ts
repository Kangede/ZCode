import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Jimp } from "jimp";
import { fixtureImage } from "./fixtures.js";
import type { uiHarness } from "./ui-harness.js";

export async function imageUiScenarios(h: Awaited<ReturnType<typeof uiHarness>>) {
  const { page } = h;
  const dialog = page.getByTestId("image-workbench");
  const start = page.getByTestId("image-workbench-open");
  const api = page.getByRole("button", { name: /Use API key|使用 API key/i });
  await start.or(api).first().waitFor();
  if (await api.isVisible()) {
    await api.click();
    await page.getByRole("button", { name: /Skip for now|暂时跳过/i }).click();
  }
  await page.getByTestId("image-workbench-open").click();
  await dialog.waitFor();
  const enabled = page.getByTestId("image-enabled");
  if (!(await enabled.isChecked())) await enabled.click();
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="image-enabled"]') as HTMLInputElement)?.checked,
  );
  await h.screenshot("blank");
  await page.getByTestId("image-size").fill("512x512");
  await page.getByTestId("image-prompt").fill("Fixture red square on a cream background");
  await page.getByTestId("image-submit").click();
  await page.getByRole("button", { name: "Cancel request", exact: true }).waitFor();
  await h.screenshot("running");
  await page.reload();
  await page.getByTestId("image-workbench-open").click();
  await page.getByRole("button", { name: "V1 · succeeded", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-testid="image-result"]') as HTMLImageElement)?.naturalWidth ===
      512,
  );
  await h.screenshot("completed");
  assert.equal(h.provider.requests.length, 1);
  const original = await h.downloadedBytes();
  assert.equal((await Jimp.read(original)).bitmap.width, 512);
  await page.getByRole("button", { name: "Export to project", exact: true }).click();
  await dialog.getByRole("status").waitFor();
  await page.getByRole("button", { name: "Refine", exact: true }).click();
  const reference = await fixtureImage(true);
  await page.getByTestId("image-reference-input").setInputFiles({
    name: "alpha-reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(reference.bytes),
  });
  await page.getByText("Picture 2: alpha-reference.png", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Picture 2 move up", exact: true }).click();
  await page.getByTestId("image-prompt").fill("Make the square blue, keeping the cream background");
  await dialog.locator('img[alt="Picture 1"]').waitFor();
  await dialog.locator('img[alt="Picture 2"]').waitFor();
  await h.screenshot("adjustment");
  await page.getByTestId("image-submit").click();
  await page.getByRole("button", { name: "V2 · succeeded", exact: true }).waitFor();
  assert.deepEqual(h.provider.requests[1]!.references, [
    createHash("sha256").update(reference.bytes).digest("hex"),
    createHash("sha256").update(original).digest("hex"),
  ]);
  await page.getByLabel("Compare version", { exact: true }).selectOption({ label: "V1 · 512x512" });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="image-result"]')].length === 2 &&
      [...document.querySelectorAll('[data-testid="image-result"]')].every(
        (i) => (i as HTMLImageElement).naturalWidth === 512,
      ),
  );
  await h.screenshot("comparison");
  await dialog.getByRole("button", { name: "New image", exact: true }).click();
  await page.getByTestId("image-size").fill("512x512");
  await page.getByTestId("image-prompt").fill("Transparent square sticker");
  await page.getByTestId("image-transparent").click();
  await page.getByTestId("image-submit").click();
  await page.getByRole("button", { name: "V3 · succeeded", exact: true }).waitFor();
  const rgba = await Jimp.read(await h.downloadedBytes());
  assert.equal(rgba.bitmap.data[3], 0);
  assert.equal(rgba.bitmap.data[(256 * 512 + 256) * 4 + 3], 255);
  await h.screenshot("transparent");
  await dialog.getByRole("button", { name: "New image", exact: true }).click();
  await page.getByTestId("image-size").fill("512x512");
  await page.getByTestId("image-prompt").fill("[fail403] forbidden fixture");
  await page.getByTestId("image-submit").click();
  await page.getByRole("alert").filter({ hasText: "HTTP 403" }).waitFor();
  assert.equal((await dialog.innerText()).includes("fixture-only-secret"), false);
  await h.screenshot("failed");
  await page.getByTestId("image-prompt").fill("Explicit retry after failure");
  await page.getByTestId("image-submit").click();
  await page.getByRole("button", { name: "V5 · succeeded", exact: true }).waitFor();
  await page.reload();
  await page.getByTestId("image-workbench-open").click();
  await page.getByRole("button", { name: "V5 · succeeded", exact: true }).waitFor();
  assert.equal(h.provider.requests.length, 5, "reload must never repeat a POST");
  await h.screenshot("recovered");
  await dialog.getByRole("button", { name: "New image", exact: true }).click();
  await page.getByTestId("image-prompt").fill("[hold] cancellation test");
  await page.getByTestId("image-size").fill("512x512");
  await page.getByTestId("image-submit").click();
  await page.getByRole("button", { name: "Cancel request", exact: true }).click();
  await page.getByRole("button", { name: "V6 · cancelled", exact: true }).waitFor();
  await h.screenshot("cancelled");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-testid="image-workbench"]')?.getBoundingClientRect();
    return (
      box &&
      box.left >= 0 &&
      box.right <= innerWidth &&
      !document.documentElement.classList.contains("dark")
    );
  });
  const history = await page.getByLabel("Versions", { exact: true }).boundingBox();
  const prompt = await page.getByTestId("image-prompt").boundingBox();
  assert.ok(
    history && prompt && prompt.y >= history.y + history.height,
    "mobile parameters must follow history without overlap",
  );
  await page.getByTestId("image-prompt").focus();
  await page.keyboard.press("Tab");
  await h.screenshot("mobile-light-keyboard");
  assert.ok(await page.getByTestId("image-submit").isEnabled());
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 2),
    false,
    "narrow dialog must not overflow horizontally",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await h.screenshot("mobile-dark");
  assert.equal(
    h.browserRequests.some((url) => url.includes(`:${h.provider.port}/`)),
    false,
    "upstream requests belong on the host",
  );
  assert.deepEqual(h.leakedCredentials, [], "upstream secrets must remain on the Host");
  assert.deepEqual(h.consoleErrors, [], "fresh renderer must have no uncaught errors");
}
