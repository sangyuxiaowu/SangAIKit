// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { AiSettings, DEFAULT_SETTINGS, createEndpoint, createImageModel, createModel, normalizeConfig, resolveSelection, type AiConfig, type AssistantController } from '../src';
import { forkDemoConversation, loadDemoImage, useDemoAssistant } from './useDemoAssistant';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it('keeps settings thinking switches and the current model state in sync', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const endpoint = createEndpoint('openai');
  endpoint.models[0].thinkingAvailable = false;
  const config: AiConfig = { endpoints: [endpoint], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: '' };
  const onSave = vi.fn(async (_config: AiConfig) => {});
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AiSettings config={config} onSave={onSave} onBack={vi.fn()} english={false}
      store={{ loadConfig: async () => config }} onKeyChanged={async () => {}} createEndpoint={createEndpoint}
      createModel={createModel} normalizeConfig={normalizeConfig} resolveSelection={resolveSelection} defaults={DEFAULT_SETTINGS} />));
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="思考推理"]')!.click(); });
    const defaultSwitch = () => host.querySelector<HTMLButtonElement>('button[aria-label="默认开启"]')!;
    expect(defaultSwitch().getAttribute('aria-checked')).toBe('true');
    await act(async () => { defaultSwitch().click(); });
    expect(defaultSwitch().getAttribute('aria-checked')).toBe('false');
    await act(async () => { defaultSwitch().click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].endpoints[0].models[0]).toMatchObject({
      thinkingAvailable: true, thinkingEnabled: true, defaultThinkingEnabled: true, reasoningEffort: 'medium'
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    if (scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  }
});

it('calls a configured image provider and saves the result in the conversation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Blob', NodeBlob);
  let responseCalls = 0;
  let imageCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (target: string | URL | Request) => {
    const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
    if (url.includes('/images/generations')) {
      imageCalls++;
      return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAAA' }] }), { headers: { 'Content-Type': 'application/json' } });
    }
    responseCalls++;
    const output = responseCalls === 1
      ? [{ type: 'function_call', call_id: 'image-call', name: 'generate_image', arguments: JSON.stringify({ modelConfigId: imageModel.id, prompt: 'A geometric poster' }) }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Image ready' }] }];
    return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output, usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 1 } } } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  const endpoint = createEndpoint('openai');
  endpoint.endpoint = 'https://example.com/v1';
  endpoint.apiKey = 'test';
  const imageModel = { ...createImageModel('gpt-image-2'), enabled: true, endpointId: endpoint.id };
  const config: AiConfig = { endpoints: [endpoint], imageModels: [imageModel], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: 'Use tools when needed.' };
  const root = createRoot(document.createElement('div'));
  let assistant: ReturnType<typeof useDemoAssistant>;
  function Harness() { assistant = useDemoAssistant(config); return null; }
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await assistant!.send('Create an image'); });
    expect(responseCalls).toBe(2);
    expect(imageCalls).toBe(1);
    expect(assistant!.entries[1].content).toBe('Image ready');
    expect(assistant!.entries[1].usage).toEqual({ inputTokens: 20, outputTokens: 8, totalTokens: 28, cachedTokens: 4, reasoningTokens: 2 });
    expect(assistant!.sessions[0].requests).toHaveLength(2);
    const image = assistant!.entries[1].images?.[0];
    expect(image?.type).toBe('image/png');
    expect(assistant!.entries[1].tools?.[0].image?.id).toBe(image?.id);
    expect((await loadDemoImage(assistant!.activeSessionId!, image!.id))?.size).toBe(12);
  } finally { await act(async () => root.unmount()); }
});

it('orders reasoning and tool activity by response items across a turn', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let requestCount = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    requestCount++;
    const output = requestCount === 1
      ? [{ type: 'reasoning', id: 'reasoning-1', summary: [] },
        { type: 'function_call', call_id: 'call-1', name: 'read_workspace', arguments: '{}' },
        { type: 'reasoning', id: 'reasoning-2', summary: [] }]
      : [{ type: 'reasoning', id: 'reasoning-3', summary: [{ type: 'summary_text', text: '完成思考' }] },
        { type: 'message', id: 'message-1', role: 'assistant', content: [{ type: 'output_text', text: '完成' }] }];
    const deltas = requestCount === 1
      ? [{ type: 'response.reasoning_summary_text.delta', item_id: 'reasoning-1', delta: '调用前' },
        { type: 'response.reasoning_summary_text.delta', item_id: 'reasoning-2', delta: '调用后' }]
      : [];
    const events = [...deltas, { type: 'response.completed', response: { status: 'completed', output } }];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  const endpoint = createEndpoint('openai');
  endpoint.endpoint = 'https://example.com/v1';
  endpoint.apiKey = 'test';
  const config: AiConfig = { endpoints: [endpoint], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: '' };
  let assistant: ReturnType<typeof useDemoAssistant>;
  function Harness() { assistant = useDemoAssistant(config); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await assistant!.send('继续'); });
    expect(assistant!.entries[1].activity).toEqual([
      { id: 'reasoning-1', type: 'reasoning', text: '调用前' },
      { id: 'call-1', type: 'tool', toolId: 'call-1' },
      { id: 'reasoning-2', type: 'reasoning', text: '调用后' },
      { id: 'reasoning-3', type: 'reasoning', text: '完成思考' },
      { id: 'message-1', type: 'text', text: '完成' }
    ]);
    expect(assistant!.sessions[0].responseItems).toHaveLength(7);
    await act(async () => root.unmount());
    const reopened = createRoot(document.createElement('div'));
    try {
      await act(async () => { reopened.render(<Harness />); });
      expect(assistant!.entries[1].activity?.map(item => item.type)).toEqual(['reasoning', 'tool', 'reasoning', 'reasoning', 'text']);
    } finally { await act(async () => reopened.unmount()); }
  } finally { await act(async () => root.unmount()); }
});

it('preserves response history across turns and allows redo after reopening', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_target: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Answer ${requests.length}` }] }];
    return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  const endpoint = createEndpoint('openai');
  endpoint.endpoint = 'https://example.com/v1';
  endpoint.apiKey = 'test';
  const config: AiConfig = { endpoints: [endpoint], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: '' };
  let assistant: ReturnType<typeof useDemoAssistant>;
  function Harness() { assistant = useDemoAssistant(config); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await assistant!.send('First'); });
    expect(requests[0].reasoning).toEqual({ effort: 'none' });
    endpoint.models[0].thinkingEnabled = true;
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await assistant!.send('Second'); });
    expect(requests[1].reasoning).toEqual({ effort: 'medium' });
    const second = requests[1].input as Array<{ role?: string; content?: unknown }>;
    expect(second.map(item => item.role)).toEqual(['user', 'assistant', 'user']);
    expect(second[2].content).toBe('Second');
    expect(assistant!.canRegenerate).toBe(true);
    endpoint.models[0].reasoningEffort = 'high';
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await assistant!.regenerate(); });
    expect(requests[2].reasoning).toEqual({ effort: 'high' });
    const retried = requests[2].input as Array<{ role?: string; content?: unknown }>;
    expect(retried.map(item => item.role)).toEqual(['user', 'assistant', 'user']);
    expect(retried[2].content).toBe('Second');
    expect(assistant!.entries.map(entry => entry.content)).toEqual(['First', 'Answer 1', 'Second', 'Answer 3']);
    await act(async () => root.unmount());
    const reopened = createRoot(document.createElement('div'));
    try {
      await act(async () => { reopened.render(<Harness />); });
      expect(assistant!.entries).toHaveLength(4);
      expect(assistant!.canRegenerate).toBe(true);
      await act(async () => { await assistant!.regenerate(); });
      const restored = requests[3].input as Array<{ role?: string; content?: unknown }>;
      expect(restored.map(item => item.role)).toEqual(['user', 'assistant', 'user']);
      expect(restored[2].content).toBe('Second');
    } finally { await act(async () => reopened.unmount()); }
  } finally { await act(async () => root.unmount()); }
});

it('keeps demo turns when switching to a real model', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let input: Array<{ role?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (_target: unknown, init: RequestInit) => {
    input = (JSON.parse(String(init.body)) as { input: Array<{ role?: string }> }).input;
    return new Response('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  const demo = createEndpoint('custom');
  demo.id = 'local-demo';
  const remote = createEndpoint('openai');
  remote.endpoint = 'https://example.com/v1';
  remote.apiKey = 'test';
  const config: AiConfig = { endpoints: [demo, remote], activeSelection: { endpointId: demo.id, modelId: demo.models[0].id }, systemPrompt: '' };
  let assistant: ReturnType<typeof useDemoAssistant>;
  function Harness({ value }: { value: AiConfig }) { assistant = useDemoAssistant(value); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => { root.render(<Harness value={config} />); });
    await act(async () => { await assistant!.send('Demo turn'); });
    await act(async () => { root.render(<Harness value={{ ...config, activeSelection: { endpointId: remote.id, modelId: remote.models[0].id } }} />); });
    await act(async () => { await assistant!.send('Real turn'); });
    expect(input.map(item => item.role)).toEqual(['user', 'assistant', 'user']);
  } finally { await act(async () => root.unmount()); }
});

it('lets the host fork a conversation from a selected assistant response', async () => {
  const sessionId = 'source-session';
  const session = {
    id: sessionId,
    title: 'Source',
    updatedAt: 1,
    entries: [
      { id: 'user-1', role: 'user' as const, content: 'First' },
      { id: 'assistant-1', role: 'assistant' as const, content: 'Answer one', responseItemCount: 2 },
      { id: 'user-2', role: 'user' as const, content: 'Second' },
      { id: 'assistant-2', role: 'assistant' as const, content: 'Answer two', responseItemCount: 4 }
    ],
    requests: [
      { id: 'request-1', entryId: 'assistant-1', endpoint: 'https://example.com/v1', model: 'test', createdAt: 1, status: 'completed' as const },
      { id: 'request-2', entryId: 'assistant-2', endpoint: 'https://example.com/v1', model: 'test', createdAt: 2, status: 'completed' as const }
    ],
    responseItems: [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Answer one' },
      { role: 'user', content: 'Second' },
      { role: 'assistant', content: 'Answer two' }
    ]
  };
  localStorage.setItem('sang-ai-kit-demo-snapshot-v2', JSON.stringify({ sessions: [session], activeSessionId: sessionId }));
  let saved: { sessions: typeof session[]; activeSessionId: string } | undefined;
  const assistant = {
    sessions: [session], activeSessionId: sessionId, busy: false, saving: false,
    reloadConfig: async () => {}
  } as unknown as AssistantController;
  await forkDemoConversation(assistant, { sessionId, entryId: 'assistant-1', responseItemCount: 2 }, async () => { saved = JSON.parse(localStorage.getItem('sang-ai-kit-demo-snapshot-v2') || 'null'); });
  expect(saved?.sessions).toHaveLength(2);
  const branch = saved!.sessions.find(item => item.id === saved!.activeSessionId)!;
  expect(branch.title).toBe('Source (分叉)');
  expect(branch.entries.map(entry => entry.id)).toEqual(['user-1', 'assistant-1']);
  expect(branch.responseItems).toEqual(session.responseItems.slice(0, 2));
  expect(branch.requests.map(request => request.id)).toEqual(['request-1']);
});

it('allows regeneration of the default local demo reply with its simulated tool', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const endpoint = createEndpoint('custom');
  endpoint.id = 'local-demo';
  const config: AiConfig = { endpoints: [endpoint], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: '' };
  const root = createRoot(document.createElement('div'));
  let assistant: ReturnType<typeof useDemoAssistant>;
  function Harness() { assistant = useDemoAssistant(config); return null; }
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { const task = assistant!.send('Test'); await vi.runAllTimersAsync(); await task; });
    expect(assistant!.entries[1].tools?.[0].name).toBe('demo_context');
    expect(assistant!.canRegenerate).toBe(true);
    const firstReply = assistant!.entries[1].id;
    await act(async () => { const task = assistant!.regenerate(); await vi.runAllTimersAsync(); await task; });
    expect(assistant!.entries[1].id).not.toBe(firstReply);
    expect(assistant!.entries[1].content).toContain('Test');
    expect(assistant!.entries[1].tools?.[0].name).toBe('demo_context');
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});