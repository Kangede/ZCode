import type { Page } from "playwright-core";

const triggers = {
  provider: "image-provider-settings",
  parameters: "image-parameters-open",
  references: "image-references-open",
  comparison: "image-comparison-open",
  more: "image-more-open",
} as const;
export async function showEditorPanel(page: Page, panel: keyof typeof triggers) {
  const content = page.getByTestId(`image-${panel}-panel`);
  if (!(await content.isVisible())) await page.getByTestId(triggers[panel]).click();
  await content.waitFor();
}
export async function closeEditorPanel(page: Page, panel: keyof typeof triggers) {
  await page
    .getByTestId(`image-${panel}-panel`)
    .getByRole("button", { name: /^(Close panel|关闭面板)$/ })
    .click();
  await page.getByTestId(`image-${panel}-panel`).waitFor({ state: "hidden" });
  await page.getByTestId("image-workbench").waitFor();
}
export async function setImageSize(page: Page, size: string) {
  await showEditorPanel(page, "parameters");
  await page.getByTestId("image-size").fill(size);
  await closeEditorPanel(page, "parameters");
}
