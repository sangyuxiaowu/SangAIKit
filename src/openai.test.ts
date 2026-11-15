import { expect, test } from 'bun:test';
import { createResponsesSender } from './openai';
import { createEndpoint } from './modelConfig';

test('sends message history and streams text without storing the response', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp","status":"completed","output":[]}}\n\n'
    ].join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const text: string[] = [];
    const send = createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'test', model: 'model' });
    await send([{ role: 'user', content: 'Hi' }], new AbortController().signal, chunk => text.push(chunk));
    expect(text).toEqual(['Hello']);
    expect(requestBody.store).toBe(false);
    expect(requestBody.model).toBe('model');
    expect(requestBody.input).toEqual([{ role: 'user', content: 'Hi' }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('uses completed response text when no deltas arrive', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => new Response('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Done"}]}]}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), { preconnect: originalFetch.preconnect });
  try {
    const text: string[] = [];
    const send = createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'test', model: 'model' });
    await send([], new AbortController().signal, chunk => text.push(chunk));
    expect(text).toEqual(['Done']);
  } finally { globalThis.fetch = originalFetch; }
});

test('rejects unsafe endpoint URLs', () => {
  expect(() => createResponsesSender({ baseURL: 'https://example.com/v1?key=secret', apiKey: '', model: 'model' })).toThrow();
  expect(() => createResponsesSender({ baseURL: 'https://user:secret@example.com/v1', apiKey: '', model: 'model' })).toThrow();
});

test('executes an injected tool and returns its result to the next model round', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const output = requests.length === 1
      ? [{ type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"query":"hello"}' }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Finished' }] }];
    const payload = { type: 'response.completed', response: { status: 'completed', output } };
    return new Response(`event: response.completed\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const events: string[] = [];
    const text: string[] = [];
    const send = createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'test', model: 'model', maxToolRounds: 0,
      tools: [{ name: 'lookup', description: 'Read an item', parameters: { type: 'object' }, execute: async args => ({ found: args.query }) }],
      onTool: event => events.push(event.status)
    });
    await send([{ role: 'user', content: 'Find hello' }], new AbortController().signal, chunk => text.push(chunk));
    expect(requests).toHaveLength(2);
    expect(events).toEqual(['running', 'success']);
    expect(text).toEqual(['Finished']);
    expect(requests[1].input).toContainEqual({ type: 'function_call_output', call_id: 'call-1', output: '{"found":"hello"}' });
  } finally { globalThis.fetch = originalFetch; }
});

test('sends local image data and rejects external image URLs', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const send = createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'test', model: 'model' });
    await send([{ role: 'user', content: 'Describe', images: ['data:image/png;base64,YQ=='] }], new AbortController().signal, () => {});
    expect(requestBody.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'Describe' }, { type: 'input_image', image_url: 'data:image/png;base64,YQ==', detail: 'auto' }] }]);
    await expect(send([{ role: 'user', content: 'Describe', images: ['https://example.com/image.png'] }], new AbortController().signal, () => {})).rejects.toThrow('local PNG');
  } finally { globalThis.fetch = originalFetch; }
});

test('hydrates image references only for vision requests and preserves compact history', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  let saved: unknown[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const config = { baseURL: 'https://example.com/v1', apiKey: 'test', model: 'model', loadImage: async () => new Blob(['a'], { type: 'image/png' }), onHistory: (items: unknown[]) => { saved = items; } };
    await createResponsesSender(config)([{ role: 'user', content: 'Describe', images: ['attachment://image-1'] }], new AbortController().signal, () => {});
    expect(JSON.stringify(requests[0].input)).toContain('data:image/png;base64,YQ==');
    expect(JSON.stringify(saved)).toContain('attachment://image-1');
    expect(JSON.stringify(saved)).not.toContain('data:image/png');
    await createResponsesSender({ ...config, history: saved, supportsVision: false, loadImage: async () => { throw new Error('must not load'); } })([{ role: 'user', content: 'Continue' }], new AbortController().signal, () => {});
    expect(JSON.stringify(requests[1].input)).toContain('current model does not support image input');
    expect(JSON.stringify(saved)).toContain('attachment://image-1');
  } finally { globalThis.fetch = originalFetch; }
});

test('aborts a stalled request at the configured timeout', async () => {
  const originalFetch = globalThis.fetch;
  const statuses: string[] = [];
  globalThis.fetch = (async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  try {
    const send = createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'test', model: 'model', timeoutMs: 5, onUsage: request => statuses.push(request.status) });
    await expect(send([{ role: 'user', content: 'wait' }], new AbortController().signal, () => {})).rejects.toThrow();
    expect(statuses).toEqual(['failed']);
  } finally { globalThis.fetch = originalFetch; }
});

test('built-in image integration does not send image tools or prompts without valid models', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const endpoint = createEndpoint('openai');
    const config = { endpoints: [endpoint], imageModels: [], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: 'System', imageToolPrompt: 'Image-only instructions' };
    const send = createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'test', model: 'model', builtIn: { config, features: { imageGeneration: true }, loadImage: async () => null, saveImage: async blob => ({ id: 'image', name: 'image.png', type: 'image/png', size: blob.size }) } });
    await send([{ role: 'user', content: 'hello' }], new AbortController().signal, () => {});
    expect(JSON.stringify(requestBody.tools)).not.toContain('generate_image');
    expect(requestBody.instructions).toBe('System');
  } finally { globalThis.fetch = originalFetch; }
});