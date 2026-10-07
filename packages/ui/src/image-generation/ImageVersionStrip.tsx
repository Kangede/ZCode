import { useEffect, useRef } from "react";
import { Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import type { ImageJob } from "@zcode/shared/image-generation";
import { useImageArtifactUrl } from "@/hooks/useImageWorkbench.js";

export function imageJobStatus(status: ImageJob["status"], zh: boolean) {
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

export function ImageVersionStrip({
  jobs,
  sessionId,
  selectedId,
  busy,
  zh,
  select,
}: {
  jobs: ImageJob[];
  sessionId: string;
  selectedId?: string;
  busy: boolean;
  zh: boolean;
  select(id: string): void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const selected = strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (selected && strip.current)
      strip.current.scrollLeft =
        selected.offsetLeft - (strip.current.clientWidth - selected.offsetWidth) / 2;
  }, [selectedId]);
  if (!jobs.length) return null;
  return (
    <div className="flex shrink-0 justify-center px-4 py-2" data-testid="image-version-strip">
      <div
        ref={strip}
        className="relative flex max-w-full gap-2 overflow-x-auto p-1"
        aria-label={zh ? "历史版本" : "Versions"}
      >
        {jobs.map((job, index) => (
          <Version
            key={job.id}
            sessionId={sessionId}
            job={job}
            index={index}
            selected={selectedId === job.id}
            busy={busy}
            zh={zh}
            onClick={() => select(job.id)}
          />
        ))}
      </div>
    </div>
  );
}

function Version({
  sessionId,
  job,
  index,
  selected,
  busy,
  zh,
  onClick,
}: {
  sessionId: string;
  job: ImageJob;
  index: number;
  selected: boolean;
  busy: boolean;
  zh: boolean;
  onClick(): void;
}) {
  const { url } = useImageArtifactUrl(sessionId, job.artifact, "reference");
  const pending = job.status === "running" || job.status === "queued";
  const label = `V${index + 1} · ${imageJobStatus(job.status, zh)}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={selected}
      disabled={busy}
      onClick={onClick}
      className={`relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground sm:size-14 ${selected ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "opacity-60 hover:opacity-100"}`}
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : pending ? (
        <LoaderCircle className="size-4 animate-spin text-foreground-subtle" />
      ) : job.error ? (
        <X className="size-4 text-foreground-subtle" />
      ) : (
        <ImageIcon className="size-4 text-foreground-subtle" />
      )}
      <span className="absolute right-0 bottom-0 rounded-tl-md bg-popover/90 px-1 text-ui-xs text-foreground">
        {index + 1}
      </span>
    </button>
  );
}
