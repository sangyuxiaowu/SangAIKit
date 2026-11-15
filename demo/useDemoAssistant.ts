import { availableImageModels, blobToDataUrl, createIndexedDbImageStore, createResponsesSender, generateImages, listFonts, readSkill, resolveSelection, skillsPrompt, useAssistant, type AiConfig, type AssistantSnapshot, type AssistantStorage, type ChatMessage, type ImageQuality, type ResponsesTool } from '../src';
import type { AssistantController, ToolEvent } from '../src/assistantTypes';
import type { SessionImage } from '../src/sessionTypes';

const storageKey = 'sang-ai-kit-demo-snapshot-v2';
const images = createIndexedDbImageStore('sang-ai-kit-demo-images-v1');
export const loadDemoImage = (sessionId: string, imageId: string) => images.loadImage(sessionId, imageId);
const storage: AssistantStorage = {
  async load() {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) as AssistantSnapshot : null;
  },
  async save(snapshot) { localStorage.setItem(storageKey, JSON.stringify(snapshot)); },
  images
};

export function useDemoAssistant(config: AiConfig): AssistantController {
  return useAssistant(async (entries, events) => {
    const { endpoint, model } = resolveSelection(config);
    if (endpoint.id === 'local-demo') {
      const tool: ToolEvent = { id: crypto.randomUUID(), name: 'demo_context', arguments: '{}', status: 'running', startedAt: Date.now() };
      events.onTool(tool);
      await new Promise(resolve => setTimeout(resolve, 350));
      events.signal.throwIfAborted();
      events.onTool({ ...tool, status: 'success', durationMs: 350, result: '{"status":"ready"}' });
      const text = `这是本地演示回复，未调用远程模型。\n\n你刚才输入的是：${entries[entries.length - 1].content}`;
      for (let index = 0; index < text.length; index += 8) {
        events.signal.throwIfAborted();
        await new Promise(resolve => setTimeout(resolve, 40));
        events.onText(text.slice(index, index + 8));
      }
      events.onHistory([...events.history, { role: 'user', content: entries[entries.length - 1].content }, { role: 'assistant', content: text }]);
    } else {
      const messages: ChatMessage[] = await Promise.all(entries.filter(entry => entry.content.trim() || entry.images?.length).map(async entry => {
        const refs = entry.images || [];
        const content = `${entry.content}${refs.length ? `\n[图片附件：${refs.map(image => `${image.name} (${image.id})`).join(', ')}]` : ''}`;
        const inputImages = entry.role === 'user' ? refs.map(image => `attachment://${image.id}`) : [];
        return { role: entry.role, content, ...(inputImages.length ? { images: inputImages } : {}) };
      }));
      const skills = config.skills || [];
      const tools: ResponsesTool[] = [{ name: 'read_workspace', description: 'Read the current demo workspace metadata.', parameters: { type: 'object', properties: {} }, execute: async () => ({ name: '演示工作区' }) }];
      tools.push({ name: 'list_fonts', description: 'List selected local fonts and curated Google fonts.', parameters: { type: 'object', properties: {} }, execute: async () => listFonts(config.localFonts) });
      if (skills.length) tools.push({ name: 'skill', description: 'Read the full text of an available skill.', parameters: { type: 'object', properties: { name: { type: 'string', enum: skills.map(skill => skill.name) } }, required: ['name'] }, execute: async args => readSkill(skills, args) });
      const imageModels = availableImageModels(config);
      let generatedImage: SessionImage | undefined;
      let imageFailures = 0;
      if (imageModels.length) tools.push({
        name: 'generate_image', description: `Generate images using a configured model: ${imageModels.map(item => `${item.label} (${item.id})`).join(', ')}.`,
        parameters: { type: 'object', properties: { modelConfigId: { type: 'string', enum: imageModels.map(item => item.id) }, prompt: { type: 'string' }, referenceImageId: { type: 'string' }, size: { type: 'string' }, ratio: { type: 'string' }, quality: { type: 'string' }, n: { type: 'integer' } }, required: ['modelConfigId', 'prompt'] },
        execute: async args => {
          if (imageFailures >= (config.maxImageFailures ?? 3)) throw new Error('Image generation failure limit reached in this turn.');
          try {
            if (typeof args.modelConfigId !== 'string' || typeof args.prompt !== 'string') throw new Error('A model ID and prompt are required.');
            if (args.referenceImageId !== undefined && typeof args.referenceImageId !== 'string') throw new Error('Invalid reference image ID.');
            if (args.size !== undefined && typeof args.size !== 'string') throw new Error('Invalid image size.');
            if (args.ratio !== undefined && typeof args.ratio !== 'string') throw new Error('Invalid image ratio.');
            if (args.quality !== undefined && (typeof args.quality !== 'string' || !['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(args.quality))) throw new Error('Invalid image quality.');
            if (args.n !== undefined && (typeof args.n !== 'number' || !Number.isInteger(args.n))) throw new Error('Invalid image count.');
            let reference: string | undefined;
            if (typeof args.referenceImageId === 'string') {
              const blob = await events.loadImage(args.referenceImageId);
              if (!blob) throw new Error('Reference image not found.');
              reference = await blobToDataUrl(blob);
            }
            const results = await generateImages(config, { modelConfigId: args.modelConfigId, prompt: args.prompt,
              ...(typeof args.size === 'string' ? { size: args.size } : {}), ...(typeof args.ratio === 'string' ? { ratio: args.ratio } : {}),
              ...(typeof args.quality === 'string' ? { quality: args.quality as ImageQuality } : {}), ...(typeof args.n === 'number' ? { n: args.n } : {})
            }, events.signal, reference);
            const saved: SessionImage[] = [];
            for (const blob of results) saved.push(await events.saveImage(blob, `generated-${Date.now()}-${saved.length + 1}.${blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'}`));
            generatedImage = saved[0];
            return { images: saved.map(image => ({ id: image.id, name: image.name, type: image.type, size: image.size })) };
          } catch (error) { if (!events.signal.aborted) imageFailures++; throw error; }
        }
      });
      await createResponsesSender({ baseURL: endpoint.endpoint, apiKey: endpoint.apiKey, model: model.modelId,
        instructions: [config.systemPrompt, skillsPrompt(skills)].filter(Boolean).join('\n\n'), maxOutputTokens: model.maxTokens, onReasoning: events.onReasoning, onUsage: events.onUsage,
        history: events.history, onHistory: events.onHistory,
        supportsVision: model.supportsVision, loadImage: events.loadImage,
        onTool: tool => { if (tool.name === 'generate_image' && tool.status === 'running') generatedImage = undefined; events.onTool(tool.name === 'generate_image' && tool.status === 'success' && generatedImage ? { ...tool, image: generatedImage } : tool); }, tools, maxToolRounds: config.maxToolRounds,
        ...(model.thinkingAvailable ? { reasoningEffort: model.thinkingEnabled ? model.reasoningEffort : 'none' } : {})
      })(messages, events.signal, events.onText);
    }
  }, storage);
}