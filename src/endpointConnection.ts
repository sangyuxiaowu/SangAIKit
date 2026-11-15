import OpenAI from 'openai';
import type { AiEndpointConfig, AiModelConfig } from './settingsTypes';

export async function testEndpointConnection(endpoint: AiEndpointConfig, model: AiModelConfig): Promise<string> {
  if (!model.modelId.trim()) throw new Error('模型 ID 不能为空。');
  const url = new URL(endpoint.endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /\/(?:responses|chat\/completions)\/?$/i.test(url.pathname)) {
    throw new Error('请填写无凭据、查询参数或请求路径的 HTTP(S) Base URL。');
  }
  const client = new OpenAI({
    baseURL: url.toString().replace(/\/$/, ''),
    apiKey: endpoint.apiKey || 'local',
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: 30_000
  });
  const response = await client.responses.create({
    model: model.modelId,
    instructions: 'this is a test',
    input: [{ role: 'user', content: 'Say OK' }],
    max_output_tokens: 16,
    ...(model.thinkingAvailable ? { reasoning: { effort: 'none' } } : {}),
    store: false,
    stream: false
  });
  if (response.status === 'incomplete') throw new Error(`测试回复未完成：${response.incomplete_details?.reason || '未知原因'}`);
  if (response.status === 'failed' || response.error) throw new Error(response.error?.message || '模型请求失败。');
  if (response.output.some(item => item.type === 'function_call')) throw new Error('模型尝试调用工具，连接测试已拒绝该响应。');
  const content = response.output.flatMap(item => item.type === 'message' ? item.content : []);
  const refusal = content.find(part => part.type === 'refusal');
  if (refusal?.type === 'refusal') throw new Error(`模型拒绝测试请求：${refusal.refusal}`);
  const reply = content.map(part => part.type === 'output_text' ? part.text : '').join('').trim();
  if (!reply) throw new Error('服务未返回文本回复。');
  return reply;
}