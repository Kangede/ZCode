import { useImageArtifactUrl } from "@/hooks/useImageWorkbench.js";
import { useRef } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";
import type { ImageArtifact } from "@zcode/shared/image-generation";
import { Button } from "@/components/ui/button.js";

export function ImageReferences({
  sessionId,
  references,
  artifacts,
  busy,
  zh,
  upload,
  move,
  remove,
}: {
  sessionId: string;
  references: string[];
  artifacts: ImageArtifact[];
  busy: boolean;
  zh: boolean;
  upload(files: FileList): void;
  move(index: number, delta: number): void;
  remove(index: number): void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div
      className="rounded-lg border border-dashed border-border p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        upload(event.dataTransfer.files);
      }}
    >
      <div className="mb-2 flex items-center justify-between text-ui-caption">
        <span>
          {zh ? "参考图" : "References"} {references.length}/5
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || references.length >= 5}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus className="size-4" />
          {zh ? "添加" : "Add"}
        </Button>
      </div>
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        accept="image/png,image/jpeg"
        multiple
        data-testid="image-reference-input"
        onChange={(event) => {
          if (event.target.files) upload(event.target.files);
          event.target.value = "";
        }}
      />
      {references.length === 0 && (
        <p className="text-ui-caption text-foreground-subtle">
          {zh ? "拖放 PNG 或 JPEG，或点击添加。" : "Drop PNG/JPEG files here or choose Add."}
        </p>
      )}
      {references.map((id, index) => (
        <div key={`${id}-${index}`} className="flex items-center gap-1 py-1 text-ui-caption">
          <ReferenceThumbnail
            sessionId={sessionId}
            artifact={artifacts.find((item) => item.id === id)}
            label={`Picture ${index + 1}`}
          />
          <span className="min-w-0 flex-1 truncate">
            Picture {index + 1}:{" "}
            {artifacts.find((item) => item.id === id)?.name ?? (zh ? "图像版本" : "Image version")}
          </span>
          <button
            aria-label={`Picture ${index + 1} ${zh ? "上移" : "move up"}`}
            disabled={index === 0}
            onClick={() => move(index, -1)}
          >
            <ArrowUp className="size-4" />
          </button>
          <button
            aria-label={`Picture ${index + 1} ${zh ? "下移" : "move down"}`}
            disabled={index === references.length - 1}
            onClick={() => move(index, 1)}
          >
            <ArrowDown className="size-4" />
          </button>
          <button
            aria-label={`Picture ${index + 1} ${zh ? "移除" : "remove"}`}
            onClick={() => remove(index)}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ReferenceThumbnail({
  sessionId,
  artifact,
  label,
}: {
  sessionId: string;
  artifact?: ImageArtifact;
  label: string;
}) {
  const { url } = useImageArtifactUrl(sessionId, artifact, "reference");
  return url ? (
    <img
      className="size-10 shrink-0 rounded border border-border object-contain"
      src={url}
      alt={label}
    />
  ) : null;
}
