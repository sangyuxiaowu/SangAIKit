import { expect, test } from 'bun:test';
import {
  formatPlaceholderToken,
  getEntryModelContent,
  getSessionSystemPrompt,
  isPlaceholdersEnabled,
  resolvePlaceholders,
  tokenizePlaceholders,
  type PlaceholderConfig
} from './placeholders';
import { createResponsesSender } from './openai';

test('formats placeholder tokens cleanly without duplicating braces', () => {
  expect(formatPlaceholderToken('角色:张三')).toBe('{{角色:张三}}');
  expect(formatPlaceholderToken('  故事介绍  ')).toBe('{{故事介绍}}');
  expect(formatPlaceholderToken('{{卷纲}}')).toBe('{{卷纲}}');
});

test('resolves known placeholders in a single non-recursive pass and dedupes async lookups', async () => {
  const calls: string[] = [];
  const config: PlaceholderConfig = {
    enabled: true,
    items: [
      { key: '故事介绍', label: '故事介绍', group: '设定' },
      { key: '角色:张三', label: '张三', group: '角色' }
    ],
    resolve: async key => {
      calls.push(key);
      if (key === '故事介绍') return '背景包含{{角色:张三}}的伏笔';
      if (key === '角色:张三') return '冷静的修表匠';
      return undefined;
    }
  };

  const result = await resolvePlaceholders(
    '参考{{故事介绍}}，分析{{角色:张三}}与{{角色:张三}}的选择，保留{{未注册}}。',
    config,
    's1'
  );

  // Deduplicated resolver calls (角色:张三 appears twice in input, plus once inside 故事介绍's value which must NOT expand)
  expect(calls).toEqual(['故事介绍', '角色:张三']);
  expect(result.rawContent).toBe('参考{{故事介绍}}，分析{{角色:张三}}与{{角色:张三}}的选择，保留{{未注册}}。');
  expect(result.sentContent).toBe('参考背景包含{{角色:张三}}的伏笔，分析冷静的修表匠与冷静的修表匠的选择，保留{{未注册}}。');
  expect(result.placeholders).toHaveLength(2);
  expect(result.placeholders[0]).toMatchObject({
    key: '故事介绍',
    token: '{{故事介绍}}',
    group: '设定',
    value: '背景包含{{角色:张三}}的伏笔',
    resolved: true
  });
  expect(result.placeholders[1]).toMatchObject({
    key: '角色:张三',
    token: '{{角色:张三}}',
    group: '角色',
    value: '冷静的修表匠',
    resolved: true
  });
});

test('supports dynamic placeholder resolution and records unresolved tokens safely', async () => {
  const config: PlaceholderConfig = {
    enabled: true,
    items: [{ key: '卷纲', label: '卷纲' }],
    allowDynamic: true,
    resolve: key => (key === '卷纲' ? '第一卷内容' : null)
  };

  const result = await resolvePlaceholders('查看{{卷纲}}和{{角色:无名}}', config);
  expect(result.sentContent).toBe('查看第一卷内容和{{角色:无名}}');
  expect(result.placeholders).toHaveLength(2);
  expect(result.placeholders[0].resolved).toBe(true);
  expect(result.placeholders[1]).toMatchObject({
    key: '角色:无名',
    token: '{{角色:无名}}',
    value: '',
    resolved: false
  });
});

test('skips resolution when disabled via feature flag or config', async () => {
  const config: PlaceholderConfig = {
    enabled: false,
    items: [{ key: '故事介绍' }],
    resolve: () => '不应被调用'
  };
  expect(isPlaceholdersEnabled(config, { placeholders: true })).toBe(false);
  expect(isPlaceholdersEnabled({ ...config, enabled: true }, { placeholders: false })).toBe(false);
  expect(isPlaceholdersEnabled({ ...config, enabled: true }, { placeholders: true })).toBe(true);

  const result = await resolvePlaceholders('使用{{故事介绍}}', config);
  expect(result.sentContent).toBe('使用{{故事介绍}}');
  expect(result.placeholders).toEqual([]);
});

test('tokenizes user display text into plain text and interactive placeholder segments', () => {
  const segments = tokenizePlaceholders('请结合{{故事介绍}}与{{角色:张三}}写作。', [
    { key: '故事介绍', token: '{{故事介绍}}', value: '故事内容', resolved: true, resolvedAt: 100 },
    { key: '角色:张三', token: '{{角色:张三}}', value: '张三档案', resolved: true, resolvedAt: 100 }
  ]);

  expect(segments.map(item => (item.type === 'text' ? item.text : `[${item.key}]`))).toEqual([
    '请结合',
    '[故事介绍]',
    '与',
    '[角色:张三]',
    '写作。'
  ]);
  expect(getEntryModelContent({ content: '原文{{故事介绍}}', sentContent: '原文故事内容' })).toBe('原文故事内容');
  expect(getEntryModelContent({ content: '普通文本' })).toBe('普通文本');
  expect(getSessionSystemPrompt({ systemPrompt: '系统{{故事介绍}}', sentSystemPrompt: '系统故事内容' }, '默认')).toBe('系统故事内容');
  expect(getSessionSystemPrompt({ systemPrompt: '纯系统提示词' }, '默认')).toBe('纯系统提示词');
  expect(getSessionSystemPrompt(undefined, '默认')).toBe('默认');
});

test('resolves placeholders in system prompts with target="system" and in createResponsesSender instructions', async () => {
  const targets: Array<string | undefined> = [];
  const placeholderConfig: PlaceholderConfig = {
    enabled: true,
    items: [
      { key: '故事介绍', label: '故事介绍', group: '设定' },
      { key: '角色:张三', label: '张三', group: '角色' }
    ],
    resolve: (key, ctx) => {
      targets.push(ctx.target);
      if (key === '故事介绍') return '《寒雾古城》背景';
      if (key === '角色:张三') return '冷静的修表匠';
      return undefined;
    }
  };

  const resolvedSystem = await resolvePlaceholders(
    '你是编辑，遵循{{故事介绍}}。',
    placeholderConfig,
    'session-1',
    { placeholders: true },
    'system'
  );
  expect(resolvedSystem.sentContent).toBe('你是编辑，遵循《寒雾古城》背景。');
  expect(targets).toEqual(['system']);

  const originalFetch = globalThis.fetch;
  let capturedInstructions: unknown;
  globalThis.fetch = Object.assign(
    async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      capturedInstructions = body.instructions;
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
      instructions: '全局设定：{{故事介绍}}；主角：{{角色:张三}}。',
      placeholders: placeholderConfig,
      features: { placeholders: true }
    });
    await sender([{ role: 'user', content: '你好' }], new AbortController().signal, () => {});
    expect(capturedInstructions).toBe('全局设定：《寒雾古城》背景；主角：冷静的修表匠。');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
