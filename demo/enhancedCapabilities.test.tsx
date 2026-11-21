// @vitest-environment jsdom
import { act, createRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AiAssistant,
  createEndpoint,
  createResponsesSender,
  createToolRegistry,
  getSessionSystemPrompt,
  listAvailableTools,
  useAssistant,
  type AiConfig,
  type AssistantController,
  type AssistantSnapshot,
  type AssistantStorage,
  type ComposerController,
  type PlaceholderConfig
} from '../src';

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function createMemoryStorage(initial: AssistantSnapshot | null = null): {
  storage: AssistantStorage;
  getSaved: () => AssistantSnapshot | null;
} {
  let saved = initial ? structuredClone(initial) : null;
  return {
    storage: {
      async load() {
        return saved ? structuredClone(saved) : null;
      },
      async save(snapshot) {
        saved = structuredClone(snapshot);
      }
    },
    getSaved: () => (saved ? structuredClone(saved) : null)
  };
}

function createFakeFloating() {
  return {
    style: { left: 20, top: 20, width: 420, height: 640 },
    minimized: false,
    setMinimized: vi.fn(),
    headerEvents: { onPointerDown: vi.fn() },
    resizeEvents: { onPointerDown: vi.fn() },
    resizeByKeyboard: vi.fn()
  };
}

function createTestConfig(): AiConfig {
  const endpoint = createEndpoint('openai');
  endpoint.endpoint = 'https://example.com/v1';
  endpoint.apiKey = 'test-key';
  return {
    endpoints: [endpoint],
    imageModels: [],
    activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id },
    systemPrompt: 'Global default system prompt',
    skills: [{ name: 'style-guide', description: 'Style guide', content: 'Be vivid.' }],
    localFonts: [{ family: 'Noto Serif SC', fullName: 'Noto Serif SC', styles: [] }]
  };
}

it('starts host-configured sessions with system prompt visibility, initial prompt, and live adjustable host + built-in tools', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_target: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Reply ${requests.length}` }] }];
    return new Response(
      `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } }
    );
  }));

  const config = createTestConfig();
  const { storage } = createMemoryStorage();
  const registry = createToolRegistry();
  registry.registerMany([
    {
      name: 'query_novel_outline',
      label: { zh: '查询小说卷纲', en: 'Query novel outline' },
      description: 'Read volume outline',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ outline: '第一卷' })
    },
    {
      name: 'query_character_sheet',
      label: { zh: '读取角色设定卡', en: 'Query character sheet' },
      description: 'Read character sheet',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ name: '张三' })
    }
  ]);

  let controller!: AssistantController;
  function Harness() {
    const hostTools = useMemo(() => registry.list(), []);
    const availableTools = useMemo(() => listAvailableTools({ config, hostTools }), [hostTools]);
    controller = useAssistant(async (entries, events) => {
      const endpoint = config.endpoints[0];
      await createResponsesSender({
        baseURL: endpoint.endpoint,
        apiKey: endpoint.apiKey,
        model: endpoint.models[0].modelId,
        instructions: events.session.systemPrompt ?? config.systemPrompt,
        tools: hostTools,
        builtIn: { config, loadImage: events.loadImage, saveImage: events.saveImage },
        enabledTools: events.session.enabledTools,
        history: events.history,
        onHistory: events.onHistory
      })(
        entries.map(entry => ({ role: entry.role, content: entry.content, sentContent: entry.sentContent })),
        events.signal,
        events.onText
      );
    }, storage);

    return (
      <AiAssistant
        assistant={controller}
        floating={createFakeFloating()}
        language="zh"
        open={true}
        title="小说助手"
        emptyTitle="就绪"
        emptyDescription="开始创作"
        quickSnippets={[]}
        active={{ model: config.endpoints[0].models[0] }}
        availableTools={availableTools}
        loadImage={async () => null}
        createImageUpload={async () => { throw new Error('unused'); }}
        imageModelForTool={() => undefined}
        sumUsage={() => undefined}
        renderMarkdown={text => <p>{text}</p>}
        renderUsage={() => null}
        renderModelControls={() => null}
        renderSettings={() => null}
      />
    );
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Harness />); });

    // Host starts a new session with visible systemPrompt, initialPrompt, and chosen tools
    await act(async () => {
      await controller.newSession({
        title: '悬疑小说共创',
        systemPrompt: '你是悬疑小说主编。',
        showSystemPrompt: true,
        initialPrompt: '请给出开篇建议',
        enabledTools: ['query_novel_outline', 'list_fonts']
      });
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].instructions).toBe('你是悬疑小说主编。');
    expect((requests[0].tools as Array<{ name: string }>).map(t => t.name)).toEqual(['query_novel_outline', 'list_fonts']);
    expect(host.querySelector('.cf-ai-system-prompt')?.textContent).toContain('你是悬疑小说主编。');

    // Adjust session tools via UI header panel
    const toolsTrigger = host.querySelector<HTMLButtonElement>('.cf-ai-tools-trigger')!;
    expect(toolsTrigger.textContent).toContain('2');
    await act(async () => { toolsTrigger.click(); });
    const panel = host.querySelector('.cf-ai-session-tools-panel')!;
    expect(panel).toBeTruthy();

    // Enable query_character_sheet via checkbox inside UI tree
    const charCheckbox = Array.from(panel.querySelectorAll<HTMLLabelElement>('.cf-ai-tool-tree-item'))
      .find(item => item.textContent?.includes('query_character_sheet'))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { charCheckbox.click(); });

    // Also adjust via controller API directly
    await act(async () => {
      await controller.setSessionTools?.(['query_character_sheet', 'skill']);
    });

    await act(async () => { await controller.send('继续下一幕'); });
    expect(requests).toHaveLength(2);
    expect((requests[1].tools as Array<{ name: string }>).map(t => t.name)).toEqual(['query_character_sheet', 'skill']);

    // Start another session with showSystemPrompt: false -> banner must be hidden, yet API still receives systemPrompt
    await act(async () => {
      await controller.newSession({
        systemPrompt: '隐藏的系统指令',
        showSystemPrompt: false,
        initialPrompt: '你好',
        enabledTools: []
      });
    });
    expect(host.querySelector('.cf-ai-system-prompt')).toBeNull();
    expect(requests[2].instructions).toBe('隐藏的系统指令');
    expect(requests[2].tools).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('resolves placeholders on send, displays clickable chips with immutable snapshots, and persists across reload & regenerate', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const sentToApi: string[] = [];
  let roleProfile = '张三（初版设定）：沉默寡言的修表匠';
  const storyIntro = '《寒雾古城》：子时钟声改写记忆。';

  const { storage, getSaved } = createMemoryStorage();
  const config = createTestConfig();
  let controller!: AssistantController;

  const placeholderConfig: PlaceholderConfig = {
    enabled: true,
    items: [
      { key: '故事介绍', label: '故事介绍', group: '设定' },
      { key: '角色:张三', label: '角色：张三', group: '角色' }
    ],
    resolve: key => {
      if (key === '故事介绍') return storyIntro;
      if (key === '角色:张三') return roleProfile;
      return undefined;
    }
  };

  function Harness() {
    controller = useAssistant(async (entries, events) => {
      const last = entries[entries.length - 1];
      const modelInput = last.sentContent ?? last.content;
      sentToApi.push(modelInput);
      events.onText(`已收到：${modelInput}`);
      events.onHistory([...events.history, { role: 'user', content: modelInput }, { role: 'assistant', content: `已收到：${modelInput}` }]);
    }, storage, { placeholders: placeholderConfig });

    return (
      <AiAssistant
        assistant={controller}
        floating={createFakeFloating()}
        language="zh"
        open={true}
        title="小说助手"
        emptyTitle="就绪"
        emptyDescription="开始创作"
        quickSnippets={[]}
        active={{ model: config.endpoints[0].models[0] }}
        loadImage={async () => null}
        createImageUpload={async () => { throw new Error('unused'); }}
        imageModelForTool={() => undefined}
        sumUsage={() => undefined}
        renderMarkdown={text => <p>{text}</p>}
        renderUsage={() => null}
        renderModelControls={() => null}
        renderSettings={() => null}
      />
    );
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Harness />); });

    await act(async () => {
      await controller.send('结合{{故事介绍}}分析{{角色:张三}}的动机。');
    });

    // API receives replaced text
    expect(sentToApi[0]).toBe('结合《寒雾古城》：子时钟声改写记忆。分析张三（初版设定）：沉默寡言的修表匠的动机。');

    // UI shows placeholder chips instead of expanded text
    const chips = Array.from(host.querySelectorAll<HTMLButtonElement>('.cf-ai-placeholder-chip'));
    expect(chips.map(btn => btn.textContent?.trim())).toEqual(['{{故事介绍}}', '{{角色:张三}}']);

    // Mutate host character bio AFTER message was sent
    roleProfile = '张三（改版设定）：性格张扬的铁匠';

    // Clicking the {{角色:张三}} chip must display the original send-time snapshot
    await act(async () => { chips[1].click(); });
    const snapshotPanel = host.querySelector('.cf-ai-placeholder-snapshot')!;
    expect(snapshotPanel).toBeTruthy();
    expect(snapshotPanel.textContent).toContain('张三（初版设定）：沉默寡言的修表匠');
    expect(snapshotPanel.textContent).not.toContain('性格张扬的铁匠');

    // Toggle full sent content preview
    const toggleSentBtn = snapshotPanel.querySelector<HTMLButtonElement>('.cf-ai-placeholder-toggle-sent')!;
    await act(async () => { toggleSentBtn.click(); });
    expect(snapshotPanel.querySelector('.cf-ai-placeholder-sent-body')?.textContent).toBe(sentToApi[0]);

    // Saved snapshot persists rawContent, sentContent, and placeholders
    const persistedEntry = getSaved()!.sessions[0].entries[0];
    expect(persistedEntry.rawContent).toBe('结合{{故事介绍}}分析{{角色:张三}}的动机。');
    expect(persistedEntry.sentContent).toBe(sentToApi[0]);
    expect(persistedEntry.placeholders?.find(item => item.key === '角色:张三')?.value).toBe('张三（初版设定）：沉默寡言的修表匠');

    // Regenerating keeps the original send-time snapshot instead of re-resolving with mutated data
    await act(async () => { await controller.regenerate(); });
    expect(sentToApi[1]).toBe(sentToApi[0]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('renders host composer toolbar above input and allows cursor-aware input manipulation via toolbar and composerRef', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { storage } = createMemoryStorage();
  const config = createTestConfig();
  const composerRef = createRef<ComposerController | null>();
  const sentPrompts: string[] = [];

  function Harness() {
    const assistant = useAssistant(async (entries, events) => {
      sentPrompts.push(entries[entries.length - 1].content);
      events.onText('OK');
    }, storage);

    return (
      <AiAssistant
        assistant={assistant}
        floating={createFakeFloating()}
        language="zh"
        open={true}
        title="小说助手"
        emptyTitle="就绪"
        emptyDescription="开始创作"
        quickSnippets={[]}
        active={{ model: config.endpoints[0].models[0] }}
        composerRef={composerRef}
        renderComposerToolbar={composer => (
          <>
            <select
              aria-label="快捷提示词"
              defaultValue=""
              onChange={event => {
                if (!event.target.value) return;
                composer.setValue(event.target.value);
                event.target.value = '';
              }}
            >
              <option value="">选择模板</option>
              <option value="请分析的角色动机">模板一</option>
            </select>
            <button type="button" onClick={() => composer.insertPlaceholder('角色:张三')}>
              插入张三
            </button>
            <button type="button" onClick={() => composer.submit()}>
              快捷发送
            </button>
          </>
        )}
        loadImage={async () => null}
        createImageUpload={async () => { throw new Error('unused'); }}
        imageModelForTool={() => undefined}
        sumUsage={() => undefined}
        renderMarkdown={text => <p>{text}</p>}
        renderUsage={() => null}
        renderModelControls={() => null}
        renderSettings={() => null}
      />
    );
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Harness />); });

    const toolbar = host.querySelector('.cf-ai-composer-toolbar')!;
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(toolbar).toBeTruthy();
    // Toolbar is rendered immediately before the input container inside the composer form
    expect(toolbar.parentElement?.tagName).toBe('FORM');
    expect(toolbar.nextElementSibling?.contains(textarea)).toBe(true);

    // Select a quick prompt from toolbar dropdown
    const select = toolbar.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      select.value = '请分析的角色动机';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(textarea.value).toBe('请分析的角色动机');

    // Place caret between "请分析" (index 3) and "的角色动机" via composerRef, then insert placeholder via toolbar button
    await act(async () => {
      composerRef.current?.setSelection(3, 3);
    });
    const insertBtn = Array.from(toolbar.querySelectorAll('button')).find(btn => btn.textContent === '插入张三')!;
    await act(async () => { insertBtn.click(); });
    expect(textarea.value).toBe('请分析{{角色:张三}}的角色动机');

    // Append text via composerRef and submit via toolbar button
    await act(async () => {
      composerRef.current?.appendText('（控制在300字内）');
    });
    expect(textarea.value).toBe('请分析{{角色:张三}}的角色动机（控制在300字内）');

    const sendBtn = Array.from(toolbar.querySelectorAll('button')).find(btn => btn.textContent === '快捷发送')!;
    await act(async () => { sendBtn.click(); });
    expect(sentPrompts).toEqual(['请分析{{角色:张三}}的角色动机（控制在300字内）']);
    expect(textarea.value).toBe('');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('supports hiding the built-in top-right tool picker via showHeaderToolPicker or features.sessionToolPicker', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { storage } = createMemoryStorage();
  const config = createTestConfig();
  const availableTools = listAvailableTools({ config });

  function Harness({
    showHeaderToolPicker,
    sessionToolPickerFeature
  }: {
    showHeaderToolPicker?: boolean;
    sessionToolPickerFeature?: boolean;
  }) {
    const assistant = useAssistant(async (_entries, events) => {
      events.onText('OK');
    }, storage);

    return (
      <AiAssistant
        assistant={assistant}
        floating={createFakeFloating()}
        language="zh"
        open={true}
        title="小说助手"
        emptyTitle="就绪"
        emptyDescription="开始创作"
        quickSnippets={[]}
        features={sessionToolPickerFeature === undefined ? undefined : { sessionToolPicker: sessionToolPickerFeature }}
        showHeaderToolPicker={showHeaderToolPicker}
        active={{ model: config.endpoints[0].models[0] }}
        availableTools={availableTools}
        loadImage={async () => null}
        createImageUpload={async () => { throw new Error('unused'); }}
        imageModelForTool={() => undefined}
        sumUsage={() => undefined}
        renderMarkdown={text => <p>{text}</p>}
        renderUsage={() => null}
        renderModelControls={() => null}
        renderSettings={() => null}
      />
    );
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    // Hidden when showHeaderToolPicker={false}
    await act(async () => { root.render(<Harness showHeaderToolPicker={false} />); });
    expect(host.querySelector('.cf-ai-tools-trigger')).toBeNull();

    // Hidden when features.sessionToolPicker is false
    await act(async () => { root.render(<Harness sessionToolPickerFeature={false} />); });
    expect(host.querySelector('.cf-ai-tools-trigger')).toBeNull();

    // Explicit showHeaderToolPicker={true} overrides features.sessionToolPicker=false
    await act(async () => { root.render(<Harness showHeaderToolPicker={true} sessionToolPickerFeature={false} />); });
    expect(host.querySelector('.cf-ai-tools-trigger')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('renders searchable tree-grouped checkbox tool picker with custom groups, uiDescription, collapse, and tri-state parent checkboxes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { storage } = createMemoryStorage();
  const config = createTestConfig();
  const registry = createToolRegistry();
  registry.registerMany([
    {
      name: 'read_chapter_content',
      label: { zh: '读取指定章节', en: 'Read chapter' },
      group: '编辑工具',
      uiDescription: '读取指定章节内容',
      description: 'LLM internal schema description that should not replace uiDescription',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true })
    },
    {
      name: 'replace_chapter_text',
      label: { zh: '改写章节段落', en: 'Rewrite paragraph' },
      group: '编辑工具',
      uiDescription: '按指令局部润色或替换章节正文',
      description: 'LLM internal rewrite schema',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true })
    }
  ]);

  let controller!: AssistantController;
  function Harness() {
    const hostTools = useMemo(() => registry.list(), []);
    const availableTools = useMemo(
      () =>
        listAvailableTools({
          config,
          hostTools,
          builtInOverrides: {
            skill: { group: '创作规范', uiDescription: '读取项目写作规范' },
            list_fonts: { group: '编辑工具', uiDescription: '查询正文排版字体' }
          }
        }),
      [hostTools]
    );
    controller = useAssistant(async (_entries, events) => {
      events.onText('OK');
    }, storage);

    return (
      <AiAssistant
        assistant={controller}
        floating={createFakeFloating()}
        language="zh"
        open={true}
        title="小说助手"
        emptyTitle="就绪"
        emptyDescription="开始创作"
        quickSnippets={[]}
        active={{ model: config.endpoints[0].models[0] }}
        availableTools={availableTools}
        loadImage={async () => null}
        createImageUpload={async () => { throw new Error('unused'); }}
        imageModelForTool={() => undefined}
        sumUsage={() => undefined}
        renderMarkdown={text => <p>{text}</p>}
        renderUsage={() => null}
        renderModelControls={() => null}
        renderSettings={() => null}
      />
    );
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => {
      await controller.setSessionTools?.(['read_chapter_content', 'skill']);
    });

    // Open tree tool picker
    const trigger = host.querySelector<HTMLButtonElement>('.cf-ai-tools-trigger')!;
    await act(async () => { trigger.click(); });
    const panel = host.querySelector('.cf-ai-session-tools-panel')!;
    expect(panel).toBeTruthy();

    // Displays group names including built-in tool merged into "编辑工具" and overridden "创作规范"
    const groupNames = Array.from(panel.querySelectorAll('.cf-ai-tool-tree-group-name')).map(el => el.textContent);
    expect(groupNames).toContain('编辑工具');
    expect(groupNames).toContain('创作规范');

    // Displays user-facing uiDescription instead of LLM schema description
    expect(panel.textContent).toContain('读取指定章节内容');
    expect(panel.textContent).toContain('查询正文排版字体');
    expect(panel.textContent).not.toContain('LLM internal schema description');

    // Parent group "编辑工具" has 1/3 selected -> indeterminate=true, checked=false
    const editGroup = Array.from(panel.querySelectorAll<HTMLElement>('.cf-ai-tool-tree-group'))
      .find(node => node.querySelector('.cf-ai-tool-tree-group-name')?.textContent === '编辑工具')!;
    const editGroupCheckbox = editGroup.querySelector<HTMLInputElement>('.cf-ai-tool-tree-group-check input[type="checkbox"]')!;
    expect(editGroupCheckbox.checked).toBe(false);
    expect(editGroupCheckbox.indeterminate).toBe(true);

    // Clicking group checkbox selects all 3 tools in "编辑工具" (including overridden built-in list_fonts)
    await act(async () => { editGroupCheckbox.click(); });
    const activeSessionAfterSelect = controller.sessions.find(s => s.id === controller.activeSessionId)!;
    expect(activeSessionAfterSelect.enabledTools).toEqual(
      expect.arrayContaining(['read_chapter_content', 'replace_chapter_text', 'list_fonts', 'skill'])
    );
    expect(editGroupCheckbox.checked).toBe(true);
    expect(editGroupCheckbox.indeterminate).toBe(false);

    // Clicking group checkbox again unselects all 3 tools in "编辑工具" while leaving "创作规范" (skill) intact
    await act(async () => { editGroupCheckbox.click(); });
    const activeSessionAfterUnselect = controller.sessions.find(s => s.id === controller.activeSessionId)!;
    expect(activeSessionAfterUnselect.enabledTools).toEqual(['skill']);

    // Collapse & expand group node
    const collapseBtn = editGroup.querySelector<HTMLButtonElement>('.cf-ai-tool-tree-toggle')!;
    await act(async () => { collapseBtn.click(); });
    expect(editGroup.querySelector('.cf-ai-tool-tree-children')).toBeNull();
    await act(async () => { collapseBtn.click(); });
    expect(editGroup.querySelector('.cf-ai-tool-tree-children')).not.toBeNull();

    // Search filters by uiDescription and auto-expands matching groups
    const searchInput = panel.querySelector<HTMLInputElement>('.cf-ai-tool-tree-search input')!;
    const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setNativeValue.call(searchInput, '读取指定章节内容');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const visibleItems = Array.from(panel.querySelectorAll('.cf-ai-tool-tree-item'));
    expect(visibleItems).toHaveLength(1);
    expect(visibleItems[0].textContent).toContain('read_chapter_content');

    // Clear search button restores full tree
    const clearBtn = panel.querySelector<HTMLButtonElement>('.cf-ai-tool-tree-search-clear')!;
    await act(async () => { clearBtn.click(); });
    expect(panel.querySelectorAll('.cf-ai-tool-tree-item').length).toBeGreaterThan(2);

    // Tool picker is mounted inside a dropdown floating popover that closes on Escape without closing the panel, and closes on outside pointerdown
    const popover = host.querySelector('.cf-ai-tools-popover');
    expect(popover).not.toBeNull();
    expect(popover?.contains(panel)).toBe(true);

    const asidePanel = host.querySelector<HTMLElement>('.cf-ai-panel')!;
    await act(async () => {
      asidePanel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('.cf-ai-tools-popover')).toBeNull();
    expect(host.querySelector('.cf-ai-panel')).not.toBeNull();

    // Re-open and close via outside pointerdown
    await act(async () => { trigger.click(); });
    expect(host.querySelector('.cf-ai-tools-popover')).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(host.querySelector('.cf-ai-tools-popover')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('resolves placeholders in session systemPrompt, displays clickable chips & immutable snapshots, and sends expanded instructions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let storyIntro = '《寒雾古城》初版设定：子时钟声会改写一段记忆。';
  const capturedSystemPrompts: string[] = [];
  const { storage, getSaved } = createMemoryStorage();
  const config = createTestConfig();
  let controller!: AssistantController;

  const placeholderConfig: PlaceholderConfig = {
    enabled: true,
    items: [{ key: '故事介绍', label: '故事介绍', group: '设定' }],
    resolve: key => (key === '故事介绍' ? storyIntro : undefined)
  };

  function Harness() {
    controller = useAssistant(async (_entries, events) => {
      const effectiveSystem = getSessionSystemPrompt(events.session, config.systemPrompt) ?? '';
      capturedSystemPrompts.push(effectiveSystem);
      events.onText('OK');
    }, storage, { placeholders: placeholderConfig, features: { placeholders: true } });

    return (
      <AiAssistant
        assistant={controller}
        floating={createFakeFloating()}
        language="zh"
        open={true}
        title="小说助手"
        emptyTitle="就绪"
        emptyDescription="开始创作"
        quickSnippets={[]}
        active={{ model: config.endpoints[0].models[0] }}
        loadImage={async () => null}
        createImageUpload={async () => { throw new Error('unused'); }}
        imageModelForTool={() => undefined}
        sumUsage={() => undefined}
        renderMarkdown={text => <p>{text}</p>}
        renderUsage={() => null}
        renderModelControls={() => null}
        renderSettings={() => null}
      />
    );
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Harness />); });

    await act(async () => {
      await controller.newSession({
        title: '系统提示词占位符测试',
        systemPrompt: '你是小说共创编辑，请遵守：{{故事介绍}}',
        showSystemPrompt: true,
        initialPrompt: '请构思开篇场景'
      });
    });

    // Runner received the expanded system prompt
    expect(capturedSystemPrompts).toEqual([
      '你是小说共创编辑，请遵守：《寒雾古城》初版设定：子时钟声会改写一段记忆。'
    ]);

    // Persisted session holds raw systemPrompt, sentSystemPrompt, and snapshots
    const persisted = getSaved()!.sessions[0];
    expect(persisted.systemPrompt).toBe('你是小说共创编辑，请遵守：{{故事介绍}}');
    expect(persisted.sentSystemPrompt).toBe('你是小说共创编辑，请遵守：《寒雾古城》初版设定：子时钟声会改写一段记忆。');
    expect(persisted.systemPromptPlaceholders?.[0]?.value).toBe('《寒雾古城》初版设定：子时钟声会改写一段记忆。');

    // Mutate host story intro AFTER session start
    storyIntro = '《寒雾古城》改版设定：完全不同的世界观。';

    // UI renders clickable {{故事介绍}} chip inside .cf-ai-system-prompt
    const sysChip = host.querySelector<HTMLButtonElement>('.cf-ai-system-prompt .cf-ai-placeholder-chip')!;
    expect(sysChip).not.toBeNull();
    expect(sysChip.textContent?.trim()).toBe('{{故事介绍}}');

    // Clicking the chip displays the immutable snapshot captured at session start
    await act(async () => { sysChip.click(); });
    const snapshot = host.querySelector('.cf-ai-placeholder-snapshot.is-system')!;
    expect(snapshot).not.toBeNull();
    expect(snapshot.textContent).toContain('《寒雾古城》初版设定：子时钟声会改写一段记忆。');
    expect(snapshot.textContent).not.toContain('完全不同的世界观');

    // Expanding full sent system prompt shows the expanded text
    const toggleBtn = snapshot.querySelector<HTMLButtonElement>('.cf-ai-placeholder-toggle-sent')!;
    await act(async () => { toggleBtn.click(); });
    expect(snapshot.querySelector('.cf-ai-placeholder-sent-body')?.textContent).toBe(
      '你是小说共创编辑，请遵守：《寒雾古城》初版设定：子时钟声会改写一段记忆。'
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
