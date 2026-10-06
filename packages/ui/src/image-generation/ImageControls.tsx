import type { ImageGenerationInput } from "@zcode/shared/image-generation";
import { IMAGE_ASPECT_RATIOS, getImageReferenceLimit } from "@zcode/shared/image-generation";

export const imageControlClass =
  "w-full min-w-0 rounded-lg border border-input-border bg-input px-3 py-2 text-mobile-input-safe text-foreground outline-none focus:border-input-border-focused disabled:opacity-50 sm:text-ui-base";

export function ImageControls({
  draft,
  change,
  zh,
  regional = false,
}: {
  draft: ImageGenerationInput;
  change: (patch: Partial<ImageGenerationInput>) => void;
  zh: boolean;
  regional?: boolean;
}) {
  const referenceLimit = getImageReferenceLimit(draft.size);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-ui-caption">
          {zh ? "宽高比" : "Aspect ratio"}
          <select
            className={imageControlClass}
            disabled={regional}
            aria-label={zh ? "宽高比" : "Aspect ratio"}
            value={String(nearestRatio(draft.size))}
            onChange={(event) => {
              const sizes = [
                "1024x1024",
                "1024x768",
                "768x1024",
                "1536x1024",
                "1024x1536",
                "1344x768",
                "768x1344",
              ];
              change({ size: sizes[Number(event.target.value)]! });
            }}
          >
            {IMAGE_ASPECT_RATIOS.map((ratio, index) => (
              <option key={ratio.label} value={index}>
                {ratio.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-ui-caption">
          {zh ? "尺寸" : "Size"}
          <input
            className={imageControlClass}
            disabled={regional}
            data-testid="image-size"
            value={draft.size}
            onChange={(event) => change({ size: event.target.value })}
            list="qwen-image-sizes"
          />
        </label>
      </div>
      {referenceLimit !== undefined && (
        <p className="text-ui-sm text-foreground-subtle" data-testid="image-reference-limit">
          {zh
            ? `此尺寸最多 ${referenceLimit} 张参考图，编辑目标计入数量。`
            : `Up to ${referenceLimit} references at this size, including the edit target.`}
        </p>
      )}
      <datalist id="qwen-image-sizes">
        <option value="512x512" />
        <option value="1024x1024" />
        <option value="1024x768" />
        <option value="768x1024" />
        <option value="1536x1024" />
        <option value="1024x1536" />
        <option value="1344x768" />
        <option value="768x1344" />
      </datalist>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-ui-caption">
          {zh ? "格式" : "Format"}
          <select
            className={imageControlClass}
            aria-label={zh ? "格式" : "Format"}
            disabled={regional}
            value={draft.outputFormat}
            onChange={(event) =>
              change({
                outputFormat: event.target.value as "png" | "jpeg",
                outputCompression: undefined,
                background: event.target.value === "jpeg" ? "auto" : draft.background,
              })
            }
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
          </select>
        </label>
        <label className="space-y-1 text-ui-caption">
          {zh ? "种子（留空自动）" : "Seed (blank: automatic)"}
          <input
            type="number"
            min={0}
            max={4294967295}
            className={imageControlClass}
            value={draft.seed ?? ""}
            onChange={(event) =>
              change({ seed: event.target.value === "" ? undefined : Number(event.target.value) })
            }
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-ui-caption">
        <input
          data-testid="image-transparent"
          type="checkbox"
          checked={draft.background === "transparent"}
          onChange={(event) =>
            change({
              background: event.target.checked ? "transparent" : "auto",
              ...(event.target.checked
                ? { outputFormat: "png", outputCompression: undefined }
                : {}),
            })
          }
        />
        {zh ? "透明背景" : "Transparent background"}
      </label>
      <details className="border-t border-border pt-3 text-ui-caption">
        <summary className="cursor-pointer">{zh ? "高级设置" : "Advanced"}</summary>
        <div className="mt-3 space-y-3">
          <label className="block">
            {zh ? "引导强度" : "Guidance"}
            <input
              className={imageControlClass}
              type="number"
              min={1}
              max={20}
              step={0.1}
              value={draft.guidanceScale}
              onChange={(event) =>
                change({
                  guidanceScale: Number(event.target.value),
                  ...(Number(event.target.value) <= 1 ? { negativePrompt: undefined } : {}),
                })
              }
            />
          </label>
          {draft.guidanceScale > 1 && (
            <label className="block">
              {zh ? "负面提示词" : "Negative prompt"}
              <textarea
                className={imageControlClass}
                value={draft.negativePrompt ?? ""}
                onChange={(event) => change({ negativePrompt: event.target.value })}
              />
            </label>
          )}
          {draft.outputFormat === "jpeg" && (
            <label className="block">
              {zh ? "JPEG 质量" : "JPEG quality"}
              <input
                className={imageControlClass}
                type="number"
                min={0}
                max={100}
                value={draft.outputCompression ?? ""}
                onChange={(event) =>
                  change({
                    outputCompression:
                      event.target.value === "" ? undefined : Number(event.target.value),
                  })
                }
              />
            </label>
          )}
        </div>
      </details>
    </div>
  );
}

function nearestRatio(size: string): number {
  const [w, h] = size.split("x").map(Number);
  return IMAGE_ASPECT_RATIOS.map((ratio, index) => ({
    index,
    distance: Math.abs((w || 1) / (h || 1) / ratio.ratio - 1),
  })).sort((a, b) => a.distance - b.distance)[0]!.index;
}
