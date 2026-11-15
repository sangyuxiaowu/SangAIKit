export interface ToolCall { call_id: string; name: string }
export interface ToolLoopResponse<Item, Call extends ToolCall> {
  content: string;
  streamedText: string;
  output: Item[];
  calls: Call[];
  unsupportedOutput: boolean;
}
export interface ToolLoopOptions<Item, Call extends ToolCall> {
  input: Item[];
  signal: AbortSignal;
  maxRounds: number;
  request: (input: Item[]) => Promise<ToolLoopResponse<Item, Call>>;
  execute: (call: Call, cancelled: boolean) => Promise<{ output: Item; cancelled: boolean }>;
  assistantMessage: (content: string) => Item;
  onText: (text: string) => void;
  onHistory?: (input: Item[]) => void;
  onLimit?: () => void;
  cancelledMessage: string;
  limitMessage: string;
}

export async function runToolLoop<Item, Call extends ToolCall>(options: ToolLoopOptions<Item, Call>): Promise<string> {
  const { input, signal } = options;
  if (!Number.isSafeInteger(options.maxRounds) || options.maxRounds < 0) throw new Error('Tool round limit must be a non-negative safe integer.');
  for (let round = 0; options.maxRounds === 0 || round < options.maxRounds; round++) {
    signal.throwIfAborted();
    const response = await options.request(input);
    if (response.content && !response.streamedText) options.onText(response.content);
    if (!response.content && !response.calls.length) throw new Error('Empty model response.');
    if (response.calls.length > 30 || response.calls.some(call => !call.call_id || !call.name)) throw new Error('Invalid or too many tool calls.');
    if (response.unsupportedOutput) throw new Error('Unsupported model output item.');
    input.push(...response.output);
    let cancelled = false;
    for (const call of response.calls) {
      const result = await options.execute(call, cancelled);
      input.push(result.output);
      if (result.cancelled) cancelled = true;
    }
    if (cancelled) input.push(options.assistantMessage(options.cancelledMessage));
    options.onHistory?.(structuredClone(input));
    signal.throwIfAborted();
    if (cancelled) return options.cancelledMessage;
    if (!response.calls.length) return response.content;
  }
  options.onLimit?.();
  input.push(options.assistantMessage(options.limitMessage));
  options.onHistory?.(structuredClone(input));
  return options.limitMessage;
}