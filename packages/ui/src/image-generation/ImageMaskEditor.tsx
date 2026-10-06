import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowLeft, Brush, Eraser, Undo2, RotateCcw } from "lucide-react";
import { ImageEditorButton } from "./ImageEditorButton.js";
import type { ImageArtifact } from "@zcode/shared/image-generation";
import { Button } from "@/components/ui/button.js";
import { ImageCanvas } from "./ImageCanvas.js";
import {
  drawMask,
  hasMaskSelection,
  maskFile,
  type MaskPoint,
  type MaskStroke,
} from "./imageMaskDrawing.js";

export interface ImageMaskEditorHandle {
  exportMask(): Promise<File>;
}

export const ImageMaskEditor = forwardRef<
  ImageMaskEditorHandle,
  {
    sessionId: string;
    artifact: ImageArtifact;
    zoom: number;
    zh: boolean;
    disabled: boolean;
    onReady(ready: boolean): void;
    onExit(): void;
  }
>(function ImageMaskEditor({ sessionId, artifact, zoom, zh, disabled, onReady, onExit }, ref) {
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [brush, setBrush] = useState(8);
  const [erase, setErase] = useState(false);
  const [cursor, setCursor] = useState<MaskPoint>({ x: 0.5, y: 0.5 });
  const [keyboard, setKeyboard] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef<{ id: number; stroke: MaskStroke } | undefined>(undefined);
  const updatePreview = (next: MaskStroke[]) => {
    if (canvas.current) {
      drawMask(canvas.current, next, true);
      onReady(hasMaskSelection(canvas.current));
    }
  };
  useEffect(() => {
    updatePreview(strokes);
  }, [strokes]);
  useImperativeHandle(
    ref,
    () => ({ exportMask: () => maskFile(artifact.width, artifact.height, strokes) }),
    [artifact.width, artifact.height, strokes],
  );
  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>): MaskPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const overlay = (
    <>
      <canvas
        ref={canvas}
        width={artifact.width}
        height={artifact.height}
        tabIndex={disabled ? -1 : 0}
        className="absolute inset-0 h-full w-full touch-none cursor-crosshair opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
        data-testid="image-mask-canvas"
        aria-label={
          zh ? "涂抹选区：方向键移动，空格涂抹" : "Paint selection: arrow keys move, Space paints"
        }
        onPointerDown={(event) => {
          if (disabled || active.current || (event.pointerType === "mouse" && event.button !== 0))
            return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          setKeyboard(false);
          const stroke = { points: [pointAt(event)], width: brush / 100, erase };
          active.current = { id: event.pointerId, stroke };
          updatePreview([...strokes, stroke]);
        }}
        onPointerMove={(event) => {
          if (!active.current || active.current.id !== event.pointerId) return;
          active.current.stroke.points.push(pointAt(event));
          updatePreview([...strokes, active.current.stroke]);
        }}
        onPointerUp={(event) => {
          if (!active.current || active.current.id !== event.pointerId) return;
          const stroke = active.current.stroke;
          active.current = undefined;
          setStrokes((current) => [...current, stroke]);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          active.current = undefined;
          updatePreview(strokes);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const delta = Math.max(0.01, brush / 400);
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            setKeyboard(true);
            setCursor((current) => ({
              x: Math.max(
                0,
                Math.min(
                  1,
                  current.x +
                    (event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0),
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  1,
                  current.y +
                    (event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0),
                ),
              ),
            }));
          } else if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            setKeyboard(true);
            setStrokes((current) => [...current, { points: [cursor], width: brush / 100, erase }]);
          } else if ((event.ctrlKey || event.metaKey) && event.key === "z") {
            event.preventDefault();
            setStrokes((current) => current.slice(0, -1));
          }
        }}
      />
      {keyboard && (
        <span
          className="pointer-events-none absolute rounded-full border-2 border-foreground"
          style={{
            left: `${cursor.x * 100}%`,
            top: `${cursor.y * 100}%`,
            width: `${brush}%`,
            aspectRatio: "1",
            transform: "translate(-50%, -50%)",
          }}
        />
      )}
    </>
  );
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col pt-12 sm:pt-14">
      <ImageCanvas
        sessionId={sessionId}
        artifact={artifact}
        size={`${artifact.width}x${artifact.height}`}
        zoom={zoom}
        label={zh ? "局部重绘" : "Repaint area"}
        overlay={overlay}
      />
      <fieldset
        disabled={disabled}
        className="absolute top-1 left-1/2 z-10 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-md"
        data-testid="image-mask-toolbar"
      >
        <ImageEditorButton label={zh ? "返回全图调整" : "Back to full-image edit"} onClick={onExit}>
          <ArrowLeft />
        </ImageEditorButton>
        <Button
          size="lg"
          variant={!erase ? "secondary" : "ghost"}
          aria-label={zh ? "画笔" : "Brush"}
          aria-pressed={!erase}
          onClick={() => setErase(false)}
        >
          <Brush className="size-4" />
          <span className="hidden sm:inline">{zh ? "画笔" : "Brush"}</span>
        </Button>
        <Button
          size="lg"
          variant={erase ? "secondary" : "ghost"}
          aria-label={zh ? "橡皮擦" : "Eraser"}
          aria-pressed={erase}
          onClick={() => setErase(true)}
        >
          <Eraser className="size-4" />
          <span className="hidden sm:inline">{zh ? "橡皮擦" : "Eraser"}</span>
        </Button>
        <span className="mx-1 h-4 border-l border-border" />
        <input
          className="w-20 accent-foreground sm:w-24"
          aria-label={zh ? "画笔大小" : "Brush size"}
          type="range"
          min={1}
          max={30}
          value={brush}
          onChange={(event) => setBrush(Number(event.target.value))}
        />
        <span className="mx-1 h-4 border-l border-border" />
        <ImageEditorButton
          label={zh ? "撤销涂抹" : "Undo stroke"}
          disabled={!strokes.length}
          onClick={() => setStrokes((current) => current.slice(0, -1))}
        >
          <Undo2 />
        </ImageEditorButton>
        <ImageEditorButton
          label={zh ? "清空选区" : "Clear selection"}
          disabled={!strokes.length}
          onClick={() => setStrokes([])}
        >
          <RotateCcw />
        </ImageEditorButton>
      </fieldset>
      <p
        className="pointer-events-none absolute bottom-0 left-0 w-full text-center text-ui-sm text-foreground-subtle"
        aria-live="polite"
      >
        {zh
          ? "涂抹要修改的区域 · 方向键移动，空格涂抹"
          : "Paint the area to change · Arrow keys move, Space paints"}
      </p>
    </div>
  );
});
