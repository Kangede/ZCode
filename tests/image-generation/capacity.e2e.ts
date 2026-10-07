import assert from "node:assert/strict";
import test from "node:test";
import { fixtureImage } from "./fixtures.js";
import { uiHarness } from "./ui-harness.js";
import { showEditorPanel, closeEditorPanel, setImageSize } from "./editor-panels.js";

for (const surface of ["web", "desktop"] as const)
  test(
    `${surface} changing output size blocks excess references without discarding the draft`,
    { timeout: 150_000 },
    async (t) => {
      const h = await uiHarness(surface, { locale: "zh-CN", nativeEnabled: true });
      t.after(() => h.close());
      t.diagnostic(`Evidence: ${h.directory}`);
      const { page } = h;
      const entry = page.getByTestId("image-workbench-open");
      const api = page.getByRole("button", { name: /使用 API key|Use API key/i });
      await entry.or(api).first().waitFor();
      if (await api.isVisible()) {
        await api.click();
        await page.getByRole("button", { name: /暂时跳过|Skip for now/i }).click();
      }
      await entry.click();
      await page.getByRole("heading", { name: "图像画布", exact: true }).waitFor();
      const png = Buffer.from((await fixtureImage()).bytes);
      await showEditorPanel(page, "references");
      await page.getByTestId("image-reference-input").setInputFiles([
        { name: "first.png", mimeType: "image/png", buffer: png },
        { name: "second.png", mimeType: "image/png", buffer: png },
        { name: "third.png", mimeType: "image/png", buffer: png },
        { name: "fourth.png", mimeType: "image/png", buffer: png },
        { name: "fifth.png", mimeType: "image/png", buffer: png },
      ]);
      await page.getByText("参考图 5: fifth.png", { exact: true }).waitFor();
      await closeEditorPanel(page, "references");
      await page.getByTestId("image-prompt").fill("将茶壶改成蓝色");
      for (const [size, limit] of [
        ["1536x1536", 5],
        ["1792x1792", 3],
        ["2048x2048", 2],
      ] as const) {
        await setImageSize(page, size);
        if (limit < 5)
          await page
            .getByRole("status")
            .filter({ hasText: `${size} 最多支持 ${limit}` })
            .waitFor();
        assert.equal(await page.getByTestId("image-submit").isDisabled(), limit < 5);
        await showEditorPanel(page, "parameters");
        assert.match(
          await page.getByTestId("image-reference-limit").innerText(),
          new RegExp(`最多 ${limit} 张`),
        );
        await closeEditorPanel(page, "parameters");
        if (limit < 5) await page.getByTestId("image-prompt").press("Control+Enter");
      }
      assert.equal(h.provider.requests.length, 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await h.screenshot("capacity-blocked-mobile");
      await showEditorPanel(page, "references");
      assert.equal(
        await page.getByRole("button", { name: "添加", exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await page.getByRole("button", { name: "Picture 2 移除", exact: true }).isEnabled(),
        true,
      );
      await closeEditorPanel(page, "references");
      await setImageSize(page, "1024x1024");
      assert.equal(await page.getByTestId("image-submit").isEnabled(), true);
      assert.equal(await page.getByTestId("image-prompt").inputValue(), "将茶壶改成蓝色");
      await showEditorPanel(page, "references");
      await page.getByText("参考图 5: fifth.png", { exact: true }).waitFor();
      await closeEditorPanel(page, "references");
      await page.getByTestId("image-submit").click();
      await page.getByRole("button", { name: "V1 · 已完成", exact: true }).waitFor();
      assert.equal(h.provider.requests.length, 1);
      assert.equal(h.provider.requests[0]!.references.length, 5);
      await h.screenshot("capacity-recovered");
      await showEditorPanel(page, "references");
      for (const position of [5, 4, 3])
        await page.getByRole("button", { name: `Picture ${position} 移除`, exact: true }).click();
      await closeEditorPanel(page, "references");
      await setImageSize(page, "2048x2048");
      assert.equal(await page.getByTestId("image-submit").isEnabled(), true);
      await page.getByTestId("image-submit").click();
      await page.getByRole("button", { name: "V2 · 已完成", exact: true }).waitFor();
      assert.equal(h.provider.requests.length, 2);
      assert.equal(h.provider.requests[1]!.references.length, 2);
      assert.equal(h.provider.requests[1]!.fields.size, "2048x2048");
      await page.getByTestId("image-result").waitFor();
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('[data-testid="image-result"]');
        return image?.complete && image.naturalWidth > 0;
      });
      await page.getByRole("button", { name: "V2 · 已完成", exact: true }).locator("img").waitFor();
      await h.screenshot("capacity-high-boundary");
      assert.deepEqual(h.consoleErrors, []);
    },
  );
