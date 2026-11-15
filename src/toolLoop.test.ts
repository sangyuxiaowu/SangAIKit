import { expect, test } from 'bun:test';
import { runToolLoop, type ToolLoopOptions } from './toolLoop';

type Item = { type: string; value: string };
type Call = { call_id: string; name: string };
const signal = () => new AbortController().signal;

test('executes tool calls and preserves output history for the next round', async () => {
  const history: Item[][] = [];
  const input: Item[] = [];
  const text: string[] = [];
  let rounds = 0;
  const options: ToolLoopOptions<Item, Call> = {
    input, signal: signal(), maxRounds: 3,
    request: async () => ++rounds === 1
      ? { content: '', streamedText: '', output: [{ type: 'call', value: 'read' }], calls: [{ call_id: '1', name: 'read' }], unsupportedOutput: false }
      : { content: 'done', streamedText: '', output: [{ type: 'message', value: 'done' }], calls: [], unsupportedOutput: false },
    execute: async call => ({ output: { type: 'result', value: call.name }, cancelled: false }),
    assistantMessage: value => ({ type: 'message', value }), onText: value => text.push(value), onHistory: value => history.push(value), cancelledMessage: 'cancelled', limitMessage: 'limit'
  };
  expect(await runToolLoop(options)).toBe('done');
  expect(input.map(item => item.type)).toEqual(['call', 'result', 'message']);
  expect(history).toHaveLength(2);
  expect(text).toEqual(['done']);
});

test('preserves completed work at the round limit', async () => {
  let limited = false;
  const input: Item[] = [];
  const result = await runToolLoop<Item, Call>({ input, signal: signal(), maxRounds: 1,
    request: async () => ({ content: '', streamedText: '', output: [], calls: [{ call_id: '1', name: 'read' }], unsupportedOutput: false }),
    execute: async () => ({ output: { type: 'result', value: 'ok' }, cancelled: false }),
    assistantMessage: value => ({ type: 'message', value }), onText: () => {}, onLimit: () => { limited = true; }, cancelledMessage: 'cancelled', limitMessage: 'limit'
  });
  expect(result).toBe('limit');
  expect(limited).toBe(true);
  expect(input).toEqual([{ type: 'result', value: 'ok' }, { type: 'message', value: 'limit' }]);
});