import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ChevronDown,
  Download,
  Image as ImageIcon,
  ImagePlus,
  MoreHorizontal,
  Plus,
  Scan,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { useImageWorkbenchDraft } from "@/hooks/useImageWorkbenchDraft.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ImageCanvasNavigation } from "./ImageCanvasNavigation.js";
import { ImageCanvas } from "./ImageCanvas.js";
import { ImageControls } from "./ImageControls.js";
import { ImageEditorButton } from "./ImageEditorButton.js";
import { ImageEditorPopover } from "./ImageEditorPopover.js";
import { ImageMaskEditor } from "./ImageMaskEditor.js";
import { ImagePromptComposer } from "./ImagePromptComposer.js";
import { ImageProviderSettings } from "./ImageProviderSettings.js";
import { ImageReferences } from "./ImageReferences.js";
import { ImageVersionStrip } from "./ImageVersionStrip.js";

type EditorPanel = "provider" | "parameters" | "references" | "comparison" | "more";

export function ImageWorkbench({
  sessionId,
  open,
  onOpenChange,
}: {
  sessionId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { locale } = useZCodeIntl();
  const zh = locale === "zh-CN";
  const d = useImageWorkbenchDraft(sessionId, open, zh);
  const [panel, setPanel] = useState<EditorPanel>();
  useEffect(() => setPanel(undefined), [sessionId, open]);
  const panelProps = (id: EditorPanel) => ({
    open: panel === id,
    // 关闭事件可能晚于另一个面板的打开事件，只收起当前事件所属的面板。
    onOpenChange: (next: boolean) =>
      setPanel((current) => (next ? id : current === id ? undefined : current)),
    zh,
    testId: `image-${id}-panel`,
  });
  const artifact = d.selectedId === "new" ? undefined : d.selected?.artifact;
  const artifacts = [...(d.workbench.snapshot.references ?? []), ...d.sessionImages];
  const draftReferences = d.draft.references.flatMap((id, index) => {
    const image = artifacts.find((item) => item.id === id);
    return image ? [{ artifact: image, position: index + 1 }] : [];
  });
  // 仅隐藏画布上正在显示的编辑目标；新建画布的参考图仍需展示。
  const composerReferences =
    artifact && d.draft.parentId === artifact.id
      ? draftReferences.filter((reference) => reference.artifact.id !== artifact.id)
      : draftReferences;
  const needsSetup = !d.settings.enabled || !d.settings.providerId;
  const disabled =
    needsSetup || d.busy || !d.draft.prompt.trim() || (Boolean(d.repaint) && !d.maskReady);
  const elapsed = Math.max(0, Math.floor((d.now - (d.selected?.createdAt ?? d.now)) / 1000));
  const canvasLabel = d.running
    ? zh
      ? `正在生成 · ${elapsed} 秒`
      : `Generating · ${elapsed}s`
    : artifact
      ? zh
        ? "生成的图像"
        : "Generated image"
      : zh
        ? "描述画面，开始创作"
        : "Describe an image to get started";
  const parameters = (
    <ImageEditorPopover
      {...panelProps("parameters")}
      title={zh ? "图像参数" : "Image parameters"}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="text-ui-sm text-foreground-subtle"
          data-testid="image-parameters-open"
        >
          <SlidersHorizontal className="size-3.5" />
          <span>{d.draft.size.replace("x", " × ")}</span>
          <span className="mx-1 text-foreground-subtlest">·</span>
          {d.draft.outputFormat.toUpperCase()}
        </Button>
      }
    >
      <fieldset disabled={d.busy} className="min-w-0">
        <ImageControls draft={d.draft} change={d.change} zh={zh} regional={Boolean(d.repaint)} />
      </fieldset>
    </ImageEditorPopover>
  );
  const references = (
    <ImageEditorPopover
      {...panelProps("references")}
      title={zh ? "参考图" : "References"}
      trigger={
        <ImageEditorButton
          label={zh ? "参考图" : "References"}
          data-testid="image-references-open"
          disabled={d.busy}
        >
          <ImagePlus />
        </ImageEditorButton>
      }
    >
      <ImageReferences
        key={sessionId}
        sessionId={sessionId}
        references={d.draft.references}
        artifacts={artifacts}
        sessionImages={d.sessionImages}
        lockedId={d.repaint?.id}
        toggle={d.toggleReference}
        busy={d.busy}
        zh={zh}
        upload={(files) => void d.upload(files)}
        move={d.move}
        remove={d.remove}
      />
    </ImageEditorPopover>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1600px] flex-col gap-0 overflow-hidden p-0"
        data-testid="image-workbench"
      >
        <TooltipProvider delayDuration={250}>
          <header className="z-20 flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 sm:gap-2 sm:px-5">
            <ImageIcon className="hidden size-4 shrink-0 text-foreground-subtle sm:block" />
            <DialogTitle className="whitespace-nowrap text-ui-base font-medium">
              {zh ? "图像画布" : "Image editor"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {zh
                ? "生成、选择和编辑会话中的图像"
                : "Generate, select and edit images in this conversation"}
            </DialogDescription>
            <span className="hidden text-ui-sm text-foreground-subtlest lg:inline">
              {artifact
                ? `${artifact.width} × ${artifact.height} · ${d.selected!.input.outputFormat.toUpperCase()}`
                : zh
                  ? "新的创作"
                  : "New creation"}
            </span>
            <div className="flex-1" />
            <ImageEditorPopover
              {...panelProps("provider")}
              title={zh ? "生图服务" : "Image provider"}
              side="bottom"
              trigger={
                <Button
                  variant="ghost"
                  size="lg"
                  className="min-w-0 gap-2 text-foreground-subtle"
                  data-testid="image-provider-settings"
                  aria-label={zh ? "生图服务设置" : "Image provider settings"}
                >
                  <Settings2 className="size-4" />
                  <span className="hidden max-w-40 truncate text-ui-sm sm:inline">
                    {d.settings.model}
                  </span>
                  <ChevronDown className="hidden size-3 sm:block" />
                </Button>
              }
            >
              <label className="flex items-center justify-between gap-3 text-ui-base">
                {zh ? "启用生图" : "Enable images"}
                <input
                  data-testid="image-enabled"
                  type="checkbox"
                  className="size-4 accent-foreground"
                  checked={d.settings.enabled}
                  disabled={d.busy}
                  onChange={(event) =>
                    void d.workbench.configure({ ...d.settings, enabled: event.target.checked })
                  }
                />
              </label>
              <ImageProviderSettings
                key={sessionId}
                settings={d.settings}
                configure={d.workbench.configure}
                disabled={d.busy}
                zh={zh}
              />
            </ImageEditorPopover>
            <span className="mx-1 h-5 border-l border-border" />
            <ImageEditorButton
              label={zh ? "新建图像" : "New image"}
              disabled={d.busy}
              onClick={d.newImage}
            >
              <Plus />
            </ImageEditorButton>
            {/* 新建画布时旧 URL 要等 effect 才清理，下载入口必须同时确认当前产物仍存在。 */}
            {artifact && d.downloadUrl && (
              <Button variant="ghost" size="icon-lg" asChild>
                <a
                  href={d.downloadUrl}
                  download={`${d.selected!.id}.${d.selected!.input.outputFormat === "png" ? "png" : "jpg"}`}
                  aria-label={zh ? "下载" : "Download"}
                  title={zh ? "下载" : "Download"}
                >
                  <Download />
                </a>
              </Button>
            )}
            {artifact && (
              <ImageEditorPopover
                {...panelProps("more")}
                title={zh ? "图像操作" : "Image actions"}
                side="bottom"
                trigger={
                  <ImageEditorButton
                    label={zh ? "更多操作" : "More actions"}
                    data-testid="image-more-open"
                  >
                    <MoreHorizontal />
                  </ImageEditorButton>
                }
              >
                <Button
                  variant="ghost"
                  className="justify-start"
                  disabled={d.busy}
                  onClick={() => {
                    d.reuse(d.selected!);
                    setPanel(undefined);
                  }}
                >
                  {zh ? "复用参数" : "Reuse parameters"}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start"
                  disabled={d.busy}
                  onClick={async () => {
                    const result = await d.workbench.exportImage(artifact);
                    if (result?.path) d.setNotice(result.path);
                    setPanel(undefined);
                  }}
                >
                  <ArrowDownToLine />
                  {zh ? "导出到项目" : "Export to project"}
                </Button>
              </ImageEditorPopover>
            )}
            <DialogClose asChild>
              <ImageEditorButton label={zh ? "关闭画布" : "Close canvas"}>
                <X />
              </ImageEditorButton>
            </DialogClose>
          </header>
          <section
            className="flex min-h-0 flex-1 flex-col bg-background-alt"
            aria-label={zh ? "编辑画布" : "Editing canvas"}
          >
            {artifact && !d.repaint && (
              <div
                className="z-10 flex shrink-0 items-center justify-center gap-1 px-3 pt-3"
                data-testid="image-edit-mode"
              >
                <Button
                  size="lg"
                  variant={d.draft.operation === "edit" && !d.repaint ? "secondary" : "ghost"}
                  disabled={d.busy}
                  onClick={() => d.edit(d.selected!)}
                >
                  <Sparkles className="size-3.5" />
                  {zh ? "继续调整" : "Refine"}
                </Button>
                {d.workbench.snapshot.capabilities?.maskEditing && (
                  <Button
                    size="lg"
                    variant={d.repaint ? "secondary" : "ghost"}
                    disabled={d.busy}
                    onClick={() => {
                      d.edit(d.selected!, true);
                      d.setComparisonId(undefined);
                    }}
                  >
                    <Scan className="size-3.5" />
                    {zh ? "涂抹重绘" : "Repaint area"}
                  </Button>
                )}
              </div>
            )}
            <div
              className="relative flex min-h-0 flex-1 gap-3 p-2 sm:px-8 sm:py-3"
              data-testid="image-stage"
            >
              {d.repaint?.artifact ? (
                <ImageMaskEditor
                  key={d.repaint.id}
                  ref={d.maskEditor}
                  sessionId={sessionId}
                  artifact={d.repaint.artifact}
                  zoom={d.zoom}
                  zh={zh}
                  disabled={d.busy}
                  onReady={d.setMaskReady}
                  onExit={d.stopRepaint}
                />
              ) : (
                <ImageCanvas
                  sessionId={sessionId}
                  artifact={artifact}
                  pending={d.running}
                  size={
                    d.selectedId === "new" ? d.draft.size : (d.selected?.input.size ?? d.draft.size)
                  }
                  zoom={d.zoom}
                  label={canvasLabel}
                />
              )}
              {d.comparison?.artifact && (
                <ImageCanvas
                  sessionId={sessionId}
                  artifact={d.comparison.artifact}
                  size={d.comparison.input.size}
                  zoom={d.zoom}
                  label={zh ? "对比版本" : "Comparison version"}
                />
              )}
            </div>
            <ImageCanvasNavigation
              zoom={d.zoom}
              setZoom={d.setZoom}
              jobs={d.jobs}
              comparisonId={d.comparisonId}
              setComparisonId={d.setComparisonId}
              zh={zh}
              popoverProps={panelProps("comparison")}
            />
          </section>
          <ImageVersionStrip
            sessionId={sessionId}
            jobs={d.jobs}
            selectedId={d.selected?.id}
            busy={d.busy}
            zh={zh}
            select={d.selectVersion}
          />
          {(d.workbench.error || d.selected?.error || d.notice) && (
            <div className="mx-auto max-h-16 w-full max-w-2xl shrink-0 overflow-auto px-4 pb-2 text-ui-sm">
              {d.workbench.error || d.selected?.error ? (
                <p role="alert" className="text-destructive">
                  {d.workbench.error ?? d.selected?.error?.message}
                </p>
              ) : (
                <p role="status" className="break-all text-foreground-subtle">
                  {d.notice}
                </p>
              )}
            </div>
          )}
          <ImagePromptComposer
            sessionId={sessionId}
            prompt={d.draft.prompt}
            change={(prompt) => d.change({ prompt })}
            references={composerReferences}
            submit={() => void d.submit()}
            disabled={disabled}
            busy={d.busy}
            running={d.running}
            cancel={() => d.selected && void d.workbench.cancel(d.selected)}
            edit={d.draft.operation === "edit"}
            regional={Boolean(d.repaint)}
            zh={zh}
            openReferences={() => setPanel("references")}
            openSettings={() => setPanel("provider")}
            needsSetup={needsSetup}
            referenceControl={references}
            parameterControl={parameters}
          />
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
