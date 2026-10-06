import assert from "node:assert/strict";
import test from "node:test";
import { uiHarness } from "./ui-harness.js";
import { showEditorPanel, closeEditorPanel, setImageSize } from "./editor-panels.js";

for (const surface of ["web", "desktop"] as const)
  test(
    `${surface} Chinese canvas keeps editing controls visible and preserves selections across panels`,
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
      assert.equal(await page.getByTestId("image-provider-panel").count(), 0);
      assert.equal(await page.getByTestId("image-parameters-panel").count(), 0);
      await showEditorPanel(page, "provider");
      await page.getByRole("button", { name: "添加生图服务", exact: true }).waitFor();
      await page
        .getByTestId("image-provider-panel")
        .getByRole("button", { name: "关闭面板", exact: true })
        .focus();
      await page.keyboard.press("Escape");
      await page.getByTestId("image-provider-panel").waitFor({ state: "hidden" });
      await setImageSize(page, "512x512");
      await page.getByTestId("image-prompt").fill("米色背景上的红色方块");
      await page.getByTestId("image-submit").click();
      await page.getByRole("button", { name: "V1 · 已完成", exact: true }).waitFor();
      await page.getByRole("button", { name: "V1 · 已完成", exact: true }).locator("img").waitFor();
      assert.equal(
        await page.getByRole("button", { name: "V1 · 已完成", exact: true }).locator("img").count(),
        1,
      );
      await page.getByRole("button", { name: "涂抹重绘", exact: true }).click();
      const canvas = page.getByTestId("image-mask-canvas");
      await canvas.focus();
      await page.keyboard.press("Space");
      await page.getByTestId("image-prompt").fill("只将选中的部分改成蓝色");
      const pixels = () =>
        canvas.evaluate(
          (element: HTMLCanvasElement) =>
            [
              ...element.getContext("2d")!.getImageData(0, 0, element.width, element.height).data,
            ].filter((value, index) => index % 4 === 3 && value > 0).length,
        );
      const before = await pixels();
      assert.ok(before > 0);
      await showEditorPanel(page, "parameters");
      assert.equal(await page.getByTestId("image-size").isDisabled(), true);
      await closeEditorPanel(page, "parameters");
      assert.equal(await pixels(), before, "settings must not discard a painted selection");
      await page.getByRole("button", { name: "返回全图调整", exact: true }).click();
      await canvas.waitFor({ state: "hidden" });
      assert.equal(await page.getByTestId("image-prompt").inputValue(), "只将选中的部分改成蓝色");
      await page.getByRole("button", { name: "涂抹重绘", exact: true }).click();
      await canvas.waitFor();
      await canvas.focus();
      await page.keyboard.press("Space");
      await page.getByTestId("image-prompt").fill("只将选中的部分改成蓝色");
      await h.screenshot("chinese-editor-wide");
      await page.setViewportSize({ width: 390, height: 844 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction(
          (dark) => document.documentElement.classList.contains("dark") === dark,
          theme === "dark",
        );
        await page.waitForFunction(() => {
          const box = document
            .querySelector('[data-testid="image-submit"]')
            ?.getBoundingClientRect();
          return (
            box &&
            box.left >= 0 &&
            box.right <= innerWidth &&
            box.top >= 0 &&
            box.bottom <= innerHeight
          );
        });
        const submit = (await page.getByTestId("image-submit").boundingBox())!;
        assert.ok(
          submit.x >= 0 &&
            submit.x + submit.width <= 390 &&
            submit.y >= 0 &&
            submit.y + submit.height <= 844,
          "primary action stays in the mobile viewport",
        );
        assert.equal(
          await page
            .getByTestId("image-workbench")
            .evaluate((el) => el.scrollWidth > el.clientWidth + 2),
          false,
        );
        const stage = (await page.getByTestId("image-stage").boundingBox())!;
        assert.ok(stage.height > 180, "canvas retains usable space above the composer");
        await h.screenshot(`chinese-editor-mobile-${theme}`);
      }
      await showEditorPanel(page, "references");
      await page.getByRole("button", { name: "从会话图片选择", exact: true }).click();
      const panel = (await page.getByTestId("image-references-panel").boundingBox())!;
      assert.ok(
        panel.x >= 0 &&
          panel.x + panel.width <= 390 &&
          panel.y >= 0 &&
          panel.y + panel.height <= 844,
      );
      await h.screenshot("chinese-reference-picker");
      await closeEditorPanel(page, "references");
      await page.getByTestId("image-submit").click();
      await page.getByRole("button", { name: "V2 · 已完成", exact: true }).waitFor();
      assert.equal(h.provider.requests.length, 2);
      assert.deepEqual(h.consoleErrors, []);
    },
  );
