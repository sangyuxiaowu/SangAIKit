import type { AssistantActivityEvent, AssistantSession, RequestUsage, TokenUsage } from './assistantTypes';
import type { UsageSummary } from './TokenUsageBar';
import { blobToDataUrl } from './imageAttachments';
import { generateId } from './id';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function appendReasoningActivity(activity: AssistantActivityEvent[], text: string, itemId?: string): AssistantActivityEvent[] {
  const next = [...activity];
  const index = itemId
    ? next.findIndex(item => item.type === 'reasoning' && item.id === itemId)
    : next.at(-1)?.type === 'reasoning' ? next.length - 1 : -1;
  const existing = next[index];
  if (existing?.type === 'reasoning') next[index] = { ...existing, text: existing.text + text };
  else next.push({ id: itemId || generateId(), type: 'reasoning', text });
  return next;
}

export function orderResponseActivity(items: unknown[], activity: AssistantActivityEvent[]): AssistantActivityEvent[] {
  const result: AssistantActivityEvent[] = [];
  const reasoning = activity.filter(item => item.type === 'reasoning');
  const usedReasoning = new Set<string>();
  const textParts = (value: unknown) => Array.isArray(value)
    ? value.flatMap(part => isRecord(part) && typeof part.text === 'string' ? [part.text]
      : isRecord(part) && typeof part.refusal === 'string' ? [part.refusal] : []).join('')
    : typeof value === 'string' ? value : '';
  for (const [index, value] of items.entries()) {
    if (!isRecord(value)) continue;
    if (value.type === 'reasoning') {
      const id = typeof value.id === 'string' && value.id ? value.id : `reasoning-${index}`;
      const streamed = reasoning.find(part => part.id === id && !usedReasoning.has(part.id))
        || reasoning.find(part => !usedReasoning.has(part.id) && !items.some(candidate => isRecord(candidate) && candidate.id === part.id));
      if (streamed) usedReasoning.add(streamed.id);
      const text = streamed?.text || textParts(value.summary) || textParts(value.content);
      if (text) result.push({ id, type: 'reasoning', text });
    } else if (value.type === 'function_call' && typeof value.call_id === 'string' && value.call_id) {
      result.push({ id: value.call_id, type: 'tool', toolId: value.call_id });
    } else if (value.role === 'assistant' || value.type === 'message' && value.role !== 'user') {
      const text = textParts(value.content);
      if (text) result.push({ id: typeof value.id === 'string' && value.id ? value.id : `message-${index}`, type: 'text', text });
    }
  }
  if (reasoning.length && !items.some(value => isRecord(value) && value.type === 'reasoning')) return activity;
  if (!result.some(item => item.type === 'text')) result.push(...activity.filter(item => item.type === 'text'));
  return result;
}

export async function prepareResponseInput<Item extends object>(
  input: Item[],
  supportsVision: boolean,
  loadImage?: (imageId: string) => Promise<Blob | null>
): Promise<Item[]> {
  const copy = structuredClone(input);
  const hydrate = async (parts: unknown[]) => Promise.all(parts.map(async part => {
    if (!isRecord(part) || part.type !== 'input_image') return part;
    if (!supportsVision) return { type: 'input_text', text: '[Image not provided: the current model does not support image input.]' };
    if (typeof part.image_url !== 'string' || !part.image_url.startsWith('attachment://')) return part;
    const blob = await loadImage?.(part.image_url.slice('attachment://'.length));
    if (!blob) throw new Error('A referenced chat image is missing.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('A referenced image must be PNG, JPEG or WebP.');
    return { ...part, image_url: await blobToDataUrl(blob) };
  }));
  for (const item of copy) {
    if ('content' in item && Array.isArray(item.content)) Object.assign(item, { content: await hydrate(item.content) });
    if ('type' in item && item.type === 'function_call_output' && 'output' in item && Array.isArray(item.output)) {
      Object.assign(item, { output: await hydrate(item.output) });
    }
  }
  return copy;
}

export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

export function normalizeUsage(usage: ResponseUsage | null | undefined): TokenUsage | undefined {
  if (!usage || ![usage.input_tokens, usage.output_tokens, usage.total_tokens].every(value => Number.isInteger(value) && value >= 0)) return undefined;
  const cached = usage.input_tokens_details?.cached_tokens;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  return {
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens,
    ...(cached !== undefined && Number.isInteger(cached) && cached >= 0 ? { cachedTokens: cached } : {}),
    ...(reasoning !== undefined && Number.isInteger(reasoning) && reasoning >= 0 ? { reasoningTokens: reasoning } : {})
  };
}

export function sanitizeResponseItems<Item extends object>(items: Item[]): Item[] {
  const pendingCalls = new Set<string>();
  for (const item of items) {
    if (!('type' in item) || !('call_id' in item) || typeof item.call_id !== 'string' || !item.call_id) continue;
    if (item.type === 'function_call') pendingCalls.add(item.call_id);
    else if (item.type === 'function_call_output') pendingCalls.delete(item.call_id);
  }
  return pendingCalls.size ? items.filter(item => !('type' in item && item.type === 'function_call' && 'call_id' in item && typeof item.call_id === 'string' && pendingCalls.has(item.call_id))) : [...items];
}

export function sumUsage(requests: Pick<RequestUsage, 'usage'>[]): TokenUsage | undefined {
  const known = requests.filter(request => request.usage);
  if (!known.length) return undefined;
  return known.reduce<TokenUsage>((total, request) => {
    const usage = request.usage!;
    return { inputTokens: total.inputTokens + usage.inputTokens, outputTokens: total.outputTokens + usage.outputTokens, totalTokens: total.totalTokens + usage.totalTokens,
      ...(usage.cachedTokens !== undefined || total.cachedTokens !== undefined ? { cachedTokens: (total.cachedTokens || 0) + (usage.cachedTokens || 0) } : {}),
      ...(usage.reasoningTokens !== undefined || total.reasoningTokens !== undefined ? { reasoningTokens: (total.reasoningTokens || 0) + (usage.reasoningTokens || 0) } : {}) };
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
}

export function estimateResponseInput(input: unknown[], instructions: string): number {
  return Math.ceil(new TextEncoder().encode(JSON.stringify({ input, instructions })).length / 3);
}

export function sessionUsageSummary(session: AssistantSession | undefined, model: { modelId: string; contextWindow: number; maxTokens: number }, endpoint: string, instructions: string, prompt: string): UsageSummary {
  const effectiveInstructions = session?.sentSystemPrompt ?? (session?.systemPrompt !== undefined ? session.systemPrompt : instructions);
  const requests = session?.requests || [];
  const last = [...(session?.entries || [])].reverse().find(entry => entry.role === 'assistant');
  const currentRequests = requests.filter(request => request.entryId === last?.id);
  const matching = [...requests].reverse().find(request => request.usage && request.endpoint.replace(/\/+$/, '') === endpoint.replace(/\/+$/, '') && request.model === model.modelId);
  const history = session?.responseItems || [];
  const projected = prompt.trim() ? [...history, { role: 'user', content: prompt.trim() }] : history;
  const estimate = estimateResponseInput(projected, effectiveInstructions);
  const contextTokens = matching?.usage && matching.inputEstimate !== undefined ? Math.max(0, matching.usage.inputTokens + estimate - matching.inputEstimate) : estimate;
  const contextWindow = model.contextWindow || 128000;
  const percent = contextTokens / contextWindow * 100;
  const toolItems = history.filter(item => item && typeof item === 'object' && 'type' in item && (item.type === 'function_call' || item.type === 'function_call_output'));
  const messages = history.filter(item => !toolItems.includes(item));
  const systemAndTools = estimateResponseInput([], effectiveInstructions);
  const toolData = Math.ceil(new TextEncoder().encode(JSON.stringify(toolItems)).length / 3);
  const historyMessages = Math.ceil(new TextEncoder().encode(JSON.stringify(messages)).length / 3);
  const currentTurnEstimate = prompt.trim() ? Math.ceil(new TextEncoder().encode(prompt.trim()).length / 3) : 0;
  const current = sumUsage(currentRequests);
  const turnDurationMs = currentRequests.filter(request => request.status === 'completed').reduce((total, request) => total + (request.durationMs || 0), 0) || last?.durationMs;
  const turnTokensPerSec = turnDurationMs && current?.outputTokens ? Math.round(current.outputTokens / (turnDurationMs / 1000) * 10) / 10 : undefined;
  const completed = requests.filter(request => request.status === 'completed' && request.durationMs && request.usage);
  const duration = completed.reduce((total, request) => total + (request.durationMs || 0), 0);
  const output = completed.reduce((total, request) => total + (request.usage?.outputTokens || 0), 0);
  const avgTokensPerSec = duration && output ? Math.round(output / (duration / 1000) * 10) / 10 : undefined;
  const safetyLevel = contextTokens + model.maxTokens > contextWindow || percent > 85 ? 'danger' : percent > 60 ? 'warning' : 'safe';
  return { total: sumUsage(requests), current, contextTokens, reservedOutput: model.maxTokens, percent, requestCount: requests.length,
    breakdown: { systemAndTools, toolData, historyMessages, currentTurnEstimate, contextWindow, safetyLevel },
    performance: { turnDurationMs, turnTokensPerSec, avgTokensPerSec } };
}