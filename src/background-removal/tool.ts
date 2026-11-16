import type { ResponsesTool } from '../openai';
import type { SessionImage } from '../sessionTypes';
import { removeColorBackground } from './colorMatting';
import { removeBackground } from './index';
import type { ModelId } from './models';
import { deliverImageResult, extendImageToolDefinition, type ImageToolExtension } from '../imageToolHost';

export const backgroundRemovalDefinition = {
  name: 'remove_background',
  description: '移除图片背景，返回结果图片 ID，不修改原图。AI 模型及运行时未就绪时自动下载，推理在本地执行。',
  parameters: { type: 'object', properties: {
    imageId: { type: 'string', description: '待处理的原图 ID，来自附件或工具返回，不可编造。' },
    modelId: { type: 'string', enum: ['color', 'u2netp', 'birefnet', 'modnet'], description: '可选，默认 u2netp 轻量模型。birefnet：Lite 512，适合复杂边缘；modnet：人像专用；color：颜色抠图，无需模型。' },
    device: { type: 'string', enum: ['auto', 'webgpu', 'wasm'], description: '可选，默认 auto：优先 WebGPU，失败回退 CPU/WASM。仅 AI 模型使用。' },
    colorOptions: { type: 'object', description: '可选，颜色抠图参数。', properties: {
      color: { type: 'string', description: '目标色，#RRGGBB，默认 #ffffff。' },
      tolerance: { type: 'number', minimum: 0, maximum: 100, description: '容差，默认 25。' },
      feather: { type: 'number', minimum: 0, maximum: 10, description: '边缘羽化，默认 1.5。' },
      contiguous: { type: 'boolean', description: '仅移除与边缘连通的颜色区域，默认 true。' }
    } }
  }, required: ['imageId'] }
};

export function createBackgroundRemovalTool(options: {
  loadImage?: (id: string) => Promise<Blob | null>;
  saveImage?: (blob: Blob, name: string) => Promise<SessionImage>;
  onImage?: (image: SessionImage) => void;
  extension?: ImageToolExtension;
}): ResponsesTool {
  const definition = extendImageToolDefinition(backgroundRemovalDefinition, options.extension);
  return {
    ...definition,
    execute: async (args, signal) => {
      if (Object.keys(args).some(key => !Object.hasOwn(definition.parameters.properties, key))) throw new Error('Unsupported background-removal parameter.');
      if (args.imageId !== undefined && (typeof args.imageId !== 'string' || !args.imageId)) throw new Error('Invalid image ID.');
      if (!options.extension && (!options.loadImage || !options.saveImage)) throw new Error('Image storage is not configured.');
      for (const key of options.extension?.required ?? []) if (args[key] === undefined) throw new Error(`${key} is required.`);
      const modelId = args.modelId ?? 'u2netp';
      if (typeof modelId !== 'string' || !['color', 'u2netp', 'birefnet', 'modnet'].includes(modelId)) throw new Error('Invalid model ID.');
      const device = args.device ?? 'auto';
      if (device !== 'auto' && device !== 'webgpu' && device !== 'wasm') throw new Error('Invalid device.');
      if (args.colorOptions !== undefined && (!args.colorOptions || typeof args.colorOptions !== 'object' || Array.isArray(args.colorOptions))) throw new Error('colorOptions must be an object.');
      const colorOptions = (args.colorOptions ?? {}) as Record<string, unknown>;
      if (Object.keys(colorOptions).some(key => !Object.hasOwn(backgroundRemovalDefinition.parameters.properties.colorOptions.properties, key))) throw new Error('Unsupported colorOptions parameter.');
      const color = colorOptions.color ?? '#ffffff';
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid color.');
      const tolerance = colorOptions.tolerance ?? 25, feather = colorOptions.feather ?? 1.5, contiguous = colorOptions.contiguous ?? true;
      if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100 || typeof feather !== 'number' || !Number.isFinite(feather) || feather < 0 || feather > 10 || typeof contiguous !== 'boolean') throw new Error('Invalid matting options.');
      signal.throwIfAborted();
      const prepared = await options.extension?.prepare(args, signal);
      if (prepared?.inputImage && args.imageId !== undefined) throw new Error('Only one input image is supported.');
      if (args.imageId !== undefined && !options.loadImage) throw new Error('Image storage is not configured.');
      const image = prepared?.inputImage ?? (typeof args.imageId === 'string' ? await options.loadImage!(args.imageId) : null);
      if (!image) throw new Error('Image not found.');
      let blob: Blob;
      if (modelId === 'color') {
        const targetColor: [number, number, number] = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];
        blob = await removeColorBackground(image, { targetColor, tolerance, feather, contiguous }, signal);
      } else {
        blob = (await removeBackground(image, { modelId: modelId as ModelId, device, signal })).blob;
      }
      signal.throwIfAborted();
      if (prepared) return deliverImageResult(prepared, { images: [blob], model: modelId }, signal, options.saveImage, options.onImage);
      const result = await options.saveImage!(blob, `removed-background-${Date.now()}.png`);
      signal.throwIfAborted();
      options.onImage?.(result);
      return { image: { id: result.id, name: result.name, type: result.type, size: result.size }, modelId };
    }
  };
}