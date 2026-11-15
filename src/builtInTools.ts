import type { ResponsesTool } from './openai';
import type { AiConfig } from './settingsTypes';
import type { SessionImage } from './sessionTypes';
import type { ImageQuality } from './image-generation/types';
import { availableImageModels, generateImages } from './image-generation/index';
import { blobToDataUrl } from './imageAttachments';
import { listFonts, normalizeLocalFonts } from './fonts';
import { normalizeAiFeatures, type AiFeatures } from './features';
import { normalizeSkills, readSkill, skillsPrompt } from './skills';

export interface BuiltInToolOptions {
  config: AiConfig;
  features?: Partial<AiFeatures>;
  loadImage?: (imageId: string) => Promise<Blob | null>;
  saveImage?: (blob: Blob, name: string) => Promise<SessionImage>;
  onImage?: (image: SessionImage) => void;
}

export function createBuiltInTools(options: BuiltInToolOptions): { tools: ResponsesTool[]; instructions: string } {
  const config = structuredClone(options.config);
  const features = normalizeAiFeatures(options.features);
  if (config.maxImageFailures !== undefined && (!Number.isSafeInteger(config.maxImageFailures) || config.maxImageFailures < 0)) throw new Error('Image failure limit must be a non-negative safe integer.');
  const skills = features.skills ? normalizeSkills(config.skills) : [];
  const fonts = features.fontManagement ? normalizeLocalFonts(config.localFonts) : [];
  const imageModels = features.imageGeneration && options.loadImage && options.saveImage ? availableImageModels(config) : [];
  const tools: ResponsesTool[] = [];
  if (features.fontManagement) tools.push({
    name: 'list_fonts', description: 'List available local and online fonts.', parameters: { type: 'object', properties: {} },
    execute: async args => { if (Object.keys(args).length) throw new Error('list_fonts does not accept parameters.'); return listFonts(fonts, { localFonts: true, onlineFonts: features.onlineFonts }); }
  });
  if (skills.length) tools.push({
    name: 'skill', description: 'Read the full text of an available skill.',
    parameters: { type: 'object', properties: { name: { type: 'string', enum: skills.map(skill => skill.name) } }, required: ['name'] },
    execute: async args => readSkill(skills, args)
  });
  let failures = 0;
  if (imageModels.length) tools.push({
    name: 'generate_image', description: `Generate images using a configured model: ${imageModels.map(item => `${item.label} (${item.id})`).join(', ')}.`,
    parameters: { type: 'object', properties: { modelConfigId: { type: 'string', enum: imageModels.map(item => item.id) }, prompt: { type: 'string' }, referenceImageId: { type: 'string' }, size: { type: 'string' }, ratio: { type: 'string' }, quality: { type: 'string' }, n: { type: 'integer' } }, required: ['modelConfigId', 'prompt'] },
    execute: async (args, signal) => {
      const maxFailures = config.maxImageFailures ?? 3;
      if (maxFailures > 0 && failures >= maxFailures) throw new Error('Image generation failure limit reached in this turn.');
      try {
        signal.throwIfAborted();
        if (Object.keys(args).some(key => !['modelConfigId', 'prompt', 'referenceImageId', 'size', 'ratio', 'quality', 'n'].includes(key))) throw new Error('Unknown image generation parameter.');
        if (typeof args.modelConfigId !== 'string' || typeof args.prompt !== 'string') throw new Error('A model ID and prompt are required.');
        if (args.referenceImageId !== undefined && typeof args.referenceImageId !== 'string') throw new Error('Invalid reference image ID.');
        if (args.size !== undefined && typeof args.size !== 'string') throw new Error('Invalid image size.');
        if (args.ratio !== undefined && typeof args.ratio !== 'string') throw new Error('Invalid image ratio.');
        if (args.quality !== undefined && (typeof args.quality !== 'string' || !['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(args.quality))) throw new Error('Invalid image quality.');
        if (args.n !== undefined && (typeof args.n !== 'number' || !Number.isInteger(args.n))) throw new Error('Invalid image count.');
        let reference: string | undefined;
        if (typeof args.referenceImageId === 'string') {
          const blob = await options.loadImage!(args.referenceImageId);
          if (!blob) throw new Error('Reference image not found.');
          reference = await blobToDataUrl(blob);
        }
        const results = await generateImages(config, { modelConfigId: args.modelConfigId, prompt: args.prompt,
          ...(typeof args.size === 'string' ? { size: args.size } : {}), ...(typeof args.ratio === 'string' ? { ratio: args.ratio } : {}),
          ...(typeof args.quality === 'string' ? { quality: args.quality as ImageQuality } : {}), ...(typeof args.n === 'number' ? { n: args.n } : {})
        }, signal, reference);
        const saved: SessionImage[] = [];
        for (const blob of results) {
          const image = await options.saveImage!(blob, `generated-${Date.now()}-${saved.length + 1}.${blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'}`);
          saved.push(image);
          options.onImage?.(image);
        }
        return { images: saved.map(image => ({ id: image.id, name: image.name, type: image.type, size: image.size })) };
      } catch (error) { if (!signal.aborted) failures++; throw error; }
    }
  });
  const imagePrompt = imageModels.length ? config.imageToolPrompt?.trim() : '';
  const skillPrompt = skillsPrompt(skills);
  const basePrompt = imagePrompt && !config.systemPrompt.includes(imagePrompt) ? `${config.systemPrompt}\n\n${imagePrompt}` : config.systemPrompt;
  return { tools, instructions: skillPrompt && !basePrompt.includes(skillPrompt) ? `${basePrompt}\n\n${skillPrompt}` : basePrompt };
}