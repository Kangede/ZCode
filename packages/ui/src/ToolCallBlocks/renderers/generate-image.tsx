import { useEffect } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useImageWorkbenchScope } from "@/image-generation/ImageWorkbenchScope.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ToolCallBlockRenderContext } from "../shared.js";

export function GenerateImageToolCallBlock(context: ToolCallBlockRenderContext) {
  const workbench = useImageWorkbenchScope();
  const { locale } = useZCodeIntl();
  const zh = locale === "zh-CN";
  const executing = context.toolCallNode.toolCall.status === "in_progress";
  useEffect(() => {
    // 授权等待也被通用 isRunning 包含；只在实际执行时打开，避免画布遮挡权限选择。
    if (executing) workbench?.open();
  }, [executing]);
  return (
    <div
      className="my-2 rounded-xl border border-border bg-surface p-3"
      data-testid="generate-image-tool"
    >
      <div className="flex items-center gap-2 text-ui-base">
        {context.isRunning ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <ImagePlus className="size-4" />
        )}
        <span>
          {context.isRunning
            ? zh
              ? "正在生成图片"
              : "Generating image"
            : zh
              ? "图像生成"
              : "Image generation"}
        </span>
        <span className="text-ui-caption text-foreground-subtle">{context.statusLabel}</span>
      </div>
      {context.errorText && (
        <p role="alert" className="mt-2 text-ui-caption text-destructive">
          {context.errorText}
        </p>
      )}
      {workbench && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => workbench.open()}>
          {zh ? "打开画布与调整面板" : "Open canvas and adjustments"}
        </Button>
      )}
    </div>
  );
}
