import type { ResponsesTool } from '../openai';
import type { SessionImage } from '../sessionTypes';
import { removeColorBackground } from './colorMatting';
import { removeBackground } from './index';
import { installRuntime } from './resources';
import { readModel, readRuntime } from './storage';
import type { ModelId } from './models';

export function createBackgroundRemovalTool(options: {
  loadImage?: (id: string) => Promise<Blob | null>;
  saveImage?: (blob: Blob, name: string) => Promise<SessionImage>;
  onImage?: (image: SessionImage) => void;
}): ResponsesTool {
  return {
    name: 'remove_background',
    description: 'Remove an image background locally. Color mode needs no model; AI models must be downloaded first.',
    parameters: { type: 'object', properties: {
      imageId: { type: 'string', description: 'ID of the image to process.' },
      modelId: { type: 'string', enum: ['color', 'u2netp', 'birefnet', 'modnet'], description: 'Default: color.' },
      color: { type: 'string', description: 'Color to remove as #RRGGBB; default #ffffff.' },
      tolerance: { type: 'number', minimum: 0, maximum: 100 },
      feather: { type: 'number', minimum: 0, maximum: 10 },
      contiguous: { type: 'boolean', description: 'Remove only matching areas connected to the image edge. Default true.' }
    }, required: ['imageId'] },
    execute: async (args, signal) => {
      if (Object.keys(args).some(key => !['imageId', 'modelId', 'color', 'tolerance', 'feather', 'contiguous'].includes(key))) throw new Error('Unsupported background-removal parameter.');
      if (typeof args.imageId !== 'string' || !args.imageId) throw new Error('Image ID is required.');
      if (!options.loadImage || !options.saveImage) throw new Error('Image storage is not configured.');
      const modelId = args.modelId ?? 'color';
      if (typeof modelId !== 'string' || !['color', 'u2netp', 'birefnet', 'modnet'].includes(modelId)) throw new Error('Invalid model ID.');
      const color = args.color ?? '#ffffff';
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid color.');
      const tolerance = args.tolerance ?? 25, feather = args.feather ?? 1.5, contiguous = args.contiguous ?? true;
      if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100 || typeof feather !== 'number' || !Number.isFinite(feather) || feather < 0 || feather > 10 || typeof contiguous !== 'boolean') throw new Error('Invalid matting options.');
      signal.throwIfAborted();
      const image = await options.loadImage(args.imageId);
      if (!image) throw new Error('Image not found.');
      let blob: Blob;
      if (modelId === 'color') {
        const targetColor: [number, number, number] = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];
        blob = await removeColorBackground(image, { targetColor, tolerance, feather, contiguous }, signal);
      } else {
        if (!await readModel(modelId as ModelId)) throw new Error('MODEL_NOT_READY');
        if (!await readRuntime()) await installRuntime(AbortSignal.any([signal, AbortSignal.timeout(180_000)]));
        blob = (await removeBackground(image, { modelId: modelId as ModelId, signal })).blob;
      }
      signal.throwIfAborted();
      const result = await options.saveImage(blob, `removed-background-${Date.now()}.png`);
      options.onImage?.(result);
      return { image: { id: result.id, name: result.name, type: result.type, size: result.size }, modelId };
    }
  };
}