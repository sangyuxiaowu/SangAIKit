import { expect, test } from 'bun:test';
import type { Response, ResponseStreamEvent } from 'openai/resources/responses/responses';
import { readResponse } from './responses';

async function* events(items: unknown[]): AsyncIterable<ResponseStreamEvent> {
  for (const item of items) yield item as ResponseStreamEvent;
}

test('reads text and reasoning before returning the completed response', async () => {
  const text: string[] = [];
  const reasoning: string[] = [];
  const response = { id: 'response' } as Response;
  const result = await readResponse(events([
    { type: 'response.output_text.delta', delta: 'hello' },
    { type: 'response.reasoning_summary_text.delta', delta: 'thinking' },
    { type: 'response.completed', response }
  ]), value => text.push(value), new AbortController().signal, value => reasoning.push(value));
  expect(result).toBe(response);
  expect(text).toEqual(['hello']);
  expect(reasoning).toEqual(['thinking']);
});

test('reports stream errors and disconnections', async () => {
  const signal = new AbortController().signal;
  await expect(readResponse(events([{ type: 'error', message: 'failed' }]), () => {}, signal)).rejects.toThrow('failed');
  await expect(readResponse(events([]), () => {}, signal)).rejects.toThrow('disconnected');
});

test('stops when aborted', async () => {
  const controller = new AbortController();
  controller.abort(new Error('stopped'));
  await expect(readResponse(events([{ type: 'response.output_text.delta', delta: 'ignored' }]), () => {}, controller.signal)).rejects.toThrow('stopped');
});