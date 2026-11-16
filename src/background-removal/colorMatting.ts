export interface MattingOptions {
  targetColor: [number, number, number];
  tolerance: number;
  contiguous: boolean;
  feather: number;
  startX?: number;
  startY?: number;
}

export interface BrushStroke {
  mode: 'erase' | 'restore';
  radius: number;
  points: { x: number; y: number }[];
}

export function applyBrushStrokes(result: ImageData, original: ImageData, strokes: BrushStroke[]): void {
  if (result.width !== original.width || result.height !== original.height) throw new Error('Image dimensions do not match');
  const { width, height, data } = result;
  for (const stroke of strokes) {
    const radius = stroke.radius;
    if (!Number.isFinite(radius) || radius <= 0) continue;
    const paint = (centerX: number, centerY: number) => {
      const left = Math.max(0, Math.ceil(centerX - radius));
      const right = Math.min(width - 1, Math.floor(centerX + radius));
      const top = Math.max(0, Math.ceil(centerY - radius));
      const bottom = Math.min(height - 1, Math.floor(centerY + radius));
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 > radius ** 2) continue;
        const offset = (y * width + x) * 4;
        if (stroke.mode === 'erase') data[offset + 3] = 0;
        else data.set(original.data.subarray(offset, offset + 4), offset);
      }
    };
    stroke.points.forEach((point, index) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const previous = stroke.points[index - 1];
      if (!previous || !Number.isFinite(previous.x) || !Number.isFinite(previous.y)) { paint(point.x, point.y); return; }
      const steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) / Math.max(0.5, radius / 2)));
      for (let step = 1; step <= steps; step++) {
        const fraction = step / steps;
        paint(previous.x + (point.x - previous.x) * fraction, previous.y + (point.y - previous.y) * fraction);
      }
    });
  }
}

export function applyColorMatting(imageData: ImageData, options: MattingOptions): ImageData {
  const { width, height } = imageData;
  const data = new Uint8ClampedArray(imageData.data);
  const mask = new Uint8Array(width * height);
  const [red, green, blue] = options.targetColor;
  const maxDistance = options.tolerance / 100 * 441.67;
  const matches = (index: number) => {
    const offset = index * 4;
    return Math.hypot(data[offset] - red, data[offset + 1] - green, data[offset + 2] - blue) <= maxDistance;
  };
  if (!options.contiguous) {
    for (let index = 0; index < mask.length; index++) if (matches(index)) mask[index] = 1;
  } else {
    const visited = new Uint8Array(mask.length);
    const queue: number[] = [];
    const enqueue = (x: number, y: number) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      const index = y * width + x;
      if (visited[index]) return;
      visited[index] = 1;
      if (data[index * 4 + 3] < 25 || matches(index)) { mask[index] = 1; queue.push(index); }
    };
    if (options.startX !== undefined && options.startY !== undefined) enqueue(options.startX, options.startY);
    else {
      for (let x = 0; x < width; x++) { enqueue(x, 0); enqueue(x, height - 1); }
      for (let y = 0; y < height; y++) { enqueue(0, y); enqueue(width - 1, y); }
    }
    while (queue.length) {
      const index = queue.pop()!;
      const x = index % width;
      const y = Math.floor(index / width);
      enqueue(x - 1, y); enqueue(x + 1, y); enqueue(x, y - 1); enqueue(x, y + 1);
    }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (mask[index]) { data[index * 4 + 3] = 0; continue; }
    if (options.feather <= 0) continue;
    let distance = Infinity;
    const radius = Math.ceil(options.feather);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx]) distance = Math.min(distance, Math.hypot(dx, dy));
    }
    if (distance <= options.feather) data[index * 4 + 3] = Math.round(data[index * 4 + 3] * distance / options.feather);
  }
  return new ImageData(data, width, height);
}

export async function removeColorBackground(image: Blob, options: MattingOptions, signal: AbortSignal,
  adjustments?: { colorMatting?: boolean; strokes?: BrushStroke[] }): Promise<Blob> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./colorMatting.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: unknown, blob?: Blob) => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else if (blob) resolve(blob);
    };
    const abort = () => finish(signal.reason || new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'Color matting worker failed')); };
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
      if (event.data.error) finish(new Error(event.data.error));
      else if (event.data.blob) finish(undefined, event.data.blob);
      else finish(new Error('Color matting worker returned no image'));
    };
    try { worker.postMessage({ image, options, adjustments }); } catch (error) { finish(error); }
  });
}