import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { useImageArtifactUrl } from "@/hooks/useImageWorkbench.js";
import type { ImageArtifact } from "@zcode/shared/image-generation";

export function ImageCanvas({
  sessionId,
  artifact,
  pending,
  size,
  zoom,
  label,
  overlay,
}: {
  sessionId: string;
  artifact?: ImageArtifact;
  pending?: boolean;
  size: string;
  zoom: number;
  label: string;
  overlay?: ReactNode;
}) {
  const { url, error } = useImageArtifactUrl(
    sessionId,
    artifact,
    zoom > 100 ? undefined : "canvas",
  );
  const [width, height] = size.split("x").map(Number);
  const container = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 300, height: 300 });
  useLayoutEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setBounds({
          width: Math.max(1, entry.contentRect.width),
          height: Math.max(1, entry.contentRect.height),
        });
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const ratio = (width || 1) / (height || 1);
  const fittedWidth = (Math.min(bounds.width, bounds.height * ratio) * zoom) / 100;
  return (
    <div
      ref={container}
      className="flex min-h-64 flex-1 items-start justify-start overflow-auto rounded-xl border border-border bg-background p-4"
      data-testid="image-canvas"
      aria-busy={pending}
    >
      <div
        className="relative m-auto flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-[repeating-conic-gradient(var(--color-surface)_0%_25%,var(--color-background)_0%_50%)] bg-size-[16px_16px]"
        style={{ width: fittedWidth, height: fittedWidth / ratio }}
      >
        {url ? (
          <img
            className="block h-full w-full object-contain"
            src={url}
            alt={label}
            data-testid="image-result"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 p-6 text-ui-base text-foreground-subtle">
            {pending && <LoaderCircle className="size-6 animate-spin" />}
            <span>{error ?? label}</span>
          </div>
        )}
        {url && overlay}
      </div>
    </div>
  );
}
