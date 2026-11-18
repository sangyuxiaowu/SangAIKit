import type { ResponsesTool } from './openai';
import type { AiConfig } from './settingsTypes';
import type { SessionImage } from './sessionTypes';
import type { ImageQuality } from './image-generation/types';
import { availableImageModels, generateImages, imageCapabilities, imageModelToolId, imageTimeoutSeconds } from './image-generation/index';
import { blobToDataUrl } from './imageAttachments';
import { listFonts, normalizeLocalFonts } from './fonts';
import { normalizeAiFeatures, type AiFeatures } from './features';
import { normalizeSkills, readSkill, skillsPrompt } from './skills';
import { createBackgroundRemovalTool } from './background-removal/tool';
import { builtInToolDefinitions } from './builtInToolDefinitions';
import { deliverImageResult, ImageApplicationError, type ImageToolExtension, type ImageToolExtensions } from './imageToolHost';

export { builtInToolDefinitions, imageToolDefinitions } from './builtInToolDefinitions';
export type { ImageToolExtension, ImageToolExtensions, ImageToolResult, ImageToolSchemaExtension } from './imageToolHost';

export interface BuiltInToolOptions {
  config: AiConfig;
  features?: Partial<AiFeatures>;
  loadImage?: (imageId: string) => Promise<Blob | null>;
  saveImage?: (blob: Blob, name: string) => Promise<SessionImage>;
  onImage?: (image: SessionImage) => void;
  imageExtensions?: ImageToolExtensions<ImageToolExtension>;
}

export function createBuiltInTools(options: BuiltInToolOptions): { tools: ResponsesTool[]; instructions: string } {
  const config = structuredClone(options.config);
  const features = normalizeAiFeatures(options.features);
  if (config.maxImageFailures !== undefined && (!Number.isSafeInteger(config.maxImageFailures) || config.maxImageFailures < 0)) throw new Error('Image failure limit must be a non-negative safe integer.');
  const skills = features.skills ? normalizeSkills(config.skills) : [];
  const fonts = features.fontManagement ? normalizeLocalFonts(config.localFonts) : [];
  const imageModels = features.imageGeneration && ((options.loadImage && options.saveImage) || options.imageExtensions?.generate_image) ? availableImageModels(config) : [];
  let failures = 0;
  const applicationFailures = new Set<string>();
  const tools: ResponsesTool[] = builtInToolDefinitions({ features, config, skills, imageModels, imageStorage: Boolean(options.loadImage && options.saveImage), imageExtensions: options.imageExtensions }).map(definition => ({
    ...definition,
    execute: async (args, signal) => {
      signal.throwIfAborted();
      if (applicationFailures.has(definition.name)) throw new Error('Image application failed in this turn. Do not retry processing without a new user request.');
      if (definition.name === 'remove_background') {
        try { return await createBackgroundRemovalTool({ ...options, extension: options.imageExtensions?.remove_background }).execute(args, signal); }
        catch (error) {
          if (error instanceof ImageApplicationError) applicationFailures.add(definition.name);
          throw error;
        }
      }
      if (definition.name === 'skill') return readSkill(skills, args);
      if (definition.name === 'list_fonts' || definition.name === 'list_image_models') {
        if (Object.keys(args).length) throw new Error(`${definition.name} does not accept parameters.`);
        if (definition.name === 'list_fonts') return listFonts(fonts, { localFonts: true, onlineFonts: features.onlineFonts });
        return { models: imageModels.map(model => {
          const { sizePattern, sizeDescription, ...capabilities } = imageCapabilities(model);
          return { id: imageModelToolId(model), label: model.label, description: model.description,
            version: model.version?.trim() || null, releasedAt: model.releasedAt || null, timeoutSeconds: imageTimeoutSeconds(model),
            defaultSize: model.size, ...capabilities,
            ...(capabilities.ratios ? { defaultRatio: model.ratio } : {}),
            ...(capabilities.qualities ? { defaultQuality: model.quality ?? 'high' } : {}) };
        }) };
      }
      const maxFailures = config.maxImageFailures ?? 3;
      if (maxFailures > 0 && failures >= maxFailures) throw new Error('Image generation failure limit reached in this turn.');
      let prepared: Awaited<ReturnType<ImageToolExtension['prepare']>> | undefined;
      let results: Blob[];
      let model: string;
      let prompt: string;
      try {
        signal.throwIfAborted();
        if (Object.keys(args).some(key => !['modelConfigId', 'prompt', 'referenceImageId', 'referenceImageIds', 'size', 'ratio', 'quality', 'n'].includes(key) && !Object.hasOwn(options.imageExtensions?.generate_image?.properties ?? {}, key))) throw new Error('Unknown image generation parameter.');
        for (const key of options.imageExtensions?.generate_image?.required ?? []) if (args[key] === undefined) throw new Error(`${key} is required.`);
        const modelId = args.modelConfigId ?? (imageModels.length === 1 ? imageModelToolId(imageModels[0]) : undefined);
        if (typeof modelId !== 'string' || typeof args.prompt !== 'string') throw new Error('A model ID and prompt are required.');
        const matches = imageModels.filter(model => imageModelToolId(model) === modelId);
        if (matches.length !== 1) throw new Error('Image model is disabled, unavailable or ambiguous. Read list_image_models when multiple models are enabled.');
        if (args.referenceImageId !== undefined && typeof args.referenceImageId !== 'string') throw new Error('Invalid reference image ID.');
        if (args.referenceImageIds !== undefined && (!Array.isArray(args.referenceImageIds) || args.referenceImageIds.some(id => typeof id !== 'string'))) throw new Error('Invalid reference image IDs.');
        if (args.referenceImageId !== undefined && args.referenceImageIds !== undefined) throw new Error('Use either referenceImageId or referenceImageIds.');
        if (args.size !== undefined && typeof args.size !== 'string') throw new Error('Invalid image size.');
        if (args.ratio !== undefined && typeof args.ratio !== 'string') throw new Error('Invalid image ratio.');
        if (args.quality !== undefined && (typeof args.quality !== 'string' || !['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(args.quality))) throw new Error('Invalid image quality.');
        if (args.n !== undefined && (typeof args.n !== 'number' || !Number.isInteger(args.n))) throw new Error('Invalid image count.');
        prepared = await options.imageExtensions?.generate_image?.prepare(args, signal);
        if (prepared?.inputImage && prepared.inputImages !== undefined) throw new Error('Use either inputImage or inputImages.');
        const ids = typeof args.referenceImageId === 'string' ? [args.referenceImageId] : (args.referenceImageIds as string[] | undefined) ?? [];
        const inputImages = prepared?.inputImage ? [prepared.inputImage] : prepared?.inputImages ?? [];
        if (inputImages.length && ids.length) throw new Error('Use either host input images or reference image IDs.');
        if (ids.length + inputImages.length > (matches[0].maxReferenceImages ?? 1)) throw new Error(`This image model supports at most ${matches[0].maxReferenceImages ?? 1} reference images.`);
        const references: string[] = [];
        for (const id of ids) {
          if (!options.loadImage) throw new Error('Image storage is not configured.');
          const blob = await options.loadImage(id);
          if (!blob) throw new Error('Reference image not found.');
          references.push(await blobToDataUrl(blob));
        }
        for (const image of inputImages) references.push(await blobToDataUrl(image));
        results = await generateImages(config, { modelConfigId: matches[0].id, prompt: args.prompt,
          ...(typeof args.size === 'string' ? { size: args.size } : {}), ...(typeof args.ratio === 'string' ? { ratio: args.ratio } : {}),
          ...(typeof args.quality === 'string' ? { quality: args.quality as ImageQuality } : {}), ...(typeof args.n === 'number' ? { n: args.n } : {})
        }, signal, references);
        model = matches[0].modelId;
        prompt = args.prompt;
      } catch (error) { if (!signal.aborted) failures++; throw error; }
      if (prepared) {
        try {
          const saved: SessionImage[] = [];
          if (options.saveImage) {
            try {
              for (const blob of results) {
                signal.throwIfAborted();
                const image = await options.saveImage(blob, `generated-${Date.now()}-${saved.length + 1}.${blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'}`);
                saved.push(image);
                options.onImage?.(image);
              }
              signal.throwIfAborted();
            } catch (error) {
              if (signal.aborted) throw error;
              throw new ImageApplicationError(`Image generation succeeded but saving failed: ${error instanceof Error ? error.message : String(error)}. Saved image IDs: ${saved.map(image => image.id).join(', ') || 'none'}. Do not automatically repeat image generation.`, error);
            }
          }
          const applied = await deliverImageResult(prepared, { images: results, model, prompt }, signal, undefined, undefined, options.saveImage ? saved : undefined);
          return saved.length && applied && typeof applied === 'object' && !Array.isArray(applied) ? { ...applied, images: saved } : applied;
        }
        catch (error) {
          if (error instanceof ImageApplicationError) applicationFailures.add(definition.name);
          throw error;
        }
      }
      const saved: SessionImage[] = [];
      try {
        for (const blob of results) {
          signal.throwIfAborted();
          const image = await options.saveImage!(blob, `generated-${Date.now()}-${saved.length + 1}.${blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'}`);
          saved.push(image);
          options.onImage?.(image);
        }
        signal.throwIfAborted();
        return { images: saved.map(image => ({ id: image.id, name: image.name, type: image.type, size: image.size })),
          model, prompt };
      } catch (error) { if (!signal.aborted) failures++; throw error; }
    }
  }));
  const imagePrompt = imageModels.length ? config.imageToolPrompt?.trim() : '';
  const skillPrompt = skillsPrompt(skills);
  const basePrompt = imagePrompt && !config.systemPrompt.includes(imagePrompt) ? `${config.systemPrompt}\n\n${imagePrompt}` : config.systemPrompt;
  return { tools, instructions: skillPrompt && !basePrompt.includes(skillPrompt) ? `${basePrompt}\n\n${skillPrompt}` : basePrompt };
}