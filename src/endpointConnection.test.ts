import { expect, test } from 'bun:test';
import { createEndpoint } from './modelConfig';
import { testEndpointConnection } from './endpointConnection';

function response(output: unknown[], status = 'completed') {
  return new Response(JSON.stringify({ id: 'response-test', status, output }), { headers: { 'Content-Type': 'application/json' } });
}

test('tests an endpoint with fixed prompts, disabled thinking, and no tools or storage', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return response([{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }]);
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  try {
    const endpoint = createEndpoint('openai');
    endpoint.endpoint = 'https://example.com/v1';
    endpoint.apiKey = 'test-key';
    endpoint.models[0].thinkingAvailable = true;
    expect(await testEndpointConnection(endpoint, endpoint.models[0])).toBe('OK');
    expect(requestBody.instructions).toBe('this is a test');
    expect(requestBody.input).toEqual([{ role: 'user', content: 'Say OK' }]);
    expect(requestBody.store).toBe(false);
    expect(requestBody.stream).toBe(false);
    expect(requestBody.tools).toBeUndefined();
    expect(requestBody.reasoning).toEqual({ effort: 'none' });
  } finally { globalThis.fetch = originalFetch; }
});

test('rejects empty replies, tool calls, and incomplete responses', async () => {
  const originalFetch = globalThis.fetch;
  const endpoint = createEndpoint('openai');
  endpoint.endpoint = 'https://example.com/v1';
  let requestBody: Record<string, unknown> = {};
  const testOutput = async (output: unknown[], status = 'completed') => {
    globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response(output, status);
    }, { preconnect: originalFetch.preconnect }) as typeof fetch;
    return testEndpointConnection(endpoint, endpoint.models[0]);
  };
  try {
    await expect(testOutput([])).rejects.toThrow('文本回复');
    expect(requestBody.reasoning).toBeUndefined();
    await expect(testOutput([{ type: 'function_call', call_id: 'call', name: 'unexpected', arguments: '{}' }])).rejects.toThrow('工具');
    await expect(testOutput([{ type: 'message', content: [{ type: 'refusal', refusal: 'Denied' }] }])).rejects.toThrow('拒绝测试请求');
    await expect(testOutput([], 'incomplete')).rejects.toThrow('未完成');
  } finally { globalThis.fetch = originalFetch; }
});