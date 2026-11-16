import OpenAI from 'openai';
import type { Response, ResponseInputItem } from 'openai/resources/responses/responses';
import type { ChatSender } from './AiChat';
import type { RequestUsage, ToolEvent } from './assistantTypes';
import type { ReasoningEffort } from './modelConfig';
import { openAiAuthOptions, readResponse, reasoningRequestParams } from './responses';
import { runToolLoop } from './toolLoop';
import { estimateResponseInput, normalizeUsage, prepareResponseInput, sanitizeResponseItems } from './conversationUtils';
import { generateId } from './id';
import { createBuiltInTools, type BuiltInToolOptions } from './builtInTools';

export { reasoningRequestParams } from './responses';

export type ResponsesToolContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' | 'original' };

export interface ResponsesToolContent {
  type: 'responses_tool_content';
  content: ResponsesToolContentPart[];
}

export interface ResponsesTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (argumentsObject: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
}

export interface ResponsesRequestSnapshot {
  endpoint: string;
  body: Readonly<Record<string, unknown>>;
}

export interface ResponsesConfig {
  baseURL: string;
  apiKey?: string;
  model: string;
  instructions?: string;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  onReasoning?: (text: string, itemId?: string) => void;
  tools?: ResponsesTool[];
  builtIn?: BuiltInToolOptions;
  onTool?: (tool: ToolEvent) => void;
  maxToolRounds?: number;
  timeoutMs?: number;
  onRequest?: (request: ResponsesRequestSnapshot) => void;
  history?: unknown[];
  onHistory?: (items: unknown[]) => void;
  supportsVision?: boolean;
  loadImage?: (imageId: string) => Promise<Blob | null>;
  onUsage?: (request: RequestUsage) => void;
}

function isLocalImage(value: unknown): value is string {
  return typeof value === 'string' && (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) || /^attachment:\/\/[a-zA-Z0-9_-]+$/.test(value));
}

function formatToolResult(value: unknown): { output: string | ResponsesToolContentPart[]; summary: string } {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'responses_tool_content') {
    const output = JSON.stringify(value) ?? 'null';
    return { output, summary: output };
  }
  if (!('content' in value) || !Array.isArray(value.content) || !value.content.length) throw new Error('Multimodal tool content must be a non-empty array.');
  const content: ResponsesToolContentPart[] = value.content.map((part: unknown) => {
    if (!part || typeof part !== 'object' || !('type' in part)) throw new Error('Invalid multimodal tool content.');
    if (part.type === 'input_text') {
      if (!('text' in part) || typeof part.text !== 'string') throw new Error('Multimodal text must be a string.');
      return { type: 'input_text', text: part.text };
    }
    if (part.type !== 'input_image') throw new Error('Unsupported multimodal tool content type.');
    if (!('image_url' in part) || !isLocalImage(part.image_url)) {
      throw new Error('Image input must be a local PNG, JPEG or WebP data URL or attachment reference.');
    }
    const image: Extract<ResponsesToolContentPart, { type: 'input_image' }> = { type: 'input_image', image_url: part.image_url };
    if ('detail' in part && part.detail !== undefined) {
      if (part.detail !== 'auto' && part.detail !== 'low' && part.detail !== 'high' && part.detail !== 'original') throw new Error('Invalid image detail.');
      image.detail = part.detail;
    }
    return image;
  });
  const summary = JSON.stringify({ type: 'responses_tool_content', content: content.map(part =>
    part.type === 'input_image' && part.image_url.startsWith('data:') ? { ...part, image_url: '[image data]' } : part
  ) });
  return { output: content, summary };
}

export function createResponsesSender(config: ResponsesConfig): ChatSender {
  const url = new URL(config.baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /\/(?:responses|chat\/completions)\/?$/i.test(url.pathname)) {
    throw new Error('API 地址必须是无凭据、查询参数或片段的 HTTP(S) base URL。');
  }
  if (!config.model.trim()) throw new Error('请填写模型名称。');
  const maxRounds = config.maxToolRounds ?? config.builtIn?.config.maxToolRounds ?? 24;
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 0) throw new Error('工具调用轮次上限必须为非负整数。');
  const timeoutMs = config.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('请求超时必须为正整数。');
  const limitMessage = '已达到本轮工具调用上限。请检查已完成的操作后继续。';
  const client = new OpenAI({ baseURL: url.toString().replace(/\/$/, ''), ...openAiAuthOptions(config.apiKey), dangerouslyAllowBrowser: true, maxRetries: 0 });
  return async (messages, signal, onText) => {
    const loadImage = config.loadImage ?? config.builtIn?.loadImage;
    const builtIn = config.builtIn ? createBuiltInTools({ ...config.builtIn, config: { ...config.builtIn.config, systemPrompt: config.instructions ?? config.builtIn.config.systemPrompt } }) : undefined;
    const tools = [...(config.tools || []), ...(builtIn?.tools || [])];
    if (new Set(tools.map(tool => tool.name)).size !== tools.length || tools.some(tool => !tool.name)) throw new Error('工具名称必须非空且唯一。');
    const instructions = builtIn?.instructions ?? config.instructions;
    const newMessages: ResponseInputItem[] = (config.history?.length ? messages.slice(-1) : messages).map(message => {
      if (message.role !== 'user' || !message.images?.length) return { role: message.role, content: message.content };
      if (message.images.some(image => !isLocalImage(image))) throw new Error('Image input must be a local PNG, JPEG or WebP data URL or attachment reference.');
      return { role: 'user', content: [{ type: 'input_text', text: message.content }, ...message.images.map(image => ({ type: 'input_image' as const, image_url: image, detail: 'auto' as const }))] };
    });
    const input: ResponseInputItem[] = [...sanitizeResponseItems((config.history || []) as ResponseInputItem[]), ...newMessages];
    await runToolLoop<ResponseInputItem, Extract<Response['output'][number], { type: 'function_call' }>>({
      input, signal, maxRounds, onText, onHistory: config.onHistory, onLimit: () => onText(limitMessage),
      cancelledMessage: '操作已取消。', limitMessage,
      assistantMessage: content => ({ role: 'assistant', content }),
      request: async history => {
        const createdAt = Date.now();
        const request = { id: generateId(), endpoint: url.toString().replace(/\/$/, ''), model: config.model, createdAt, inputEstimate: estimateResponseInput(history, instructions || '') };
        let reported = false;
        const requestController = new AbortController();
        const abortRequest = () => requestController.abort(signal.reason);
        signal.addEventListener('abort', abortRequest, { once: true });
        if (signal.aborted) abortRequest();
        const timeout = setTimeout(() => requestController.abort(new Error('AI request timed out.')), timeoutMs);
        try {
          const requestBody = {
            model: config.model, instructions, input: await prepareResponseInput(history, config.supportsVision !== false, loadImage), stream: true as const, store: false,
            ...(tools.length ? { tools: tools.map(tool => ({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })) } : {}),
            ...(url.hostname === 'api.openai.com' ? { include: ['reasoning.encrypted_content' as const] } : {}),
            ...reasoningRequestParams(config.model, config.reasoningEffort),
            ...(config.maxOutputTokens ? { max_output_tokens: config.maxOutputTokens } : {})
          };
          config.onRequest?.({ endpoint: `${url.toString().replace(/\/$/, '')}/responses`, body: requestBody });
          const stream = await client.responses.create(requestBody, { signal: requestController.signal });
          let streamedText = '';
          const response = await readResponse(stream, chunk => { streamedText += chunk; onText(chunk); }, requestController.signal, config.onReasoning);
          const completedAt = Date.now();
          config.onUsage?.({ ...request, completedAt, durationMs: Math.max(1, completedAt - createdAt), responseId: response.id,
            status: response.status === 'incomplete' ? 'incomplete' : response.status === 'failed' ? 'failed' : 'completed', usage: normalizeUsage(response.usage) });
          reported = true;
          if (response.status === 'incomplete') throw new Error(`回复未完成：${response.incomplete_details?.reason || '未知原因'}`);
          if (response.status === 'failed' || response.error) throw new Error(response.error?.message || '模型请求失败。');
          const content = response.output.flatMap(item => item.type === 'message' ? item.content : [])
            .map(part => part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : '').join('') || streamedText;
          const calls = response.output.filter(item => item.type === 'function_call');
          const output = response.output.filter(item => item.type === 'message' || item.type === 'reasoning' || item.type === 'function_call');
          return { content, streamedText, calls, output, unsupportedOutput: output.length !== response.output.length };
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener('abort', abortRequest);
          if (!reported) { const completedAt = Date.now(); config.onUsage?.({ ...request, completedAt, durationMs: Math.max(1, completedAt - createdAt), status: signal.aborted ? 'aborted' : 'failed' }); }
        }
      },
      execute: async call => {
        const startedAt = Date.now();
        const started = performance.now();
        config.onTool?.({ id: call.call_id, name: call.name, arguments: call.arguments, status: 'running', startedAt });
        let status: 'success' | 'error' = 'success';
        let result: string;
        let output: string | ResponsesToolContentPart[];
        try {
          signal.throwIfAborted();
          const tool = tools.find(item => item.name === call.name);
          if (!tool) throw new Error('Unknown tool.');
          const args: unknown = JSON.parse(call.arguments);
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
          const formatted = formatToolResult(await tool.execute(args as Record<string, unknown>, signal));
          if (Array.isArray(formatted.output) && config.supportsVision !== false) {
            await prepareResponseInput([{ type: 'function_call_output', output: formatted.output }], true, loadImage);
          }
          result = formatted.summary;
          output = formatted.output;
        } catch (error) {
          signal.throwIfAborted();
          status = 'error';
          result = JSON.stringify({ error: error instanceof Error ? error.message : 'Tool failed.' });
          output = result;
        }
        config.onTool?.({ id: call.call_id, name: call.name, arguments: call.arguments, status, startedAt, durationMs: Math.max(0, performance.now() - started), result });
        return { output: { type: 'function_call_output', call_id: call.call_id, output }, cancelled: false };
      }
    });
  };
}