import { ImageReferences } from "./ImageReferences.js";
import { Download, Plus } from "lucide-react";
import type { ImageJob } from "@zcode/shared/image-generation";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";
import { useImageWorkbenchDraft } from "@/hooks/useImageWorkbenchDraft.js";
import { ImageProviderSettings } from "./ImageProviderSettings.js";
import { ImageMaskEditor } from "./ImageMaskEditor.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ImageCanvas } from "./ImageCanvas.js";
import { ImageControls, imageControlClass } from "./ImageControls.js";

export function ImageWorkbench({
  sessionId,
  open,
  onOpenChange,
}: {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale } = useZCodeIntl();
  const zh = locale === "zh-CN";
  const {
    workbench,
    draft,
    change,
    selected,
    selectedId,
    comparison,
    comparisonId,
    setComparisonId,
    zoom,
    setZoom,
    notice,
    setNotice,
    now,
    jobs,
    settings,
    repaint,
    running,
    downloadUrl,
    busy,
    maskReady,
    maskEditor,
    setMaskReady,
    edit,
    upload,
    submit,
    remove,
    move,
    sessionImages,
    newImage,
    selectVersion,
    reuse,
    toggleReference,
  } = useImageWorkbenchDraft(sessionId, open, zh);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(92vh,900px)] w-[min(96vw,1280px)] max-w-none flex-col gap-3 overflow-hidden"
        data-testid="image-workbench"
      >
        <div className="pr-10">
          <DialogTitle className="text-ui-lg">{zh ? "图像画布" : "Image workbench"}</DialogTitle>
          <DialogDescription className="text-ui-caption">
            {zh
              ? "生成图片，保留版本，逐步调整。"
              : "Generate images, keep versions, refine your work."}
          </DialogDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={newImage}>
            <Plus className="size-4" />
            {zh ? "新建图像" : "New image"}
          </Button>
          <label className="flex items-center gap-2 text-ui-caption">
            <input
              disabled={busy}
              data-testid="image-enabled"
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) =>
                void workbench.configure({ ...settings, enabled: event.target.checked })
              }
            />
            {zh ? "启用生图" : "Enable images"}
          </label>
          <ImageProviderSettings
            key={sessionId}
            settings={settings}
            configure={workbench.configure}
            disabled={busy}
            zh={zh}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto md:flex-row">
          {/* 窄屏按内容高度排布，防止 flex 压缩让历史版本与调整面板重叠。 */}
          <div className="flex min-h-72 min-w-0 shrink-0 flex-col gap-3 md:flex-1">
            <div className="flex min-h-64 flex-1 gap-2">
              {repaint?.artifact ? (
                <ImageMaskEditor
                  key={repaint.id}
                  ref={maskEditor}
                  sessionId={sessionId}
                  artifact={repaint.artifact}
                  zoom={zoom}
                  zh={zh}
                  disabled={busy}
                  onReady={setMaskReady}
                />
              ) : (
                <ImageCanvas
                  sessionId={sessionId}
                  artifact={selectedId === "new" ? undefined : selected?.artifact}
                  pending={running && selectedId !== "new"}
                  size={selectedId === "new" ? draft.size : (selected?.input.size ?? draft.size)}
                  zoom={zoom}
                  label={
                    running
                      ? zh
                        ? `等待服务 · ${Math.max(0, Math.floor((now - (selected?.createdAt ?? now)) / 1000))} 秒`
                        : `Waiting for service · ${Math.max(0, Math.floor((now - (selected?.createdAt ?? now)) / 1000))}s`
                      : zh
                        ? "空白画布"
                        : "Blank canvas"
                  }
                />
              )}
              {comparison?.artifact && (
                <ImageCanvas
                  sessionId={sessionId}
                  artifact={comparison.artifact}
                  size={comparison.input.size}
                  zoom={zoom}
                  label={zh ? "对比版本" : "Comparison version"}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-ui-caption">
              <label>
                {zh ? "缩放" : "Zoom"}
                <input
                  className="ml-2 align-middle"
                  type="range"
                  aria-label={zh ? "缩放" : "Zoom"}
                  min={25}
                  max={200}
                  step={25}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
              </label>
              <span>{zoom}%</span>
              {selected?.artifact && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => edit(selected)}
                  >
                    {zh ? "继续调整" : "Refine"}
                  </Button>
                  {workbench.snapshot.capabilities?.maskEditing && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        edit(selected, true);
                        setComparisonId(undefined);
                      }}
                    >
                      {zh ? "涂抹重绘" : "Repaint area"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => reuse(selected)}
                  >
                    {zh ? "复用参数" : "Reuse parameters"}
                  </Button>
                  {downloadUrl && (
                    <a
                      className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5"
                      href={downloadUrl}
                      download={`${selected.id}.${selected.input.outputFormat === "png" ? "png" : "jpg"}`}
                    >
                      <Download className="size-4" />
                      {zh ? "下载" : "Download"}
                    </a>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const result = await workbench.exportImage(selected.artifact!);
                      if (result?.path) setNotice(result.path);
                    }}
                  >
                    {zh ? "导出到项目" : "Export to project"}
                  </Button>
                </>
              )}
            </div>
            <div
              className="flex gap-2 overflow-x-auto pb-1"
              aria-label={zh ? "历史版本" : "Versions"}
            >
              {jobs.map((job, index) => (
                <button
                  className={`shrink-0 rounded-md border px-3 py-2 text-ui-caption ${selected?.id === job.id ? "border-brand bg-accent" : "border-border"}`}
                  key={job.id}
                  disabled={busy}
                  onClick={() => selectVersion(job.id)}
                >
                  V{index + 1} · {statusLabel(job.status, zh)}
                </button>
              ))}
            </div>
            {jobs.filter((job) => job.artifact).length > 1 && (
              <select
                className={`${imageControlClass} max-w-60`}
                aria-label={zh ? "对比版本" : "Compare version"}
                value={comparisonId ?? ""}
                onChange={(event) => setComparisonId(event.target.value || undefined)}
              >
                <option value="">{zh ? "不显示对比" : "No comparison"}</option>
                {jobs.map(
                  (job, index) =>
                    job.artifact && (
                      <option key={job.id} value={job.id}>
                        V{index + 1} · {job.input.size}
                      </option>
                    ),
                )}
              </select>
            )}
            {selected?.artifact && (
              <p className="text-ui-caption text-foreground-subtle">
                {selected.artifact.width} × {selected.artifact.height} ·{" "}
                {selected.input.outputFormat.toUpperCase()} · {zh ? "种子" : "Seed"}{" "}
                {selected.input.seed}
              </p>
            )}
          </div>
          <div className="w-full shrink-0 space-y-4 md:w-80 md:overflow-y-auto">
            <fieldset disabled={busy} className="min-w-0">
              <ImageControls draft={draft} change={change} zh={zh} regional={Boolean(repaint)} />
            </fieldset>
            <ImageReferences
              sessionId={sessionId}
              references={draft.references}
              artifacts={[
                ...(workbench.snapshot.references ?? []),
                ...jobs.flatMap((job, index) =>
                  job.artifact ? [{ ...job.artifact, name: `V${index + 1}` }] : [],
                ),
              ]}
              sessionImages={sessionImages}
              lockedId={repaint?.id}
              toggle={toggleReference}
              busy={busy}
              zh={zh}
              upload={(files) => void upload(files)}
              move={move}
              remove={remove}
            />
            <Button
              className="w-full"
              data-testid="image-submit"
              disabled={
                !settings.enabled ||
                !settings.providerId ||
                busy ||
                !draft.prompt.trim() ||
                (Boolean(repaint) && !maskReady)
              }
              onClick={() => void submit()}
            >
              {draft.operation === "edit"
                ? zh
                  ? "应用调整"
                  : "Apply adjustment"
                : zh
                  ? "生成图片"
                  : "Generate image"}
            </Button>
            {running && (
              <Button
                className="w-full"
                variant="outline"
                onClick={() => selected && void workbench.cancel(selected)}
              >
                {zh ? "取消请求" : "Cancel request"}
              </Button>
            )}
            {(workbench.error || selected?.error) && (
              <p
                role="alert"
                className="rounded-md border border-destructive p-3 text-ui-caption text-destructive"
              >
                {workbench.error ?? `${selected?.error?.code}: ${selected?.error?.message}`}
              </p>
            )}
            {notice && (
              <p role="status" className="break-all text-ui-caption text-foreground-subtle">
                {notice}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function statusLabel(status: ImageJob["status"], zh: boolean): string {
  return zh
    ? {
        queued: "等待",
        running: "生成中",
        succeeded: "已完成",
        failed: "失败",
        cancelled: "已取消",
        interrupted: "已中断",
      }[status]
    : status;
}
