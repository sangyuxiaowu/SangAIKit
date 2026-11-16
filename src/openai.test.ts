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

test('uses Agnes thinking parameters only when thinking is disabled', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]}]}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  try {
    for (const model of ['agnes-3.0-flash', 'AgNeS-custom']) {
      await createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'test', model, reasoningEffort: 'none' })([], new AbortController().signal, () => {});
      expect(requestBody.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(requestBody.reasoning).toBeUndefined();
    }
    await createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'test', model: 'agnes-3.0-flash', reasoningEffort: 'medium' })([], new AbortController().signal, () => {});
    expect(requestBody.reasoning).toEqual({ effort: 'medium' });
    expect(requestBody.chat_template_kwargs).toBeUndefined();
    await createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'test', model: 'other-agnes', reasoningEffort: 'none' })([], new AbortController().signal, () => {});
    expect(requestBody.reasoning).toEqual({ effort: 'none' });
    expect(requestBody.chat_template_kwargs).toBeUndefined();
    await createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'test', model: 'agnes-3.0-flash' })([], new AbortController().signal, () => {});
    expect(requestBody.reasoning).toBeUndefined();
    expect(requestBody.chat_template_kwargs).toBeUndefined();
  } finally { globalThis.fetch = originalFetch; }
});

test('reports the exact Responses endpoint and request body without exposing credentials', async () => {
  const originalFetch = globalThis.fetch;
  let actualBody: Record<string, unknown> = {};
  let observed: { endpoint: string; body: Readonly<Record<string, unknown>> } | undefined;
  globalThis.fetch = Object.assign(async (target: string | URL | Request, init?: RequestInit) => {
    actualBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(String(target)).toContain('/responses');
    return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]}]}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  try {
    const send = createResponsesSender({ baseURL: 'https://example.com/v1', apiKey: 'secret-key', model: 'model', instructions: 'Final instructions', onRequest: request => { observed = request; } });
    await send([{ role: 'user', content: 'Say OK' }], new AbortController().signal, () => {});
    expect(observed?.endpoint).toBe('https://example.com/v1/responses');
    expect(observed?.body).toEqual(actualBody);
    expect(JSON.stringify(observed)).not.toContain('secret-key');
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

test('omits the authorization header when a proxy requires no API key', async () => {
  const originalFetch = globalThis.fetch;
  let authorization: string | null = 'not-called';
  globalThis.fetch = (async (_url, init) => {
    authorization = new Headers(init?.headers).get('authorization');
    return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    await createResponsesSender({ baseURL: 'https://example.com/v1', model: 'model' })([{ role: 'user', content: 'hello' }], new AbortController().signal, () => {});
    expect(authorization).toBeNull();
  } finally { globalThis.fetch = originalFetch; }
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

test('sends attachment and preview tool images as native multimodal input while keeping history compact', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  const events: { status: string; result?: string }[] = [];
  const loaded: string[] = [];
  let history: unknown[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const output = requests.length === 1
      ? [{ type: 'function_call', call_id: 'preview-call', name: 'preview_page', arguments: '{}' }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Finished' }] }];
    return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const send = createResponsesSender({
      baseURL: 'https://example.com/v1', model: 'model', supportsVision: true,
      loadImage: async id => {
        loaded.push(id);
        return new Blob([id === 'upload' ? 'a' : 'p'], { type: 'image/png' });
      },
      tools: [{
        name: 'preview_page', description: 'Preview document layout', parameters: { type: 'object' },
        execute: async () => ({ type: 'responses_tool_content', content: [
          { type: 'input_text', text: 'Page 1 preview' },
          { type: 'input_image', image_url: 'attachment://preview', detail: 'high' }
        ] })
      }],
      onHistory: items => { history = items; }, onTool: event => events.push(event)
    });
    await send([{ role: 'user', content: 'Inspect the attachment and page', images: ['attachment://upload'] }], new AbortController().signal, () => {});
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[0].input)).toContain('data:image/png;base64,YQ==');
    const input = requests[1].input;
    if (!Array.isArray(input)) throw new Error('Expected Responses input items.');
    expect(input).toContainEqual({ type: 'function_call_output', call_id: 'preview-call', output: [
      { type: 'input_text', text: 'Page 1 preview' },
      { type: 'input_image', image_url: 'data:image/png;base64,cA==', detail: 'high' }
    ] });
    expect(loaded).toContain('upload');
    expect(loaded).toContain('preview');
    expect(JSON.stringify(history)).toContain('attachment://preview');
    expect(JSON.stringify(history)).toContain('attachment://upload');
    expect(JSON.stringify(history)).not.toContain('data:image/png');
    expect(events.at(-1)?.status).toBe('success');
    expect(events.at(-1)?.result).toContain('Page 1 preview');
    expect(events.at(-1)?.result).not.toContain('data:image/png');
  } finally { globalThis.fetch = originalFetch; }
});

test('does not load tool images for a text-only model', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  let history: unknown[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const output = requests.length === 1
      ? [{ type: 'function_call', call_id: 'preview-call', name: 'preview_page', arguments: '{}' }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Finished' }] }];
    return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const send = createResponsesSender({
      baseURL: 'https://example.com/v1', model: 'model', supportsVision: false,
      loadImage: async () => { throw new Error('Image must not be loaded.'); },
      tools: [{ name: 'preview_page', description: 'Preview', parameters: { type: 'object' }, execute: async () => ({
        type: 'responses_tool_content', content: [{ type: 'input_image', image_url: 'attachment://preview' }]
      }) }],
      onHistory: items => { history = items; }
    });
    await send([{ role: 'user', content: 'Inspect' }], new AbortController().signal, () => {});
    const input = requests[1].input;
    if (!Array.isArray(input)) throw new Error('Expected Responses input items.');
    expect(input).toContainEqual({ type: 'function_call_output', call_id: 'preview-call', output: [
      { type: 'input_text', text: '[Image not provided: the current model does not support image input.]' }
    ] });
    expect(JSON.stringify(history)).toContain('attachment://preview');
  } finally { globalThis.fetch = originalFetch; }
});

test('reloads referenced tool images on later model rounds', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  let version = 0;
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const output = requests.length < 3
      ? [{ type: 'function_call', call_id: `preview-${requests.length}`, name: 'preview_page', arguments: '{}' }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Finished' }] }];
    return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const send = createResponsesSender({
      baseURL: 'https://example.com/v1', model: 'model',
      loadImage: async () => new Blob([String(version)], { type: 'image/png' }),
      tools: [{ name: 'preview_page', description: 'Preview', parameters: { type: 'object' }, execute: async () => {
        version++;
        return { type: 'responses_tool_content', content: [{ type: 'input_image', image_url: 'attachment://page', detail: undefined }] };
      } }]
    });
    await send([{ role: 'user', content: 'Inspect' }], new AbortController().signal, () => {});
    expect(JSON.stringify(requests[1].input)).toContain('data:image/png;base64,MQ==');
    const input = requests[2].input;
    if (!Array.isArray(input)) throw new Error('Expected Responses input items.');
    expect(input).toContainEqual({ type: 'function_call_output', call_id: 'preview-2',
      output: [{ type: 'input_image', image_url: 'data:image/png;base64,Mg==' }] });
  } finally { globalThis.fetch = originalFetch; }
});

test('reports malformed multimodal tool results as tool errors', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  const events: { status: string; result?: string }[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const output = requests.length === 1
      ? [{ type: 'function_call', call_id: 'preview-call', name: 'preview_page', arguments: '{}' }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Failed' }] }];
    return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const cases = [
      { content: [], message: 'non-empty array' },
      { content: [{ type: 'input_text', text: 42 }], message: 'text must be a string' },
      { content: [{ type: 'input_file' }], message: 'Unsupported' },
      { content: [{ type: 'input_image', image_url: 'https://example.com/image.png' }], message: 'local PNG' },
      { content: [{ type: 'input_image', image_url: 'data:image/png;base64,YQ==', detail: 'invalid' }], message: 'image detail' }
    ];
    for (const example of cases) {
      requests.length = 0;
      events.length = 0;
      const send = createResponsesSender({
        baseURL: 'https://example.com/v1', model: 'model',
        tools: [{ name: 'preview_page', description: 'Preview', parameters: { type: 'object' }, execute: async () => ({
          type: 'responses_tool_content', content: example.content
        }) }],
        onTool: event => events.push(event)
      });
      await send([{ role: 'user', content: 'Inspect' }], new AbortController().signal, () => {});
      expect(events.at(-1)?.status).toBe('error');
      expect(events.at(-1)?.result).toContain(example.message);
      const input = requests[1].input;
      if (!Array.isArray(input)) throw new Error('Expected Responses input items.');
      const output = input.find(item => item.type === 'function_call_output' && item.call_id === 'preview-call');
      expect(output?.output).toContain('"error"');
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('reports missing or unsupported referenced tool images as tool errors', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const output = requests.length === 1
      ? [{ type: 'function_call', call_id: 'preview-call', name: 'preview_page', arguments: '{}' }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Failed' }] }];
    return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    for (const loadImage of [undefined, async () => null, async () => new Blob(['image'], { type: 'image/gif' })]) {
      requests.length = 0;
      const events: { status: string; result?: string }[] = [];
      const send = createResponsesSender({
        baseURL: 'https://example.com/v1', model: 'model', loadImage,
        tools: [{ name: 'preview_page', description: 'Preview', parameters: { type: 'object' }, execute: async () => ({
          type: 'responses_tool_content', content: [{ type: 'input_image', image_url: 'attachment://missing' }]
        }) }],
        onTool: event => events.push(event)
      });
      await send([{ role: 'user', content: 'Inspect' }], new AbortController().signal, () => {});
      expect(events.at(-1)?.status).toBe('error');
      expect(events.at(-1)?.result).toContain(loadImage ? 'image' : 'missing');
      expect(JSON.stringify(requests[1].input)).toContain('\\"error\\"');
      expect(JSON.stringify(requests[1].input)).not.toContain('attachment://missing');
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('redacts inline image data from multimodal tool events', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  const events: { status: string; result?: string }[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const output = requests.length === 1
      ? [{ type: 'function_call', call_id: 'preview-call', name: 'preview_page', arguments: '{}' }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Finished' }] }];
    return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  try {
    const send = createResponsesSender({
      baseURL: 'https://example.com/v1', model: 'model',
      tools: [{ name: 'preview_page', description: 'Preview', parameters: { type: 'object' }, execute: async () => ({
        type: 'responses_tool_content', content: [{ type: 'input_image', image_url: 'data:image/png;base64,YQ==' }]
      }) }],
      onTool: event => events.push(event)
    });
    await send([{ role: 'user', content: 'Inspect' }], new AbortController().signal, () => {});
    expect(JSON.stringify(requests[1].input)).toContain('data:image/png;base64,YQ==');
    expect(events.at(-1)?.status).toBe('success');
    expect(events.at(-1)?.result).toContain('[image data]');
    expect(events.at(-1)?.result).not.toContain('YQ==');
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