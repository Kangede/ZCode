export interface MaskPoint {
  x: number;
  y: number;
}
export interface MaskStroke {
  points: MaskPoint[];
  width: number;
  erase: boolean;
}

/** Coordinates and brush widths use the original image, independently of CSS zoom. */
export function drawMask(canvas: HTMLCanvasElement, strokes: MaskStroke[], overlay: boolean) {
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!overlay) {
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (const stroke of strokes) {
    context.globalCompositeOperation = (overlay ? stroke.erase : !stroke.erase)
      ? "destination-out"
      : "source-over";
    // 选区先以不透明笔迹合并，再由画布统一透明度，避免重复涂抹加深且与导出蒙版不一致。
    context.fillStyle = context.strokeStyle = overlay ? "rgb(168,85,247)" : "white";
    context.lineWidth = stroke.width * canvas.width;
    context.lineCap = context.lineJoin = "round";
    const first = stroke.points[0];
    if (!first) continue;
    if (stroke.points.length === 1) {
      context.beginPath();
      context.arc(
        first.x * canvas.width,
        first.y * canvas.height,
        context.lineWidth / 2,
        0,
        Math.PI * 2,
      );
      context.fill();
      continue;
    }
    context.beginPath();
    context.moveTo(first.x * canvas.width, first.y * canvas.height);
    for (const point of stroke.points.slice(1))
      context.lineTo(point.x * canvas.width, point.y * canvas.height);
    context.stroke();
  }
  context.globalCompositeOperation = "source-over";
}

export function hasMaskSelection(canvas: HTMLCanvasElement) {
  const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) return true;
  return false;
}

export async function maskFile(
  width: number,
  height: number,
  strokes: MaskStroke[],
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  drawMask(canvas, strokes, false);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("Could not encode selection"))),
      "image/png",
    ),
  );
  return new File([blob], "selection-mask.png", { type: "image/png" });
}
