type CompletedResponse<Event> = Extract<Event, { type: 'response.completed' }> extends { response: infer Result } ? Result : never;

export async function readResponse<Event extends { type: string }>(events: AsyncIterable<Event>, onText: (text: string) => void, signal: AbortSignal, onReasoning?: (text: string) => void): Promise<CompletedResponse<Event>> {
  for await (const event of events) {
    signal.throwIfAborted();
    const detail = event as { type: string; delta?: string; message?: string; response?: unknown };
    if (detail.type === 'response.output_text.delta') onText(detail.delta!);
    if (detail.type === 'response.reasoning_text.delta' || detail.type === 'response.reasoning_summary_text.delta') onReasoning?.(detail.delta!);
    if (detail.type === 'error') throw new Error(detail.message || 'AI stream returned an error.');
    if (detail.type === 'response.completed' || detail.type === 'response.incomplete' || detail.type === 'response.failed') return detail.response as CompletedResponse<Event>;
  }
  throw new Error('AI stream disconnected before completion.');
}