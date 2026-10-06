import type { ImageJob } from "@zcode/shared/image-generation";
import { Columns2 } from "lucide-react";
import { ImageEditorPopover } from "./ImageEditorPopover.js";
import { ImageEditorButton } from "./ImageEditorButton.js";
import { imageControlClass } from "./ImageControls.js";

export function ImageCanvasNavigation({
  zoom,
  setZoom,
  jobs,
  comparisonId,
  setComparisonId,
  zh,
  popoverProps,
}: {
  zoom: number;
  setZoom(value: number): void;
  jobs: ImageJob[];
  comparisonId?: string;
  setComparisonId(value: string | undefined): void;
  zh: boolean;
  popoverProps: { open: boolean; onOpenChange(value: boolean): void; zh: boolean; testId: string };
}) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-center gap-3 px-4 text-ui-sm text-foreground-subtle">
      <label className="flex items-center gap-2">
        <span>{zh ? "缩放" : "Zoom"}</span>
        <input
          className="w-24 accent-foreground"
          type="range"
          aria-label={zh ? "缩放" : "Zoom"}
          min={25}
          max={200}
          step={25}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
        <span className="w-9 tabular-nums">{zoom}%</span>
      </label>
      {jobs.filter((job) => job.artifact).length > 1 && (
        <ImageEditorPopover
          {...popoverProps}
          title={zh ? "对比版本" : "Compare version"}
          trigger={
            <ImageEditorButton
              label={zh ? "对比版本" : "Compare images"}
              data-testid="image-comparison-open"
            >
              <Columns2 />
            </ImageEditorButton>
          }
        >
          <select
            className={imageControlClass}
            aria-label={zh ? "对比版本" : "Compare version"}
            value={comparisonId ?? ""}
            onChange={(event) => {
              setComparisonId(event.target.value || undefined);
              popoverProps.onOpenChange(false);
            }}
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
        </ImageEditorPopover>
      )}
    </div>
  );
}
