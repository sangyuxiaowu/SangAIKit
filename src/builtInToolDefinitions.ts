import type { ResponsesTool } from './openai';
import type { AiConfig, AiSkillConfig } from './settingsTypes';
import type { ImagePromptConfig } from './image-generation/types';
import { imageCapabilities, imageModelToolId } from './image-generation/index';
import { normalizeAiFeatures, type AiFeatures } from './features';
import { backgroundRemovalDefinition } from './background-removal/tool';
import { extendImageToolDefinition, type ImageToolExtensions } from './imageToolHost';
import { normalizeLocalFonts } from './fonts';

export type BuiltInToolDefinition = Pick<ResponsesTool, 'name' | 'description' | 'parameters'>;

export function imageToolDefinitions(models: ImagePromptConfig[] = []): BuiltInToolDefinition[] {
  if (!models.length) return [];
  const single = models.length === 1 ? models[0] : undefined;
  const properties: Record<string, Record<string, unknown>> = {
    modelConfigId: { type: 'string', description: '模型 ID，来自 list_image_models。', maxLength: 9, enum: models.map(imageModelToolId) },
    prompt: { type: 'string', maxLength: 10000, minLength: 1, description: '生图提示词' },
    size: { type: 'string', description: '输出尺寸，省略使用配置默认值。分辨率越高生图越慢。' },
    ratio: { type: 'string', description: '宽高比（如16:9）。仅部分模型支持，当不传 size 时生效。' },
    quality: { type: 'string', description: '生成质量。越高越慢，省略用默认值。' },
    referenceImageId: { type: 'string', description: '可选，原图 ID，来自附件或工具返回，作为参考图。' },
    n: { type: 'integer', minimum: 1, maximum: 10, description: '可选，生成数量，省略使用模型配置；须在模型支持范围内。' }
  };
  if (single) {
    delete properties.modelConfigId;
    const capabilities = imageCapabilities(single);
    properties.size.description += ` 默认值：${single.size}；${capabilities.exactSizeSupported ? '推荐尺寸' : '支持尺寸'}：${capabilities.sizes.join('、')}。`;
    if (!capabilities.ratios) delete properties.ratio;
    else properties.ratio = { type: 'string', description: `仅档位尺寸使用；省略为 ${single.ratio}。`, enum: capabilities.ratios };
    if (!capabilities.qualities) delete properties.quality;
    else properties.quality = { type: 'string', description: `生成质量。越高越慢，省略为 ${single.quality ?? 'high'}。`, enum: capabilities.qualities };
    if (!capabilities.maxImages) delete properties.n;
    else properties.n.maximum = capabilities.maxImages;
  }
  return [
    ...(!single ? [{ name: 'list_image_models', description: '读取可用生图模型、能力及参数信息。', parameters: { type: 'object', properties: {} } }] : []),
    { name: 'generate_image', description: '生成或修改图像，保存后返回图片 ID。需要插入文档或画布时，继续调用宿主提供的放置工具。',
      parameters: { type: 'object', properties, required: single ? ['prompt'] : ['modelConfigId', 'prompt'] } }
  ];
}

export function builtInToolDefinitions(options: {
  features?: Partial<AiFeatures>;
  skills?: AiSkillConfig[];
  config?: Partial<AiConfig>;
  imageModels?: ImagePromptConfig[];
  imageStorage?: boolean;
  imageExtensions?: ImageToolExtensions;
} = {}): BuiltInToolDefinition[] {
  const features = normalizeAiFeatures(options.features);
  const skills = features.skills ? options.skills ?? [] : [];
  const fonts = features.fontManagement ? normalizeLocalFonts(options.config?.localFonts) : [];
  const fontSources = [
    ...(fonts.length ? ['用户提供的本地字体'] : []),
    ...(features.onlineFonts ? ['内置 Google Fonts 精选目录'] : [])
  ];
  return [
    ...(features.backgroundRemoval && (options.imageStorage || options.imageExtensions?.remove_background)
      ? [extendImageToolDefinition(backgroundRemovalDefinition, options.imageExtensions?.remove_background)] : []),
    ...(features.fontManagement && fontSources.length ? [{ name: 'list_fonts', description: `读取${fontSources.join('及')}，使用 family 设置字体。`, parameters: { type: 'object', properties: {} } }] : []),
    ...(skills.length ? [{ name: 'skill', description: '读取 SKILL。', parameters: { type: 'object', properties: {
      name: { type: 'string', description: 'SKILL 精确名称，来自 available_skills 列表。', enum: skills.map(skill => skill.name) }
    }, required: ['name'] } }] : []),
    ...(features.imageGeneration && (options.imageStorage || options.imageExtensions?.generate_image)
      ? imageToolDefinitions(options.imageModels).map(definition => definition.name === 'generate_image'
        ? extendImageToolDefinition(definition, options.imageExtensions?.generate_image) : definition) : [])
  ];
}
