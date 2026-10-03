import { ImageReferences } from "./ImageReferences.js";
import { useEffect, useState } from "react";
import { Download, Plus } from "lucide-react";
import {
  imageGenerationSettingsSchema,
  type ImageGenerationInput,
  type ImageJob,
} from "@zcode/shared/image-generation";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";
import {
  useImageArtifactUrl,
  useImageWorkbench,
  useLatestAgentImage,
} from "@/hooks/useImageWorkbench.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ImageCanvas } from "./ImageCanvas.js";
import { ImageControls, imageControlClass } from "./ImageControls.js";

const freshDraft = (): ImageGenerationInput => ({
  operation: "generate",
  prompt: "",
  references: [],
  size: "1024x1024",
  outputFormat: "png",
  guidanceScale: 1,
});

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
  const workbench = useImageWorkbench(sessionId, open);
  const providers = useProviderSettingsView();
  const [draft, setDraft] = useState<ImageGenerationInput>(freshDraft);
  const [selectedId, setSelectedId] = useState<string>();
  const [comparisonId, setComparisonId] = useState<string>();
  const [zoom, setZoom] = useState(100);
  const [modelDraft, setModelDraft] = useState("Qwen-Image-2.1");
  const [notice, setNotice] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const jobs = workbench.snapshot.jobs ?? [];
  useLatestAgentImage(jobs, sessionId, setSelectedId);
  const selected =
    selectedId === "new" ? undefined : (jobs.find((job) => job.id === selectedId) ?? jobs.at(-1));
  const comparison = jobs.find((job) => job.id === comparisonId);
  const settings = workbench.snapshot.settings ?? imageGenerationSettingsSchema.parse({});
  useEffect(() => setModelDraft(settings.model), [settings.model]);
  const running = selected?.status === "queued" || selected?.status === "running";
  const { url: downloadUrl } = useImageArtifactUrl(
    sessionId,
    open ? selected?.artifact : undefined,
  );
  const change = (patch: Partial<ImageGenerationInput>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice(undefined);
  };
  useEffect(() => {
    setDraft(freshDraft());
    setSelectedId(undefined);
    setComparisonId(undefined);
  }, [sessionId]);
  useEffect(() => {
    if (!open || !running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, running]);
  const edit = (job: ImageJob) => {
    setDraft({
      ...job.input,
      operation: "edit",
      prompt: "",
      parentId: job.id,
      references: [job.id],
      seed: undefined,
      background: job.input.background ?? "auto",
    });
    setSelectedId(job.id);
  };
  const upload = async (files: FileList | File[]) => {
    const remaining = 5 - draft.references.length;
    if (files.length > remaining) {
      setNotice(
        zh
          ? "最多五张参考图，编辑目标也计入限制。"
          : "At most five references, including the edit target.",
      );
      return;
    }
    const added: string[] = [];
    for (const file of Array.from(files)) {
      const artifact = await workbench.upload(file);
      if (artifact) added.push(artifact.id);
    }
    if (added.length)
      setDraft((current) => ({
        ...current,
        operation: "edit",
        references: [...current.references, ...added],
      }));
  };
  const submit = async () => {
    const job = await workbench.submit(draft);
    if (job) {
      setSelectedId(job.id);
      setNotice(undefined);
    }
  };
  const move = (index: number, delta: number) => {
    const references = [...draft.references];
    const other = index + delta;
    if (other < 0 || other >= references.length) return;
    [references[index], references[other]] = [references[other]!, references[index]!];
    change({ references });
  };
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(freshDraft());
              setSelectedId("new");
              setComparisonId(undefined);
            }}
          >
            <Plus className="size-4" />
            {zh ? "新建图像" : "New image"}
          </Button>
          <label className="flex items-center gap-2 text-ui-caption">
            <input
              data-testid="image-enabled"
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) =>
                void workbench.configure({ ...settings, enabled: event.target.checked })
              }
            />
            {zh ? "启用生图" : "Enable images"}
          </label>
          <select
            className={`${imageControlClass} max-w-56`}
            aria-label={zh ? "生图服务" : "Image provider"}
            value={settings.providerId ?? ""}
            onChange={(event) =>
              void workbench.configure({ ...settings, providerId: event.target.value || undefined })
            }
          >
            <option value="">{zh ? "跟随当前会话" : "Current conversation provider"}</option>
            {providers.state.status === "ready" &&
              providers.state.view.providers
                .filter((provider) => provider.executable)
                .map((provider) => (
                  <option key={provider.providerId} value={provider.providerId}>
                    {provider.providerName ?? provider.providerId}
                  </option>
                ))}
          </select>
          <input
            className={`${imageControlClass} max-w-48`}
            aria-label={zh ? "生图模型" : "Image model"}
            value={modelDraft}
            onChange={(event) => setModelDraft(event.target.value)}
            onBlur={(event) => {
              if (event.target.value.trim())
                void workbench.configure({ ...settings, model: event.target.value.trim() });
            }}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto md:flex-row">
          {/* 窄屏按内容高度排布，防止 flex 压缩让历史版本与调整面板重叠。 */}
          <div className="flex min-h-72 min-w-0 shrink-0 flex-col gap-3 md:flex-1">
            <div className="flex min-h-64 flex-1 gap-2">
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
                  <Button variant="outline" size="sm" onClick={() => edit(selected)}>
                    {zh ? "继续调整" : "Refine"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      change({ ...selected.input, references: [...selected.input.references] })
                    }
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
                  onClick={() => setSelectedId(job.id)}
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
            <ImageControls draft={draft} change={change} zh={zh} />
            <ImageReferences
              sessionId={sessionId}
              references={draft.references}
              artifacts={[
                ...(workbench.snapshot.references ?? []),
                ...jobs.flatMap((job, index) =>
                  job.artifact ? [{ ...job.artifact, name: `V${index + 1}` }] : [],
                ),
              ]}
              busy={workbench.pending}
              zh={zh}
              upload={(files) => void upload(files)}
              move={move}
              remove={(index) => {
                const id = draft.references[index];
                const references = draft.references.filter((_, i) => i !== index);
                change({
                  references,
                  parentId: draft.parentId === id ? undefined : draft.parentId,
                  operation: references.length ? "edit" : "generate",
                });
              }}
            />
            <Button
              className="w-full"
              data-testid="image-submit"
              disabled={!settings.enabled || workbench.pending || !draft.prompt.trim()}
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
