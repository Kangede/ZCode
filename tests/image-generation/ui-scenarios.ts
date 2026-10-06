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
  await page.getByRole("button", { name: "Add image provider", exact: true }).click();
  await page.getByLabel("Image provider name", { exact: true }).fill("Independent Qwen");
  await page
    .getByLabel("Image provider URL", { exact: true })
    .fill(`http://127.0.0.1:${h.provider.port}/v1`);
  await page.getByLabel("Image provider API key", { exact: true }).fill("fixture-image-secret");
  await page.getByRole("button", { name: "Save image provider", exact: true }).click();
  await page.getByTestId("image-provider-form").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Configure provider", exact: true }).click();
  assert.equal(await page.getByLabel("Image provider API key", { exact: true }).inputValue(), "");
  await page.getByLabel("Image provider name", { exact: true }).fill("Independent Qwen saved");
  await page.getByRole("button", { name: "Save image provider", exact: true }).click();
  await page.getByTestId("image-provider-form").waitFor({ state: "hidden" });
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
  await conversationReferenceAndRepaint(h, original);
  await page.getByTestId("image-prompt").fill("Next image draft");
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
  await page.getByRole("button", { name: "Repaint area", exact: true }).click();
  const touchCanvas = page.getByTestId("image-mask-canvas");
  await touchCanvas.scrollIntoViewIfNeeded();
  const touchBox = (await touchCanvas.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.getByTestId("image-prompt").fill("Touch selection draft");
  await page.waitForFunction(
    () => !(document.querySelector('[data-testid="image-submit"]') as HTMLButtonElement)?.disabled,
  );
  await touchCanvas.scrollIntoViewIfNeeded();
  await h.screenshot("mobile-touch-selection");
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="image-submit"]') as HTMLButtonElement)?.disabled,
  );
  await cdp.detach();
  assert.equal(
    h.browserRequests.some((url) => url.includes(`:${h.provider.port}/`)),
    false,
    "upstream requests belong on the host",
  );
  assert.deepEqual(h.leakedCredentials, [], "upstream secrets must remain on the Host");
  assert.deepEqual(h.consoleErrors, [], "fresh renderer must have no uncaught errors");
  assert.equal(
    h.chatProvider.requests.length,
    0,
    "image jobs must never use the conversation provider",
  );
}

async function conversationReferenceAndRepaint(
  h: Awaited<ReturnType<typeof uiHarness>>,
  original: Buffer,
) {
  const { page } = h;
  await page.getByRole("button", { name: "New image", exact: true }).click();
  await page.getByRole("button", { name: "Choose from conversation", exact: true }).click();
  await page.getByRole("button", { name: "Select V3", exact: true }).click();
  await page.getByRole("button", { name: "Select V1", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Select V4", exact: true }).count(), 0);
  await page.getByText("Picture 1: V3", { exact: true }).waitFor();
  await page.getByText("Picture 2: V1", { exact: true }).waitFor();
  await page.getByTestId("image-size").fill("512x512");
  await page.getByTestId("image-prompt").fill("Use Picture 1 with Picture 2 as a color reference");
  await h.screenshot("conversation-references");
  await page.getByTestId("image-submit").click();
  await page.getByRole("button", { name: "V7 · succeeded", exact: true }).waitFor();
  assert.equal(h.provider.requests[6]!.references.length, 2);
  assert.equal(
    h.provider.requests[6]!.references[1],
    createHash("sha256").update(original).digest("hex"),
  );
  await page.getByRole("button", { name: "V1 · succeeded", exact: true }).click();
  await page.getByRole("button", { name: "Repaint area", exact: true }).click();
  await page.getByTestId("image-prompt").fill("Make only the selected part blue");
  assert.equal(await page.getByTestId("image-size").isDisabled(), true);
  assert.equal(await page.getByTestId("image-submit").isDisabled(), true);
  const canvas = page.getByTestId("image-mask-canvas");
  await canvas.waitFor();
  await canvas.focus();
  await page.keyboard.press("Space");
  await page.getByLabel("Brush size", { exact: true }).fill("16");
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await canvas.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="image-submit"]') as HTMLButtonElement)?.disabled,
  );
  await page.getByRole("button", { name: "Undo stroke", exact: true }).click();
  await page.waitForFunction(
    () => !(document.querySelector('[data-testid="image-submit"]') as HTMLButtonElement)?.disabled,
  );
  await page.getByRole("button", { name: "Undo stroke", exact: true }).click();
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="image-submit"]') as HTMLButtonElement)?.disabled,
  );
  assert.equal(await page.getByTestId("image-submit").isDisabled(), true);
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await page.getByLabel("Zoom", { exact: true }).fill("75");
  await page.getByLabel("Brush size", { exact: true }).fill("10");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up();
  await h.screenshot("painted-selection");
  assert.equal(
    await page.getByRole("button", { name: "Picture 1 remove", exact: true }).isDisabled(),
    true,
  );
  await page.getByTestId("image-submit").click();
  await page.getByRole("button", { name: "V8 · succeeded", exact: true }).waitFor();
  const repainted = await Jimp.read(await h.downloadedBytes());
  const source = await Jimp.read(original);
  assert.equal(repainted.getPixelColor(256, 256), 0x2255ddff);
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      if (x >= 170 && x <= 340 && y >= 220 && y <= 292) continue;
      assert.equal(
        repainted.getPixelColor(x, y),
        source.getPixelColor(x, y),
        `Unselected pixel ${x},${y}`,
      );
    }
  await h.screenshot("repaint-completed");
  await page.reload();
  await page.getByTestId("image-workbench-open").click();
  await page.getByRole("button", { name: "V8 · succeeded", exact: true }).waitFor();
  assert.equal(h.provider.requests.length, 8);
  assert.equal(
    await page.getByLabel("Image provider", { exact: true }).locator("option:checked").innerText(),
    "Independent Qwen saved",
  );
}
