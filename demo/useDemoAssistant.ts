import { createIndexedDbImageStore, createResponsesSender, getEntryModelContent, getSessionSystemPrompt, getSelectedReasoningEffort, resolvePlaceholders, resolveSelection, useAssistant, type AiConfig, type AiFeatures, type AssistantSnapshot, type AssistantStorage, type ChatMessage, type PlaceholderConfig, type RegisteredTool, type ResponsesRequestSnapshot, type ResponsesTool } from '../src';
import type { AssistantController, AssistantForkEvent, ToolEvent } from '../src/assistantTypes';
import type { SessionImage } from '../src/sessionTypes';

const storageKey = 'sang-ai-kit-demo-snapshot-v2';
export const DEMO_FEATURES: Readonly<AiFeatures> = { imageGeneration: true, skills: true, quickSnippets: true, fontManagement: true, onlineFonts: true, backgroundRemoval: true, placeholders: true, sessionToolPicker: true };
const images = createIndexedDbImageStore('sang-ai-kit-demo-images-v1');
export const loadDemoImage = (sessionId: string, imageId: string) => images.loadImage(sessionId, imageId);
const storage: AssistantStorage = {
  async load() {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) as AssistantSnapshot : null;
  },
  async save(snapshot) { localStorage.setItem(storageKey, JSON.stringify(snapshot)); },
  images
};

export interface DemoSimulationOptions {
  simulateReasoning: boolean;
  simulateMultiTools: boolean;
  simulateImageGeneration: boolean;
  simulateTokenUsage: boolean;
  simulateContinuable: boolean;
}

export const DEFAULT_SIMULATION_OPTIONS: Readonly<DemoSimulationOptions> = {
  simulateReasoning: false,
  simulateMultiTools: false,
  simulateImageGeneration: false,
  simulateTokenUsage: false,
  simulateContinuable: false
};

export interface DemoAssistantOptions {
  hostTools?: readonly RegisteredTool[];
  placeholders?: PlaceholderConfig;
}

const DEFAULT_DEMO_HOST_TOOLS: readonly ResponsesTool[] = [
  {
    name: 'read_workspace',
    description: 'Read the current demo workspace metadata.',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ name: '演示工作区' })
  }
];

// 生成真实可用的 PNG 二进制用于演示图片画廊与预览
function createDemoPngBlob(variant: 'generated' | 'preview' | 'attachment' = 'generated'): Blob {
  // 1x1 彩色透明安全 PNG Base64 载荷（兼容所有浏览器与测试环境）
  const base64ByVariant: Record<typeof variant, string> = {
    generated:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    preview:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    attachment:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  };
  const binary = atob(base64ByVariant[variant]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'image/png' });
}

export function useDemoAssistant(
  config: AiConfig,
  features: Partial<AiFeatures> = DEMO_FEATURES,
  onRequest?: (request: ResponsesRequestSnapshot) => void,
  simulation?: Partial<DemoSimulationOptions>,
  options?: DemoAssistantOptions
): AssistantController {
  return useAssistant(async (entries, events) => {
    const { endpoint, model } = resolveSelection(config);
    const activeSystemPrompt = events.session.systemPrompt !== undefined
      ? (getSessionSystemPrompt(events.session) ?? '')
      : (await resolvePlaceholders(config.systemPrompt, options?.placeholders, events.session.id, features, 'system')).sentContent;
    const sessionEnabledTools = events.session.enabledTools;
    const hostTools = options?.hostTools?.length ? [...options.hostTools] : [...DEFAULT_DEMO_HOST_TOOLS];
    const lastEntry = entries[entries.length - 1];
    const resolvedPrompt = lastEntry ? getEntryModelContent(lastEntry) : '';

    if (endpoint.id === 'local-demo') {
      const hasCustomSim =
        simulation &&
        (simulation.simulateReasoning ||
          simulation.simulateMultiTools ||
          simulation.simulateImageGeneration ||
          simulation.simulateTokenUsage ||
          simulation.simulateContinuable);

      if (!hasCustomSim) {
        const tool: ToolEvent = { id: crypto.randomUUID(), name: 'demo_context', arguments: '{}', status: 'running', startedAt: Date.now() };
        events.onTool(tool);
        await new Promise(resolve => setTimeout(resolve, 350));
        events.signal.throwIfAborted();
        events.onTool({ ...tool, status: 'success', durationMs: 350, result: '{"status":"ready"}' });
        const text = `这是本地演示回复，未调用远程模型。\n\n你刚才输入的是：${resolvedPrompt}`;
        for (let index = 0; index < text.length; index += 8) {
          events.signal.throwIfAborted();
          await new Promise(resolve => setTimeout(resolve, 40));
          events.onText(text.slice(index, index + 8));
        }
        events.onHistory([...events.history, { role: 'user', content: resolvedPrompt }, { role: 'assistant', content: text }]);
        return;
      }

      const lastPrompt = resolvedPrompt;
      const enabledToolSet = sessionEnabledTools ? new Set(sessionEnabledTools) : null;
      const isToolAllowed = (name: string) => !enabledToolSet || enabledToolSet.has(name);

      if (simulation.simulateReasoning) {
        const reasoningId = `reasoning-${crypto.randomUUID()}`;
        const steps = [
          '正在解析工作区上下文与会话配置状态...\n',
          `识别实际发送给模型的内容：「${lastPrompt.slice(0, 48)}」\n`,
          sessionEnabledTools
            ? `本会话已限定工具集：${sessionEnabledTools.length ? sessionEnabledTools.join(', ') : '（未启用任何工具）'}\n`
            : '检查已启用工具链与上下文约束，准备生成结构化响应。'
        ];
        for (const chunk of steps) {
          events.signal.throwIfAborted();
          await new Promise(resolve => setTimeout(resolve, 140));
          events.onReasoning(chunk, reasoningId);
        }
      }

      if (simulation.simulateMultiTools) {
        const candidateChain: Array<{ name: string; args: string; result: string; duration: number }> = [
          ...(isToolAllowed('query_novel_outline') && hostTools.some(t => t.name === 'query_novel_outline')
            ? [
                {
                  name: 'query_novel_outline',
                  args: '{"volume":"第一卷"}',
                  result: '{"volume":"第一卷·寒雾初起","chapters":12,"hook":"古镜觉醒与城门异变"}',
                  duration: 210
                }
              ]
            : []),
          ...(isToolAllowed('read_workspace')
            ? [
                {
                  name: 'read_workspace',
                  args: '{"includeLayers":true}',
                  result: '{"workspace":"演示工作区","canvas":"1920x1080","activeLayers":4}',
                  duration: 240
                }
              ]
            : []),
          ...(features.fontManagement && isToolAllowed('list_fonts')
            ? [
                {
                  name: 'list_fonts',
                  args: '{"category":"all"}',
                  result: '{"onlineFonts":["Plus Jakarta Sans","Noto Sans SC"],"localFontsCount":' + (config.localFonts?.length ?? 0) + '}',
                  duration: 210
                }
              ]
            : []),
          ...(enabledToolSet === null
            ? [
                {
                  name: 'demo_context',
                  args: '{"mode":"multi_step"}',
                  result: '{"status":"ready","verified":true}',
                  duration: 220
                }
              ]
            : [])
        ];

        for (const item of candidateChain) {
          const tool: ToolEvent = {
            id: crypto.randomUUID(),
            name: item.name,
            arguments: item.args,
            status: 'running',
            startedAt: Date.now()
          };
          events.onTool(tool);
          await new Promise(resolve => setTimeout(resolve, item.duration));
          events.signal.throwIfAborted();
          events.onTool({
            ...tool,
            status: 'success',
            durationMs: item.duration,
            result: item.result
          });
        }
      } else {
        const tool: ToolEvent = { id: crypto.randomUUID(), name: 'demo_context', arguments: '{}', status: 'running', startedAt: Date.now() };
        events.onTool(tool);
        await new Promise(resolve => setTimeout(resolve, 280));
        events.signal.throwIfAborted();
        events.onTool({ ...tool, status: 'success', durationMs: 280, result: '{"status":"ready"}' });
      }

      if (simulation.simulateImageGeneration && isToolAllowed('generate_image')) {
        const imgToolId = crypto.randomUUID();
        const imgPrompt = lastPrompt.trim() || '现代几何视觉海报设计，深邃钴蓝与流光渐变';
        const runningImgTool: ToolEvent = {
          id: imgToolId,
          name: 'generate_image',
          arguments: JSON.stringify({ prompt: imgPrompt, size: '1024x1024', quality: 'high' }),
          status: 'running',
          startedAt: Date.now()
        };
        events.onTool(runningImgTool);
        await new Promise(resolve => setTimeout(resolve, 360));
        events.signal.throwIfAborted();
        const blob = createDemoPngBlob('generated');
        const savedImage = await events.saveImage(blob, `ai-poster-${Date.now().toString().slice(-4)}.png`);
        events.onTool({
          ...runningImgTool,
          status: 'success',
          durationMs: 360,
          result: JSON.stringify({ status: 'completed', imageId: savedImage.id, name: savedImage.name }),
          image: savedImage
        });
      }

      const placeholderCount = lastEntry?.placeholders?.length ?? 0;
      const summaryLines = [
        `这是增强版**本地模拟回复**（未调用外部付费 API）。`,
        ``,
        `- **实际发送给模型的内容**：\n\n> ${lastPrompt.replace(/\n/g, '\n> ')}`,
        ...(placeholderCount > 0
          ? [`- **已解析占位符快照**：共 ${placeholderCount} 个（点击上方消息中的 \`{{占位符}}\` 标签可随时查看发送时的赋值快照）`]
          : []),
        ...(events.session.systemPrompt
          ? [
              `- **本会话实际发送系统提示词**：${activeSystemPrompt.slice(0, 120)}${activeSystemPrompt.length > 120 ? '…' : ''}`,
              ...(events.session.systemPromptPlaceholders?.length
                ? [`- **系统提示词占位符快照**：共 ${events.session.systemPromptPlaceholders.length} 个（点击顶部系统提示词卡片中的 \`{{占位符}}\` 可查看当时快照）`]
                : [])
            ]
          : []),
        ...(sessionEnabledTools !== undefined
          ? [`- **本会话可用工具**：${sessionEnabledTools.length ? sessionEnabledTools.map(name => `\`${name}\``).join(' · ') : '（当前未启用工具）'}`]
          : []),
        `- **已触发模拟能力**：${[
          simulation.simulateReasoning ? '思考推理流 (Reasoning)' : null,
          simulation.simulateMultiTools ? '多步工具链 (Multi-Tools)' : null,
          simulation.simulateImageGeneration ? '本地生图与画廊入库 (Image Generation)' : null,
          simulation.simulateTokenUsage ? 'Token 用量统计 (Usage)' : null,
          simulation.simulateContinuable ? '轮次上限暂停态 (Continuable)' : null
        ]
          .filter(Boolean)
          .join(' · ')}`,
        ``,
        simulation.simulateImageGeneration
          ? `生成的演示图像已保存至 IndexedDB，可点击上方工具卡片中的文件名预览，或点击右上角 **「历史对话 -> 图片画廊」** 体验分类筛选与一键置入工作区。`
          : `你可以在助手右上角工具按钮或左侧「组件能力与交互实验室」中随时调整本会话工具、修改占位符设定或测试工具栏插槽。`
      ].join('\n');

      for (let index = 0; index < summaryLines.length; index += 10) {
        events.signal.throwIfAborted();
        await new Promise(resolve => setTimeout(resolve, 25));
        events.onText(summaryLines.slice(index, index + 10));
      }

      if (simulation.simulateTokenUsage) {
        const startedAt = Date.now() - 820;
        events.onUsage({
          id: `req-${crypto.randomUUID()}`,
          endpoint: endpoint.endpoint,
          model: model.modelId,
          createdAt: startedAt,
          completedAt: Date.now(),
          durationMs: 820,
          status: 'completed',
          usage: {
            inputTokens: 380 + lastPrompt.length * 2,
            outputTokens: 164,
            totalTokens: 544 + lastPrompt.length * 2,
            cachedTokens: 128,
            reasoningTokens: simulation.simulateReasoning ? 72 : 0
          }
        });
      }

      events.onHistory([
        ...events.history,
        { role: 'user', content: lastPrompt },
        { role: 'assistant', content: summaryLines }
      ]);
    } else {
      const messages: ChatMessage[] = await Promise.all(entries.filter(entry => entry.content.trim() || entry.sentContent?.trim() || entry.images?.length).map(async entry => {
        const refs = entry.images || [];
        const suffix = refs.length ? `\n[图片附件：${refs.map(image => `${image.name} (${image.id})`).join(', ')}]` : '';
        const content = `${entry.content}${suffix}`;
        const modelContent = entry.sentContent !== undefined ? `${entry.sentContent}${suffix}` : undefined;
        const inputImages = entry.role === 'user' ? refs.map(image => `attachment://${image.id}`) : [];
        return {
          role: entry.role,
          content,
          ...(modelContent !== undefined ? { sentContent: modelContent } : {}),
          ...(inputImages.length ? { images: inputImages } : {})
        };
      }));
      let generatedImage: SessionImage | undefined;
      await createResponsesSender({ baseURL: endpoint.endpoint, apiKey: endpoint.apiKey, model: model.modelId,
        instructions: activeSystemPrompt, builtIn: { config, features, loadImage: events.loadImage, saveImage: events.saveImage, onImage: image => { generatedImage ??= image; } },
        onRequest,
        maxOutputTokens: model.maxTokens, onReasoning: events.onReasoning, onUsage: events.onUsage,
        history: events.history, onHistory: events.onHistory,
        supportsVision: model.supportsVision, loadImage: events.loadImage,
        onTool: tool => { if (tool.name === 'generate_image' && tool.status === 'running') generatedImage = undefined; events.onTool(tool.name === 'generate_image' && tool.status === 'success' && generatedImage ? { ...tool, image: generatedImage } : tool); },
        tools: hostTools,
        enabledTools: sessionEnabledTools,
        maxToolRounds: config.maxToolRounds,
        ...(model.thinkingAvailable ? { reasoningEffort: model.thinkingEnabled ? getSelectedReasoningEffort(model) : 'none' } : {})
      })(messages, events.signal, events.onText);
    }
  }, storage, { placeholders: options?.placeholders, features });
}

// 一键注入包含思考过程、多工具链、三类画廊图片（AI 生图 / 过程预览 / 参考附件）、Token 用量及可继续状态的全功能演示会话
export async function seedDemoShowcaseSession(
  reloadConversation: () => Promise<void>,
  options?: { markLastContinuable?: boolean }
): Promise<string> {
  const sessionId = `showcase-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();

  const attachmentBlob = createDemoPngBlob('attachment');
  const generatedBlob = createDemoPngBlob('generated');
  const previewBlob = createDemoPngBlob('preview');

  const attachmentImg: SessionImage = {
    id: `img-ref-${crypto.randomUUID().slice(0, 6)}`,
    name: 'brand-reference-board.png',
    type: 'image/png',
    size: attachmentBlob.size
  };
  const generatedImg: SessionImage = {
    id: `img-gen-${crypto.randomUUID().slice(0, 6)}`,
    name: 'key-visual-poster-v1.png',
    type: 'image/png',
    size: generatedBlob.size
  };
  const previewImg: SessionImage = {
    id: `img-prev-${crypto.randomUUID().slice(0, 6)}`,
    name: 'layout-wireframe-preview.png',
    type: 'image/png',
    size: previewBlob.size
  };

  await images.saveImage(sessionId, attachmentImg.id, attachmentBlob);
  await images.saveImage(sessionId, generatedImg.id, generatedBlob);
  await images.saveImage(sessionId, previewImg.id, previewBlob);

  const toolReadId = `tool-read-${crypto.randomUUID().slice(0, 6)}`;
  const toolFontId = `tool-font-${crypto.randomUUID().slice(0, 6)}`;
  const toolPreviewId = `tool-prev-${crypto.randomUUID().slice(0, 6)}`;
  const toolGenId = `tool-gen-${crypto.randomUUID().slice(0, 6)}`;

  const showcaseSession: AssistantSnapshot['sessions'][number] = {
    id: sessionId,
    title: '全能力演示：视觉海报与多工具协同',
    updatedAt: now,
    entries: [
      {
        id: 'entry-user-1',
        role: 'user',
        content: '请结合我上传的品牌参考图，读取当前工作区画布信息并规划春季发布会主视觉海报方案。',
        images: [attachmentImg]
      },
      {
        id: 'entry-assistant-1',
        role: 'assistant',
        responseItemCount: 2,
        durationMs: 1420,
        usage: {
          inputTokens: 640,
          outputTokens: 215,
          totalTokens: 855,
          cachedTokens: 192,
          reasoningTokens: 84
        },
        tools: [
          {
            id: toolReadId,
            name: 'read_workspace',
            arguments: '{"includeLayers":true}',
            status: 'success',
            durationMs: 180,
            result: '{"canvas":"1920x1080","theme":"Obsidian Indigo","selectedLayers":3}'
          },
          {
            id: toolPreviewId,
            name: 'render_canvas_preview',
            arguments: '{"stage":"wireframe","Prompt":"栅格排版与留白结构预览"}',
            status: 'success',
            durationMs: 260,
            result: '{"status":"preview_saved"}',
            image: previewImg
          }
        ],
        activity: [
          {
            id: 'reason-1',
            type: 'reasoning',
            text: '分析用户上传的 brand-reference-board.png，先调用 read_workspace 获取画布尺寸，再生成版式线框预览图（preview 类别）。'
          },
          { id: toolReadId, type: 'tool', toolId: toolReadId },
          { id: toolPreviewId, type: 'tool', toolId: toolPreviewId },
          {
            id: 'text-1',
            type: 'text',
            text: '### 主视觉版式规划已完成\n\n1. **色彩基调**：采用曜石深蓝底色搭配皇家钴蓝高光，呼应品牌参考图。\n2. **网格系统**：12 列黄金比例栅格，顶部预留 18% 呼吸留白。\n3. **过程预览**：已生成线框结构预览图（可在图片画廊「过程预览」分类中查看）。'
          }
        ],
        content:
          '### 主视觉版式规划已完成\n\n1. **色彩基调**：采用曜石深蓝底色搭配皇家钴蓝高光，呼应品牌参考图。\n2. **网格系统**：12 列黄金比例栅格，顶部预留 18% 呼吸留白。\n3. **过程预览**：已生成线框结构预览图（可在图片画廊「过程预览」分类中查看）。'
      },
      {
        id: 'entry-user-2',
        role: 'user',
        content: '很好，请查询可用字体并直接生成最终高清主视觉海报。'
      },
      {
        id: 'entry-assistant-2',
        role: 'assistant',
        responseItemCount: 4,
        continuable: Boolean(options?.markLastContinuable),
        durationMs: 1860,
        usage: {
          inputTokens: 920,
          outputTokens: 280,
          totalTokens: 1200,
          cachedTokens: 512,
          reasoningTokens: 96
        },
        tools: [
          {
            id: toolFontId,
            name: 'list_fonts',
            arguments: '{"filter":"all"}',
            status: 'success',
            durationMs: 150,
            result: '{"recommended":["Plus Jakarta Sans","Noto Serif SC","JetBrains Mono"]}'
          },
          {
            id: toolGenId,
            name: 'generate_image',
            arguments: JSON.stringify({
              prompt: '未来感春季科技发布会主视觉海报，曜石石墨黑与皇家钴蓝光效，极简几何构图',
              size: '1024x1024',
              quality: 'high'
            }),
            status: 'success',
            durationMs: 680,
            result: JSON.stringify({ status: 'completed', imageId: generatedImg.id }),
            image: generatedImg
          }
        ],
        activity: [
          {
            id: 'reason-2',
            type: 'reasoning',
            text: '先调用 list_fonts 确认标题与正文字体搭配，随后调用 generate_image 生成高清主视觉海报并存入会话图片库。'
          },
          { id: toolFontId, type: 'tool', toolId: toolFontId },
          { id: toolGenId, type: 'tool', toolId: toolGenId },
          {
            id: 'text-2',
            type: 'text',
            text: '已为您生成春季发布会主视觉海报 `key-visual-poster-v1.png`。\n\n- **排版建议**：主标题使用 `Plus Jakarta Sans Bold`，中文副标题使用 `Noto Serif SC`。\n- **画廊体验**：点击右上角 **历史对话 → 图片画廊**，即可同时体验 **AI 生图**、**过程预览** 与 **参考附件** 三种图片的筛选、对比与 **「置入工作区」** 能力。'
          }
        ],
        content:
          '已为您生成春季发布会主视觉海报 `key-visual-poster-v1.png`。\n\n- **排版建议**：主标题使用 `Plus Jakarta Sans Bold`，中文副标题使用 `Noto Serif SC`。\n- **画廊体验**：点击右上角 **历史对话 → 图片画廊**，即可同时体验 **AI 生图**、**过程预览** 与 **参考附件** 三种图片的筛选、对比与 **「置入工作区」** 能力。'
      }
    ],
    requests: [
      {
        id: 'req-showcase-1',
        entryId: 'entry-assistant-1',
        endpoint: 'https://demo.invalid/v1/responses',
        model: 'demo-showcase',
        createdAt: now - 12000,
        completedAt: now - 10580,
        durationMs: 1420,
        status: 'completed',
        usage: {
          inputTokens: 640,
          outputTokens: 215,
          totalTokens: 855,
          cachedTokens: 192,
          reasoningTokens: 84
        }
      },
      {
        id: 'req-showcase-2',
        entryId: 'entry-assistant-2',
        endpoint: 'https://demo.invalid/v1/responses',
        model: 'demo-showcase',
        createdAt: now - 5000,
        completedAt: now - 3140,
        durationMs: 1860,
        status: 'completed',
        usage: {
          inputTokens: 920,
          outputTokens: 280,
          totalTokens: 1200,
          cachedTokens: 512,
          reasoningTokens: 96
        }
      }
    ],
    responseItems: [
      { role: 'user', content: '请结合我上传的品牌参考图，读取当前工作区画布信息并规划春季发布会主视觉海报方案。' },
      { role: 'assistant', content: '主视觉版式规划已完成。' },
      { role: 'user', content: '很好，请查询可用字体并直接生成最终高清主视觉海报。' },
      { role: 'assistant', content: '已为您生成春季发布会主视觉海报。' }
    ]
  };

  const existing = await storage.load();
  const prevSessions = existing?.sessions || [];
  await storage.save({
    sessions: [showcaseSession, ...prevSessions],
    activeSessionId: sessionId
  });
  await reloadConversation();
  return sessionId;
}

function responseCountThroughEntry(session: AssistantSnapshot['sessions'][number], entryIndex: number): number {
  const entry = session.entries[entryIndex];
  if (Number.isSafeInteger(entry.responseItemCount) && entry.responseItemCount! >= 0) return entry.responseItemCount!;
  const userTurns = session.entries.slice(0, entryIndex + 1).filter(item => item.role === 'user').length;
  let seenUsers = 0;
  const history = session.responseItems || [];
  for (let index = 0; index < history.length; index++) {
    const item = history[index];
    if (item && typeof item === 'object' && 'role' in item && item.role === 'user' && ++seenUsers > userTurns) return index;
  }
  return history.length;
}

export async function forkDemoConversation(assistant: AssistantController, event: AssistantForkEvent, reloadConversation: () => Promise<void>): Promise<void> {
  if (assistant.busy || assistant.saving || assistant.activeSessionId !== event.sessionId) throw new Error('The active conversation changed.');
  const source = assistant.sessions.find(session => session.id === event.sessionId);
  const entryIndex = source?.entries.findIndex(entry => entry.id === event.entryId) ?? -1;
  if (!source || entryIndex < 0 || source.entries[entryIndex].role !== 'assistant') throw new Error('The selected response is unavailable.');
  const responseItemCount = event.responseItemCount ?? responseCountThroughEntry(source, entryIndex);
  if (!Number.isSafeInteger(responseItemCount) || responseItemCount < 0 || responseItemCount > (source.responseItems?.length || 0)) throw new Error('The response history is unavailable.');
  const entries = structuredClone(source.entries.slice(0, entryIndex + 1));
  const entryIds = new Set(entries.map(entry => entry.id));
  const referenced = new Map<string, SessionImage>();
  for (const entry of entries) {
    for (const image of [...(entry.images || []), ...(entry.tools || []).flatMap(tool => tool.image ? [tool.image] : [])]) referenced.set(image.id, image);
  }
  const id = crypto.randomUUID();
  const copied: { sessionId: string; imageId: string }[] = [];
  try {
    for (const image of referenced.values()) {
      const blob = await images.loadImage(source.id, image.id);
      if (!blob) throw new Error(`Missing chat image: ${image.name}`);
      await images.saveImage(id, image.id, blob);
      copied.push({ sessionId: id, imageId: image.id });
    }
    const branch = {
      ...source,
      id,
      title: `${source.title} (分叉)`.slice(0, 120),
      updatedAt: Date.now(),
      entries,
      responseItems: structuredClone((source.responseItems || []).slice(0, responseItemCount)),
      requests: source.requests.filter(item => item.entryId && entryIds.has(item.entryId))
    };
    const stored = await storage.load();
    await storage.save({
      sessions: [branch, ...(stored?.sessions || assistant.sessions).filter(item => item.id !== branch.id)],
      activeSessionId: id
    });
    await reloadConversation();
  } catch (error) {
    await images.deleteImages(copied).catch(() => {});
    throw error;
  }
}