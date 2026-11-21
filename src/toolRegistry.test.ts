import { expect, test } from 'bun:test';
import { createBuiltInTools } from './builtInTools';
import { createImageModel } from './image-generation/index';
import { createEndpoint } from './modelConfig';
import { createResponsesSender } from './openai';
import type { AiConfig } from './settingsTypes';
import {
  applyToolMetadataOverrides,
  createToolRegistry,
  listAvailableTools,
  resolveSessionTools,
  resolveToolGroup,
  resolveToolUiDescription,
  type RegisteredTool
} from './toolRegistry';

function sampleConfig(): AiConfig {
  const endpoint = createEndpoint('openai');
  endpoint.endpoint = 'https://example.com/v1';
  endpoint.apiKey = 'test-key';
  const imageModel = { ...createImageModel('gpt-image-2'), enabled: true, endpointId: endpoint.id };
  return {
    endpoints: [endpoint],
    imageModels: [imageModel],
    activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id },
    systemPrompt: 'Base system prompt',
    imageToolPrompt: 'Custom image prompt',
    skills: [{ name: 'novel-style', description: 'Novel style guide', content: 'Keep tension tight.' }],
    localFonts: [{ family: 'FangSong', fullName: 'FangSong', styles: [] }]
  };
}

function makeHostTool(name: string, labelZh: string): RegisteredTool {
  return {
    name,
    label: { zh: labelZh, en: name },
    description: `Host tool ${name}`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, tool: name })
  };
}

test('tool registry supports registration, unregistration, subscription, and rejects duplicate names', () => {
  const registry = createToolRegistry();
  let notifications = 0;
  const unsub = registry.subscribe(() => { notifications++; });

  const dispose = registry.register(makeHostTool('query_outline', '查询卷纲'));
  expect(registry.has('query_outline')).toBe(true);
  expect(registry.list()).toHaveLength(1);
  expect(notifications).toBe(1);

  expect(() => registry.register(makeHostTool('query_outline', '重复工具'))).toThrow(/already registered/);

  registry.registerMany([makeHostTool('query_character', '读取角色')]);
  expect(registry.list().map(t => t.name)).toEqual(['query_outline', 'query_character']);

  dispose();
  expect(registry.has('query_outline')).toBe(false);
  expect(registry.list().map(t => t.name)).toEqual(['query_character']);

  unsub();
  registry.unregister('query_character');
  expect(registry.list()).toEqual([]);
});

test('listAvailableTools combines host business tools and SangAIKit built-in tools', () => {
  const config = sampleConfig();
  const hostTools = [makeHostTool('query_outline', '查询卷纲'), makeHostTool('query_character', '读取角色')];
  const descriptors = listAvailableTools({ config, hostTools });

  expect(descriptors.filter(t => t.source === 'host').map(t => t.name)).toEqual(['query_outline', 'query_character']);
  expect(descriptors.filter(t => t.source === 'builtin').map(t => t.name)).toEqual([
    'remove_background',
    'list_fonts',
    'skill',
    'generate_image'
  ]);
});

test('createBuiltInTools and resolveSessionTools filter per-session enabledTools and prune unused prompts', () => {
  const config = sampleConfig();
  const hostTools = [makeHostTool('query_outline', '查询卷纲'), makeHostTool('query_character', '读取角色')];
  const builtIn = createBuiltInTools({
    config,
    enabledTools: ['list_fonts'],
    loadImage: async () => null,
    saveImage: async (blob, name) => ({ id: 'img-1', name, type: 'image/png', size: blob.size })
  });

  expect(builtIn.tools.map(t => t.name)).toEqual(['list_fonts']);
  expect(builtIn.instructions).not.toContain('Custom image prompt');
  expect(builtIn.instructions).not.toContain('<available_skills>');

  const resolved = resolveSessionTools({
    hostTools,
    builtInTools: createBuiltInTools({
      config,
      loadImage: async () => null,
      saveImage: async (blob, name) => ({ id: 'img-1', name, type: 'image/png', size: blob.size })
    }).tools,
    enabledTools: ['query_outline', 'skill']
  });

  expect(resolved.tools.map(t => t.name)).toEqual(['query_outline', 'skill']);
  expect(resolved.hostTools.map(t => t.name)).toEqual(['query_outline']);
  expect(resolved.builtInTools.map(t => t.name)).toEqual(['skill']);
});

test('createResponsesSender filters host and built-in tools by enabledTools and sends sentContent over content', async () => {
  const originalFetch = globalThis.fetch;
  const config = sampleConfig();
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = Object.assign(
    async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]}]}}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    },
    { preconnect: originalFetch.preconnect }
  ) as typeof fetch;

  try {
    const sender = createResponsesSender({
      baseURL: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'gpt-5',
      instructions: 'Session-specific instructions',
      tools: [makeHostTool('query_outline', '查询卷纲'), makeHostTool('query_character', '读取角色')],
      builtIn: {
        config,
        loadImage: async () => null,
        saveImage: async (blob, name) => ({ id: 'img-1', name, type: 'image/png', size: blob.size })
      },
      enabledTools: ['query_outline', 'list_fonts']
    });

    let reply = '';
    await sender(
      [{ role: 'user', content: '使用{{故事介绍}}写作', sentContent: '使用《寒雾古城》背景写作' }],
      new AbortController().signal,
      chunk => { reply += chunk; }
    );

    expect(reply).toBe('OK');
    expect(capturedBody?.instructions).toBe('Session-specific instructions');
    const sentTools = (capturedBody?.tools as Array<{ name: string }> | undefined)?.map(t => t.name) ?? [];
    expect(sentTools).toEqual(['query_outline', 'list_fonts']);
    const sentInput = capturedBody?.input as Array<{ role?: string; content?: string }>;
    expect(sentInput[0]).toEqual({ role: 'user', content: '使用《寒雾古城》背景写作' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('supports group and uiDescription separate from LLM description, and overrides built-in tool metadata per host project', async () => {
  const config = sampleConfig();
  const hostTool: RegisteredTool = {
    name: 'read_chapter',
    label: { zh: '读取章节', en: 'Read chapter' },
    group: { zh: '编辑工具', en: 'Editing Tools' },
    uiDescription: { zh: '读取指定章节内容', en: 'Read specified chapter content' },
    description: 'LLM-only schema: Fetch chapter by 1-based chapterNumber.',
    parameters: { type: 'object', properties: { chapterNumber: { type: 'number' } } },
    execute: async () => ({ content: '...' })
  };

  const available = listAvailableTools({
    config,
    hostTools: [hostTool],
    builtInOverrides: {
      list_fonts: {
        group: '排版与样式',
        uiDescription: '查看项目支持的字体列表',
        defaultEnabled: false
      },
      skill: {
        group: { zh: '创作规范', en: 'Writing Guides' },
        uiDescription: { zh: '读取文风与设定规范', en: 'Read style guides' }
      }
    }
  });

  const chapterDesc = available.find(t => t.name === 'read_chapter')!;
  expect(resolveToolGroup(chapterDesc, false)).toBe('编辑工具');
  expect(resolveToolGroup(chapterDesc, true)).toBe('Editing Tools');
  expect(resolveToolUiDescription(chapterDesc, false)).toBe('读取指定章节内容');
  expect(resolveToolUiDescription(chapterDesc, true)).toBe('Read specified chapter content');
  // LLM schema description stays intact and separate from uiDescription
  expect(chapterDesc.description).toBe('LLM-only schema: Fetch chapter by 1-based chapterNumber.');

  const fontsDesc = available.find(t => t.name === 'list_fonts')!;
  expect(resolveToolGroup(fontsDesc, false)).toBe('排版与样式');
  expect(resolveToolUiDescription(fontsDesc, false)).toBe('查看项目支持的字体列表');
  expect(fontsDesc.defaultEnabled).toBe(false);

  const skillDesc = available.find(t => t.name === 'skill')!;
  expect(resolveToolGroup(skillDesc, false)).toBe('创作规范');
  expect(resolveToolGroup(skillDesc, true)).toBe('Writing Guides');
  expect(resolveToolUiDescription(skillDesc, false)).toBe('读取文风与设定规范');

  // applyToolMetadataOverrides can also override any descriptor post-hoc
  const remapped = applyToolMetadataOverrides(available, {
    read_chapter: { group: '自定义编辑组' },
    remove_background: { group: '插画处理', uiDescription: '为角色立绘去背' }
  });
  expect(resolveToolGroup(remapped.find(t => t.name === 'read_chapter')!, false)).toBe('自定义编辑组');
  expect(resolveToolGroup(remapped.find(t => t.name === 'remove_background')!, false)).toBe('插画处理');
  expect(resolveToolUiDescription(remapped.find(t => t.name === 'remove_background')!, false)).toBe('为角色立绘去背');

  // Verify createResponsesSender sends the LLM `description` and never leaks `uiDescription` as schema description
  const originalFetch = globalThis.fetch;
  let capturedTools: Array<{ name: string; description?: string }> = [];
  globalThis.fetch = Object.assign(
    async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tools?: Array<{ name: string; description?: string }> };
      capturedTools = body.tools ?? [];
      return new Response(
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]}]}}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    },
    { preconnect: originalFetch.preconnect }
  ) as typeof fetch;

  try {
    const sender = createResponsesSender({
      baseURL: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'gpt-5',
      tools: [hostTool],
      enabledTools: ['read_chapter']
    });
    await sender([{ role: 'user', content: 'hi' }], new AbortController().signal, () => {});
    expect(capturedTools).toHaveLength(1);
    expect(capturedTools[0].description).toBe('LLM-only schema: Fetch chapter by 1-based chapterNumber.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
