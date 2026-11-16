import type { ReasoningEffort } from './modelConfig';

type CompletedResponse<Event> = Extract<Event, { type: 'response.completed' }> extends { response: infer Result } ? Result : never;

export function reasoningRequestParams(model: string, effort?: ReasoningEffort) {
  if (!effort) return {};
  if (effort === 'none' && model.toLowerCase().startsWith('agnes')) return { chat_template_kwargs: { enable_thinking: false } };
  return { reasoning: { effort } };
}

export function openAiAuthOptions(apiKey?: string) {
  if (apiKey?.trim()) return { apiKey };
  // The SDK requires a nonempty constructor key even when Authorization is explicitly omitted.
  return { apiKey: 'local', defaultHeaders: { Authorization: null } };
}

export async function readResponse<Event extends { type: string }>(events: AsyncIterable<Event>, onText: (text: string) => void, signal: AbortSignal, onReasoning?: (text: string, itemId?: string) => void): Promise<CompletedResponse<Event>> {
  for await (const event of events) {
    signal.throwIfAborted();
    const detail = event as { type: string; delta?: string; item_id?: string; message?: string; response?: unknown };
    if (detail.type === 'response.output_text.delta') onText(detail.delta!);
    if (detail.type === 'response.reasoning_text.delta' || detail.type === 'response.reasoning_summary_text.delta') onReasoning?.(detail.delta!, detail.item_id);
    if (detail.type === 'error') throw new Error(detail.message || 'AI stream returned an error.');
    if (detail.type === 'response.completed' || detail.type === 'response.incomplete' || detail.type === 'response.failed') return detail.response as CompletedResponse<Event>;
  }
  throw new Error('AI stream disconnected before completion.');
}