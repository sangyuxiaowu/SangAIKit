import { applyBrushStrokes, applyColorMatting, type BrushStroke, type MattingOptions } from './colorMatting';

self.onmessage = async (event: MessageEvent<{ image: Blob; options: MattingOptions; adjustments?: { colorMatting?: boolean; strokes?: BrushStroke[] } }>) => {
  try {
    const bitmap = await createImageBitmap(event.data.image);
    try {
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error('Image exceeds 40 megapixels');
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas is unavailable');
      context.drawImage(bitmap, 0, 0);
      const original = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const result = event.data.adjustments?.colorMatting === false
        ? context.getImageData(0, 0, bitmap.width, bitmap.height)
        : applyColorMatting(original, event.data.options);
      applyBrushStrokes(result, original, event.data.adjustments?.strokes ?? []);
      context.putImageData(result, 0, 0);
      self.postMessage({ blob: await canvas.convertToBlob({ type: 'image/png' }) });
    } finally { bitmap.close(); }
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};