import { expect, test } from 'bun:test';
import { appendReasoningActivity, orderResponseActivity } from './conversationUtils';

test('orders native reasoning, tool calls, text and refusal while retaining streamed reasoning', () => {
  let activity = appendReasoningActivity([], 'Plan', 'reason-1');
  activity = [...activity, { id: 'tool-1', type: 'tool', toolId: 'tool-1' }];
  activity = appendReasoningActivity(activity, ' ahead', 'reason-1');
  const result = orderResponseActivity([
    { type: 'reasoning', id: 'reason-1', summary: [] },
    { type: 'function_call', call_id: 'tool-1' },
    { type: 'message', id: 'message-1', role: 'assistant', content: [
      { type: 'output_text', text: 'Answer. ' }, { type: 'refusal', refusal: 'Cannot continue.' }
    ] }
  ], activity);
  expect(result).toEqual([
    { id: 'reason-1', type: 'reasoning', text: 'Plan ahead' },
    { id: 'tool-1', type: 'tool', toolId: 'tool-1' },
    { id: 'message-1', type: 'text', text: 'Answer. Cannot continue.' }
  ]);
});

test('retains streamed ordering when the provider omits native reasoning items', () => {
  const activity = [
    { id: 'reason-1', type: 'reasoning' as const, text: 'Thinking' },
    { id: 'tool-1', type: 'tool' as const, toolId: 'tool-1' }
  ];
  expect(orderResponseActivity([{ role: 'assistant', content: 'Done' }], activity)).toEqual(activity);
});
