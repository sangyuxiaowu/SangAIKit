import { createIndexedDbImageStore, createResponsesSender, resolveSelection, useAssistant, type AiConfig, type AiFeatures, type AssistantSnapshot, type AssistantStorage, type ChatMessage, type ResponsesTool } from '../src';
import type { AssistantController, AssistantForkEvent, ToolEvent } from '../src/assistantTypes';
import type { SessionImage } from '../src/sessionTypes';

const storageKey = 'sang-ai-kit-demo-snapshot-v2';
export const DEMO_FEATURES: Readonly<AiFeatures> = { imageGeneration: true, skills: true, quickSnippets: true, fontManagement: true, onlineFonts: true };
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

export function useDemoAssistant(config: AiConfig, features: Partial<AiFeatures> = DEMO_FEATURES): AssistantController {
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
      const tools: ResponsesTool[] = [{ name: 'read_workspace', description: 'Read the current demo workspace metadata.', parameters: { type: 'object', properties: {} }, execute: async () => ({ name: '演示工作区' }) }];
      let generatedImage: SessionImage | undefined;
      await createResponsesSender({ baseURL: endpoint.endpoint, apiKey: endpoint.apiKey, model: model.modelId,
        instructions: config.systemPrompt, builtIn: { config, features, loadImage: events.loadImage, saveImage: events.saveImage, onImage: image => { generatedImage ??= image; } },
        maxOutputTokens: model.maxTokens, onReasoning: events.onReasoning, onUsage: events.onUsage,
        history: events.history, onHistory: events.onHistory,
        supportsVision: model.supportsVision, loadImage: events.loadImage,
        onTool: tool => { if (tool.name === 'generate_image' && tool.status === 'running') generatedImage = undefined; events.onTool(tool.name === 'generate_image' && tool.status === 'success' && generatedImage ? { ...tool, image: generatedImage } : tool); }, tools, maxToolRounds: config.maxToolRounds,
        ...(model.thinkingAvailable ? { reasoningEffort: model.thinkingEnabled ? model.reasoningEffort : 'none' } : {})
      })(messages, events.signal, events.onText);
    }
  }, storage);
}

function responseCountThroughEntry(session: AssistantSnapshot['sessions'][number], entryIndex: number): number {
  const entry = session.entries[entryIndex];
  if (Number.isSafeInteger(entry.responseItemCount) && entry.responseItemCount! >= 0) return entry.responseItemCount!;
  const userTurns = session.entries.slice(0, entryIndex + 1).filter(item => item.role === 'user').length;
  let seenUsers = 0;
  const history = session.responseItems || [];
  for (let index = 0; index < history.length; index++) {
    const item = history[index];
    if (item && typeof item === 'object' && 'role' in item && item.role === 'user' && ++seenUsers > userTurns) return index;
  }
  return history.length;
}

export async function forkDemoConversation(assistant: AssistantController, event: AssistantForkEvent, reloadConversation: () => Promise<void>): Promise<void> {
  if (assistant.busy || assistant.saving || assistant.activeSessionId !== event.sessionId) throw new Error('The active conversation changed.');
  const source = assistant.sessions.find(session => session.id === event.sessionId);
  const entryIndex = source?.entries.findIndex(entry => entry.id === event.entryId) ?? -1;
  if (!source || entryIndex < 0 || source.entries[entryIndex].role !== 'assistant') throw new Error('The selected response is unavailable.');
  const responseItemCount = event.responseItemCount ?? responseCountThroughEntry(source, entryIndex);
  if (!Number.isSafeInteger(responseItemCount) || responseItemCount < 0 || responseItemCount > (source.responseItems?.length || 0)) throw new Error('The response history is unavailable.');
  const entries = structuredClone(source.entries.slice(0, entryIndex + 1));
  const entryIds = new Set(entries.map(entry => entry.id));
  const referenced = new Map<string, SessionImage>();
  for (const entry of entries) {
    for (const image of [...(entry.images || []), ...(entry.tools || []).flatMap(tool => tool.image ? [tool.image] : [])]) referenced.set(image.id, image);
  }
  const id = crypto.randomUUID();
  const copied: { sessionId: string; imageId: string }[] = [];
  try {
    for (const image of referenced.values()) {
      const blob = await images.loadImage(source.id, image.id);
      if (!blob) throw new Error(`Missing chat image: ${image.name}`);
      await images.saveImage(id, image.id, blob);
      copied.push({ sessionId: id, imageId: image.id });
    }
    const branch = {
      ...source,
      id,
      title: `${source.title} (分叉)`.slice(0, 120),
      updatedAt: Date.now(),
      entries,
      responseItems: structuredClone((source.responseItems || []).slice(0, responseItemCount)),
      requests: source.requests.filter(item => item.entryId && entryIds.has(item.entryId))
    };
    const stored = await storage.load();
    await storage.save({
      sessions: [branch, ...(stored?.sessions || assistant.sessions).filter(item => item.id !== branch.id)],
      activeSessionId: id
    });
    await reloadConversation();
  } catch (error) {
    await images.deleteImages(copied).catch(() => {});
    throw error;
  }
}