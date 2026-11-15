import type { AssistantSession, RequestUsage, TokenUsage } from './assistantTypes';
import type { UsageSummary } from './TokenUsageBar';

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
  const requests = session?.requests || [];
  const last = [...(session?.entries || [])].reverse().find(entry => entry.role === 'assistant');
  const currentRequests = requests.filter(request => request.entryId === last?.id);
  const matching = [...requests].reverse().find(request => request.usage && request.endpoint.replace(/\/+$/, '') === endpoint.replace(/\/+$/, '') && request.model === model.modelId);
  const history = session?.responseItems || [];
  const projected = prompt.trim() ? [...history, { role: 'user', content: prompt.trim() }] : history;
  const estimate = estimateResponseInput(projected, instructions);
  const contextTokens = matching?.usage && matching.inputEstimate !== undefined ? Math.max(0, matching.usage.inputTokens + estimate - matching.inputEstimate) : estimate;
  const contextWindow = model.contextWindow || 128000;
  const percent = contextTokens / contextWindow * 100;
  const toolItems = history.filter(item => item && typeof item === 'object' && 'type' in item && (item.type === 'function_call' || item.type === 'function_call_output'));
  const messages = history.filter(item => !toolItems.includes(item));
  const systemAndTools = estimateResponseInput([], instructions);
  const canvasAndToolData = Math.ceil(new TextEncoder().encode(JSON.stringify(toolItems)).length / 3);
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
    breakdown: { systemAndTools, canvasAndToolData, historyMessages, currentTurnEstimate, contextWindow, safetyLevel },
    performance: { turnDurationMs, turnTokensPerSec, avgTokensPerSec } };
}