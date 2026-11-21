import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { BookOpen, Bot, CircleHelp, Image as ImageIcon, LayoutDashboard, MessageSquare, Monitor, Moon, Palette, RotateCcw, Sun, Trash2, Wand2 } from 'lucide-react';
import { AiAssistant, AiSettings, ConfigDecryptionError, EncryptionKeySettings, FontSettings, ImageModelSettings, ModelControls, SkillSettings, TokenUsageBar, DEFAULT_SETTINGS, availableImageModels, createBrowserAiStore, createEndpoint, createImageUpload, createKeyBackupCodec, createModel, createToolRegistry, listAvailableTools, normalizeConfig, normalizeAiFeatures, resolveSelection, selectModel, sessionUsageSummary, sumUsage, updateActiveModel, useFloatingPanel, useResolvedTheme, type AiConfig, type AiFeatures, type AssistantTheme, type ComposerController, type FloatingStore, type InsertGalleryImageInput, type PlaceholderConfig, type PlaceholderItem, type ResponsesRequestSnapshot, type StartSessionOptions } from '../src';
import { DEMO_FEATURES, forkDemoConversation, loadDemoImage, seedDemoShowcaseSession, useDemoAssistant } from './useDemoAssistant';
import DemoIntegrationSettings from './DemoIntegrationSettings';
import DemoColorMatting from './DemoColorMatting';
import DemoRequestInspector, { redactRequestSnapshot } from './DemoRequestInspector';
import DemoCapabilityLab, { DEFAULT_HARNESS_SETTINGS, type DemoHarnessSettings, type DemoPlaceholderValues } from './DemoCapabilityLab';
import DemoDocsView, { DOC_CHAPTERS } from './DemoDocsView';
import { THEME_PALETTES, buildThemeStyleVariables, getPaletteById, type PaletteId } from './palettes';
import './demo.css';

const floatingStorageKey = 'sang-ai-kit-demo-window';
const floatingStore: FloatingStore = {
  async loadUiState() { try { return JSON.parse(localStorage.getItem(floatingStorageKey) || '{}'); } catch { return {}; } },
  async saveUiState(value) { localStorage.setItem(floatingStorageKey, JSON.stringify(value)); }
};

const defaults = { ...DEFAULT_SETTINGS, quickSnippets: ['整理当前思路', '生成一份提纲', '总结关键内容', '给我一些建议'] };
function initialConfig(): AiConfig {
  const demo = createEndpoint('custom');
  Object.assign(demo, { id: 'local-demo', name: '本地演示', endpoint: 'https://demo.invalid/v1', apiKey: '' });
  Object.assign(demo.models[0], { label: '本地演示', modelId: 'demo' });
  const openai = createEndpoint('openai');
  return { endpoints: [demo, openai], imageModels: [], activeSelection: { endpointId: demo.id, modelId: demo.models[0].id }, systemPrompt: defaults.systemPrompt, quickSnippets: [...defaults.quickSnippets], skills: [] };
}

const configStore = createBrowserAiStore({ databaseName: 'sang-ai-kit-demo-config-v1', defaultConfig: initialConfig, normalizeConfig });
const keyBackup = createKeyBackupCodec({ format: 'sang-ai-kit-encryption-key', context: 'SangAIKit encryption key backup v1' });
const integrationStorageKey = 'sang-ai-kit-demo-integration-v1';
const paletteStorageKey = 'sang-ai-kit-demo-palette-v1';
const harnessStorageKey = 'sang-ai-kit-demo-harness-v1';

function initialFeatures(): AiFeatures {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(integrationStorageKey) || 'null');
    return saved ? normalizeAiFeatures(saved) : { ...DEMO_FEATURES };
  } catch { return { ...DEMO_FEATURES }; }
}

function initialPaletteState(): { paletteId: PaletteId; theme: AssistantTheme; customAccent: string | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(paletteStorageKey) || 'null') as {
      paletteId?: PaletteId;
      theme?: AssistantTheme;
      customAccent?: string | null;
    } | null;
    const validPalette = THEME_PALETTES.some(p => p.id === raw?.paletteId) ? raw!.paletteId! : 'default';
    const validTheme = raw?.theme === 'light' || raw?.theme === 'dark' || raw?.theme === 'system' ? raw.theme : 'dark';
    const validCustom = typeof raw?.customAccent === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.customAccent) ? raw.customAccent : null;
    return { paletteId: validPalette, theme: validTheme, customAccent: validCustom };
  } catch {
    return { paletteId: 'default', theme: 'dark', customAccent: null };
  }
}

function initialHarnessState(): DemoHarnessSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(harnessStorageKey) || 'null') as Partial<DemoHarnessSettings> | null;
    if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_HARNESS_SETTINGS);
    return {
      ...DEFAULT_HARNESS_SETTINGS,
      ...raw,
      simulation: {
        ...DEFAULT_HARNESS_SETTINGS.simulation,
        ...(raw.simulation || {})
      }
    };
  } catch {
    return structuredClone(DEFAULT_HARNESS_SETTINGS);
  }
}

async function saveBackup(content: string): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'sang-ai-kit-encryption-key.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

interface InsertedCanvasAsset extends InsertGalleryImageInput {
  insertedAt: number;
}

const DEFAULT_DEMO_PLACEHOLDERS: DemoPlaceholderValues = {
  '故事介绍': '《寒雾古城》：一座被终年冷雾封锁的边陲古城，每逢子时钟声响起，城中便会有一段记忆被悄然改写。',
  '卷纲': '第一卷·寒雾初起：外乡修表匠张三踏入古城寻找失踪兄长，在当铺中发现一块逆时针走动的古镜怀表，卷入巡城司与暗阁的博弈。',
  '角色:张三': '张三（男，26岁）：沉默敏锐的修表匠，擅长从微小机械磨损推断时间线；随身携带兄长留下的半枚铜钥匙，性格冷静但极度护短。',
  '角色:李四': '李四（女，24岁）：古城典当行掌柜，表面圆滑爱财，实为暗阁前任记录官，掌握着古城近十年的记忆失窃卷宗。'
};

const DEMO_PLACEHOLDER_ITEMS: PlaceholderItem[] = [
  { key: '故事介绍', label: '故事介绍', group: '设定', description: '当前小说作品的世界观与核心设定' },
  { key: '卷纲', label: '当前卷纲', group: '大纲', description: '当前分卷的主线脉络与冲突节点' },
  { key: '角色:张三', label: '角色：张三', group: '角色', description: '主角张三的人物档案与性格设定' },
  { key: '角色:李四', label: '角色：李四', group: '角色', description: '重要角色李四的人物档案与秘密' }
];

const DEMO_COMPOSER_QUICK_PROMPTS = [
  { label: '开篇冲突构思', text: '请结合{{故事介绍}}与{{卷纲}}，围绕{{角色:张三}}设计一个充满悬念的开篇场景。' },
  { label: '双角色对手戏', text: '写一段{{角色:张三}}与{{角色:李四}}在当铺初遇的试探性对话，埋下怀表伏笔。' },
  { label: '设定一致性核查', text: '请检查当前草稿是否与{{故事介绍}}及{{角色:张三}}的人物动机存在矛盾。' }
];

function Demo() {
  const initialVisual = useRef(initialPaletteState()).current;
  const [activeView, setActiveView] = useState<'workspace' | 'docs'>('workspace');
  const [activeDocChapter, setActiveDocChapter] = useState<string>(DOC_CHAPTERS[0]?.id || '01-overview');
  const [theme, setTheme] = useState<AssistantTheme>(initialVisual.theme);
  const [paletteId, setPaletteId] = useState<PaletteId>(initialVisual.paletteId);
  const [customAccent, setCustomAccent] = useState<string | null>(initialVisual.customAccent);
  const [open, setOpen] = useState(true);
  const [features, setFeatures] = useState(initialFeatures);
  const [harness, setHarness] = useState<DemoHarnessSettings>(initialHarnessState);
  const [windowSeed, setWindowSeed] = useState(0);
  const [insertedAssets, setInsertedAssets] = useState<InsertedCanvasAsset[]>([]);
  const [lastRequest, setLastRequest] = useState<ReturnType<typeof redactRequestSnapshot> | null>(null);
  const [config, setConfig] = useState(initialConfig);
  const configRef = useRef(config);
  configRef.current = config;
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [keyError, setKeyError] = useState(false);
  const [placeholderValues, setPlaceholderValues] = useState<DemoPlaceholderValues>(DEFAULT_DEMO_PLACEHOLDERS);
  const placeholderValuesRef = useRef(placeholderValues);
  placeholderValuesRef.current = placeholderValues;
  const composerRef = useRef<ComposerController | null>(null);

  const hostToolRegistry = useMemo(() => {
    const registry = createToolRegistry();
    registry.registerMany([
      {
        name: 'read_workspace',
        label: { zh: '读取工作区画布', en: 'Read workspace canvas' },
        group: { zh: '编辑工具', en: 'Editing Tools' },
        uiDescription: { zh: '读取当前编辑中的章节正文与画布状态', en: 'Read the active chapter content and workspace state' },
        description: 'Return JSON metadata of the current workspace canvas and active chapter document for LLM context.',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ name: '演示工作区', activeDocument: '寒雾古城 · 第一章' })
      },
      {
        name: 'read_chapter_content',
        label: { zh: '读取指定章节', en: 'Read chapter content' },
        group: { zh: '编辑工具', en: 'Editing Tools' },
        uiDescription: { zh: '读取指定章节内容', en: 'Read the text of a specified chapter' },
        description: 'Fetch raw chapter text by chapterNumber (1-based integer) from the host manuscript store.',
        parameters: {
          type: 'object',
          properties: { chapterNumber: { type: 'number', description: '章节编号，例如 1' } },
          required: ['chapterNumber']
        },
        execute: async args => ({
          chapterNumber: Number(args.chapterNumber) || 1,
          title: '第一章·寒雾入城',
          excerpt: '子时的雾气沿着青石巷口漫进来，张三停在典当行门前，听见柜台后传来怀表逆行的轻响。'
        })
      },
      {
        name: 'query_novel_outline',
        label: { zh: '查询小说卷纲', en: 'Query novel outline' },
        group: { zh: '设定与大纲', en: 'Lore & Outline' },
        uiDescription: { zh: '查看当前小说分卷大纲与剧情节点', en: 'View the current volume outline and story beats' },
        description: 'Retrieve structured volume outline JSON for the given volume name from the host novel database.',
        parameters: {
          type: 'object',
          properties: { volume: { type: 'string', description: '分卷名称' } }
        },
        execute: async () => ({ outline: placeholderValuesRef.current['卷纲'] })
      },
      {
        name: 'query_character_sheet',
        label: { zh: '读取角色设定卡', en: 'Query character sheet' },
        group: { zh: '设定与大纲', en: 'Lore & Outline' },
        uiDescription: { zh: '查看指定角色的背景、性格与人物关系', en: 'Inspect character background, traits, and relationships' },
        description: 'Query character sheet record by exact character name (e.g. 张三 or 李四).',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string', description: '角色名，如 张三 或 李四' } },
          required: ['name']
        },
        execute: async args => {
          const name = typeof args.name === 'string' ? args.name.trim() : '';
          const key = `角色:${name}` as keyof DemoPlaceholderValues;
          return { name, profile: placeholderValuesRef.current[key] || '未找到该角色设定。' };
        }
      }
    ]);
    return registry;
  }, []);

  const hostTools = useMemo(() => hostToolRegistry.list(), [hostToolRegistry]);

  const availableTools = useMemo(
    () =>
      listAvailableTools({
        config,
        features,
        hostTools,
        builtInOverrides: {
          skill: {
            group: { zh: '创作规范', en: 'Writing Guides' },
            uiDescription: { zh: '读取项目中预设的文风、设定与写作规范', en: 'Read project writing style guides and conventions' }
          },
          list_fonts: {
            group: { zh: '排版工具', en: 'Typography' },
            uiDescription: { zh: '查看当前可用的中英文字体列表', en: 'Browse available fonts for layout and typesetting' }
          },
          remove_background: {
            group: { zh: '视觉与插画', en: 'Visual & Illustration' },
            uiDescription: { zh: '为角色立绘或插图自动去除背景', en: 'Automatically remove background from character art' }
          },
          list_image_models: {
            group: { zh: '视觉与插画', en: 'Visual & Illustration' }
          },
          generate_image: {
            group: { zh: '视觉与插画', en: 'Visual & Illustration' },
            uiDescription: { zh: '根据剧情描述生成场景插画或封面图', en: 'Generate scene illustrations or cover art' }
          }
        }
      }),
    [config, features, hostTools]
  );

  const placeholderConfig = useMemo<PlaceholderConfig>(
    () => ({
      enabled: features.placeholders,
      items: DEMO_PLACEHOLDER_ITEMS,
      resolve: key => placeholderValuesRef.current[key as keyof DemoPlaceholderValues]
    }),
    [features.placeholders]
  );

  const resolvedTheme = useResolvedTheme(theme);
  const activePalette = getPaletteById(paletteId);
  const effectiveAccent = customAccent || activePalette[resolvedTheme].aiAccent;
  const themeStyleVars = buildThemeStyleVariables(activePalette, resolvedTheme, customAccent);

  useEffect(() => {
    const rootEl = document.documentElement;
    rootEl.dataset.theme = resolvedTheme;
    rootEl.dataset.palette = paletteId;
    const entries = Object.entries(themeStyleVars) as [string, string][];
    for (const [key, val] of entries) {
      if (key.startsWith('--')) rootEl.style.setProperty(key, String(val));
    }
  }, [resolvedTheme, paletteId, themeStyleVars]);

  useEffect(() => {
    try {
      localStorage.setItem(paletteStorageKey, JSON.stringify({ paletteId, theme, customAccent }));
    } catch {
      /* Keep current visual selection in memory */
    }
  }, [paletteId, theme, customAccent]);

  useEffect(() => {
    try {
      localStorage.setItem(harnessStorageKey, JSON.stringify(harness));
    } catch {
      /* Keep current harness settings in memory */
    }
  }, [harness]);

  const selectPalette = (nextId: PaletteId) => {
    setPaletteId(nextId);
    setCustomAccent(null);
  };

  const baseAssistant = useDemoAssistant(
    config,
    features,
    (request: ResponsesRequestSnapshot) => setLastRequest(redactRequestSnapshot(request)),
    harness.simulation,
    { hostTools, placeholders: placeholderConfig }
  );

  const reloadConfig = async () => {
    setConfigLoading(true);
    setConfigError('');
    try { setConfig(await configStore.loadConfig()); setKeyError(false); }
    catch (error) {
      if (error instanceof ConfigDecryptionError) { setConfig(error.config); setKeyError(true); }
      else setConfigError(error instanceof Error ? error.message : 'Unable to load settings.');
    } finally { setConfigLoading(false); }
  };
  useEffect(() => { void reloadConfig(); }, []);

  const handleInsertGalleryImage = async (item: InsertGalleryImageInput) => {
    setInsertedAssets(prev => [{ ...item, insertedAt: Date.now() }, ...prev.slice(0, 5)]);
    setActiveView('workspace');
  };

  const assistant = {
    ...baseAssistant,
    loading: baseAssistant.loading || configLoading,
    loadError: baseAssistant.loadError || configError,
    keyError,
    reloadConfig,
    insertImage: harness.enableGalleryInsert ? handleInsertGalleryImage : undefined
  };

  const activeFloatingStore = useMemo<FloatingStore>(
    () => ({
      loadUiState: () => floatingStore.loadUiState(),
      saveUiState: value => floatingStore.saveUiState(value)
    }),
    [windowSeed]
  );

  const floating = useFloatingPanel(activeFloatingStore);
  const active = resolveSelection(config);
  const configure = async (value: AiConfig) => { const normalized = normalizeConfig(value); configRef.current = normalized; setConfig(normalized); await configStore.saveConfig(normalized); };
  const updateFeatures = (value: AiFeatures) => {
    setFeatures(value);
    try { localStorage.setItem(integrationStorageKey, JSON.stringify(value)); } catch { /* Keep this demo setting for the current page load. */ }
  };
  const updateLimit = (key: 'maxToolRounds' | 'maxImageFailures', value: number) => {
    void configure({ ...configRef.current, [key]: value }).catch(error => setConfigError(error instanceof Error ? error.message : 'Unable to save settings.'));
  };
  const resetIntegration = () => {
    updateFeatures({ ...DEMO_FEATURES });
    void configure({ ...configRef.current, maxToolRounds: DEFAULT_SETTINGS.maxToolRounds, maxImageFailures: DEFAULT_SETTINGS.maxImageFailures })
      .catch(error => setConfigError(error instanceof Error ? error.message : 'Unable to save settings.'));
  };

  const applyWindowPreset = (preset: 'default' | 'compact' | 'wide' | 'center') => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const presets = {
      default: { width: 410, height: 640, x: Math.max(20, vw - 434), y: 24 },
      compact: { width: 360, height: 500, x: Math.max(20, vw - 384), y: 24 },
      wide: { width: 560, height: 720, x: Math.max(20, vw - 584), y: 20 },
      center: { width: 480, height: 640, x: Math.max(20, Math.round((vw - 480) / 2)), y: Math.max(20, Math.round((vh - 640) / 2)) }
    };
    try {
      localStorage.setItem(floatingStorageKey, JSON.stringify({ floatingRect: presets[preset] }));
    } catch {
      /* Ignore storage error */
    }
    setOpen(true);
    floating.setMinimized(false);
    setWindowSeed(prev => prev + 1);
  };

  const handleSeedShowcase = async () => {
    await seedDemoShowcaseSession(baseAssistant.reloadConfig, {
      markLastContinuable: harness.simulation.simulateContinuable
    });
    setOpen(true);
    floating.setMinimized(false);
  };

  const handleTriggerMinimizedTicker = async () => {
    setOpen(true);
    floating.setMinimized(true);
    await assistant.send('演示最小化状态下的实时工具与文本轮播');
  };

  const activeSession = assistant.sessions.find(session => session.id === assistant.activeSessionId);
  const activeSessionTools = useMemo(() => {
    if (activeSession?.enabledTools !== undefined) return activeSession.enabledTools;
    return availableTools.map(tool => tool.name);
  }, [activeSession?.enabledTools, availableTools]);

  const handleStartHostSession = async (options: StartSessionOptions) => {
    setOpen(true);
    floating.setMinimized(false);
    await assistant.newSession(options);
  };

  const handleUpdateSessionTools = async (toolNames: string[]) => {
    await assistant.setSessionTools?.(toolNames);
  };

  const handleInjectComposerExample = () => {
    setOpen(true);
    floating.setMinimized(false);
    window.setTimeout(() => {
      composerRef.current?.setValue('请根据{{故事介绍}}与{{角色:张三}}的动机，续写{{角色:李四}}在当铺亮出古镜怀表的一幕。');
      composerRef.current?.focus();
    }, 30);
  };

  return <main className="demo-shell" data-theme={resolvedTheme} data-palette={paletteId} style={themeStyleVars}>
    <aside className="demo-rail" aria-label="主导航">
      <div className="demo-logo">S</div>
      <button
        type="button"
        className={activeView === 'workspace' ? 'active' : ''}
        title="工作区与能力实验室"
        aria-label="工作区"
        aria-current={activeView === 'workspace' ? 'page' : undefined}
        onClick={() => setActiveView('workspace')}
      >
        <LayoutDashboard size={20} />
      </button>
      <button
        type="button"
        className={open ? 'active' : ''}
        title="打开 AI 助手"
        aria-label="打开 AI 助手"
        onClick={() => {
          setOpen(true);
          floating.setMinimized(false);
        }}
      >
        <MessageSquare size={20} />
      </button>
      <button
        type="button"
        className={activeView === 'docs' ? 'active' : ''}
        title="帮助与接入文档 (docs)"
        aria-label="帮助"
        aria-current={activeView === 'docs' ? 'page' : undefined}
        onClick={() => setActiveView('docs')}
      >
        <CircleHelp size={20} />
      </button>
    </aside>

    <div className="demo-workspace">
      <header className="demo-topbar">
        <div className="demo-topbar-left">
          <strong>SangAIKit</strong>
          <span>/</span>
          <div className="demo-view-switcher" role=" navigation" aria-label="视图切换">
            <button
              type="button"
              className={`demo-view-tab ${activeView === 'workspace' ? 'active' : ''}`}
              onClick={() => setActiveView('workspace')}
            >
              <LayoutDashboard size={13} />
              <span>能力演示台</span>
            </button>
            <button
              type="button"
              className={`demo-view-tab ${activeView === 'docs' ? 'active' : ''}`}
              onClick={() => setActiveView('docs')}
            >
              <BookOpen size={13} />
              <span>帮助文档 ({DOC_CHAPTERS.length})</span>
            </button>
          </div>
        </div>

        <div className="demo-actions">
          <div className="demo-palette-pills" role="group" aria-label="快速配色方案">
            {THEME_PALETTES.map(preset => (
              <button
                key={preset.id}
                type="button"
                className="demo-palette-dot"
                aria-pressed={paletteId === preset.id && !customAccent}
                title={`${preset.name}（${preset.badge}）`}
                onClick={() => selectPalette(preset.id)}
              >
                <span className="demo-palette-swatch" style={{ background: preset[resolvedTheme].aiAccent }} />
                <span>{preset.name}</span>
              </button>
            ))}
          </div>
          <label className="demo-color" title="自定义强调色"><input type="color" aria-label="强调色" value={effectiveAccent} onChange={event => setCustomAccent(event.target.value)} /></label>
          <div className="demo-themes" role="group" aria-label="主题">{([['light', '浅色', Sun], ['dark', '深色', Moon], ['system', '跟随系统', Monitor]] as const).map(([value, label, Icon]) => <button key={value} type="button" title={label} aria-label={label} aria-pressed={theme === value} onClick={() => setTheme(value)}><Icon size={16} /></button>)}</div>
          <button className="demo-open" onClick={() => { setOpen(true); floating.setMinimized(false); }}><Bot size={16} /> AI 助手</button>
        </div>
      </header>

      <div className="demo-content">
        {activeView === 'docs' ? (
          <DemoDocsView
            activeChapterId={activeDocChapter}
            onSelectChapter={setActiveDocChapter}
            onBackToWorkspace={() => setActiveView('workspace')}
          />
        ) : (
          <>
            <div className="demo-content-heading">
              <div>
                <span className="demo-eyebrow">WORKSPACE / INTERACTIVE CAPABILITY SHOWCASE</span>
                <h1>工作区与组件能力演示台</h1>
              </div>
              <div className="demo-heading-right">
                <span className="demo-live"><i /> {active.model.label} · {resolvedTheme === 'dark' ? '深色模式' : '浅色模式'} · {harness.language === 'en' ? 'EN' : 'ZH'}</span>
                <button
                  type="button"
                  className="demo-reset"
                  onClick={() => setActiveView('docs')}
                  title="查看 docs 目录下的分章节帮助文档"
                >
                  <BookOpen size={13} /> 查看帮助文档 ({DOC_CHAPTERS.length} 章)
                </button>
              </div>
            </div>

            <section className="demo-theme-studio" aria-label="主题色彩方案">
              <div className="demo-theme-studio-header">
                <div className="demo-theme-studio-title">
                  <div>
                    <span className="demo-section-kicker">COLOR SYSTEM & PALETTES</span>
                    <h2>多套色彩切换（含原项目提取配色）</h2>
                  </div>
                </div>
                <div className="demo-theme-studio-meta">
                  <Palette size={14} />
                  <span>当前：{activePalette.name}{customAccent ? ` · 自定义 (${customAccent})` : ` · ${activePalette.badge}`}</span>
                  {(paletteId !== 'default' || customAccent !== null) && (
                    <button type="button" className="demo-reset" onClick={() => selectPalette('default')} title="恢复默认曜石靛蓝配色">
                      <RotateCcw size={12} /> 恢复默认配色
                    </button>
                  )}
                </div>
              </div>
              <div className="demo-theme-grid">
                {THEME_PALETTES.map(preset => {
                  const isSelected = paletteId === preset.id && !customAccent;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className="demo-theme-card"
                      aria-pressed={isSelected}
                      onClick={() => selectPalette(preset.id)}
                    >
                      <div className="demo-theme-card-top">
                        <span className="demo-theme-card-name">
                          {preset.name}
                          <span className="demo-theme-card-tag">{preset.badge}</span>
                        </span>
                        <span className="demo-theme-swatches" aria-hidden="true">
                          <i style={{ background: preset.swatches[0] }} />
                          <i style={{ background: preset.swatches[1] }} />
                          <i style={{ background: preset.swatches[2] }} />
                        </span>
                      </div>
                      <small>{preset.description}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 全量组件能力与 Props 实验室 */}
            <DemoCapabilityLab
              settings={harness}
              onChange={setHarness}
              onReset={() => setHarness(structuredClone(DEFAULT_HARNESS_SETTINGS))}
              panelOpen={open}
              onOpenChange={setOpen}
              minimized={floating.minimized}
              onMinimizedChange={floating.setMinimized}
              onApplyWindowPreset={applyWindowPreset}
              onSeedShowcaseSession={handleSeedShowcase}
              onTriggerMinimizedTickerDemo={handleTriggerMinimizedTicker}
              assistantBusy={assistant.busy}
              availableTools={availableTools}
              activeSessionTools={activeSessionTools}
              onStartHostSession={handleStartHostSession}
              onUpdateSessionTools={handleUpdateSessionTools}
              placeholderValues={placeholderValues}
              onPlaceholderValuesChange={setPlaceholderValues}
              placeholdersEnabled={features.placeholders}
              onInjectComposerExample={handleInjectComposerExample}
            />

            {/* 宿主功能开关与轮次限制配置 */}
            <DemoIntegrationSettings
              features={features}
              onFeaturesChange={updateFeatures}
              maxToolRounds={config.maxToolRounds ?? DEFAULT_SETTINGS.maxToolRounds}
              maxImageFailures={config.maxImageFailures ?? DEFAULT_SETTINGS.maxImageFailures}
              onLimitChange={updateLimit}
              validImageModelCount={availableImageModels(config).length}
              skillCount={config.skills?.length ?? 0}
              hostToolNames={hostTools.map(tool => tool.name)}
              onReset={resetIntegration}
            />

            {features.backgroundRemoval && <DemoColorMatting />}

            {/* 工作区文档画布（支持接收从 AI 助手图片画廊置入的图片资产） */}
            <div className="demo-document">
              <div className="demo-document-top">
                <span>项目画布 · {harness.contextTitle || '演示工作区'}</span>
                <span>{harness.contextMeta || '01 / 03'}</span>
              </div>
              <h2>从想法开始，全链路协同</h2>
              <p>
                在工作区中实时调试 <code>SangAIKit</code> 的主题色盘、宿主功能开关、插槽扩展与工具链。你也可以点击下方按钮一键生成示例对话，或在「历史对话 → 图片画廊」中将 AI 生成图片直接置入此画布。
              </p>
              <div className="demo-document-quick">
                <button
                  type="button"
                  className="demo-lab-action-chip"
                  disabled={assistant.busy}
                  onClick={() => void handleSeedShowcase()}
                >
                  <Wand2 size={13} />
                  <span>一键注入含画廊图片的示例对话</span>
                </button>
                <button
                  type="button"
                  className="demo-lab-action-chip"
                  onClick={() => setActiveView('docs')}
                >
                  <BookOpen size={13} />
                  <span>打开帮助文档中心</span>
                </button>
              </div>
              <div className="demo-rule" />

              {insertedAssets.length > 0 ? (
                <div className="demo-inserted-gallery" aria-label="已置入画布的图片资产">
                  <div className="demo-inserted-header">
                    <strong>已从 AI 画廊置入画布的视觉资产 ({insertedAssets.length})</strong>
                    <button
                      type="button"
                      className="demo-reset"
                      onClick={() => setInsertedAssets([])}
                    >
                      <Trash2 size={12} /> 清空画布资产
                    </button>
                  </div>
                  <div className="demo-inserted-grid">
                    {insertedAssets.map(asset => (
                      <div key={`${asset.sessionId}:${asset.imageId}:${asset.insertedAt}`} className="demo-inserted-card">
                        <div className="demo-inserted-card-top">
                          <ImageIcon size={14} />
                          <strong>{asset.name}</strong>
                          <span className="demo-inserted-category">{asset.category}</span>
                        </div>
                        {asset.prompt && <p>Prompt: {asset.prompt}</p>}
                        <small>会话 ID: {asset.sessionId} · 图像 ID: {asset.imageId}</small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="demo-lines"><span /><span /><span /></div>
              )}
            </div>

            <DemoRequestInspector request={lastRequest} />
          </>
        )}
      </div>
    </div>

    <AiAssistant
      assistant={assistant}
      floating={floating}
      language={harness.language}
      theme={theme}
      open={open}
      onOpenChange={setOpen}
      title={harness.title || 'AI 助手'}
      emptyTitle={harness.emptyTitle || '智能助手已就绪'}
      emptyDescription={harness.emptyDescription || '与助手交流想法，探索工作区中的内容。'}
      contextTitle={harness.showContextBar ? harness.contextTitle : undefined}
      contextMeta={harness.showContextBar ? harness.contextMeta : undefined}
      imageInsertAction={
        harness.enableGalleryInsert
          ? {
              visible: true,
              enabled: harness.galleryInsertEnabled,
              label: harness.insertLabel || (harness.language === 'en' ? 'Insert to Canvas' : '置入工作区'),
              successLabel: harness.insertSuccessLabel || (harness.language === 'en' ? 'Inserted' : '已置入画布'),
              disabledReason: harness.insertDisabledReason,
              isVisible: item => (harness.galleryInsertAllowPreview ? true : item.category !== 'preview')
            }
          : { visible: false }
      }
      classifyGalleryImage={(image, tools) => {
        if (tools.some(t => t.name === 'render_canvas_preview' && t.image?.id === image.id)) return 'preview';
        return undefined;
      }}
      quickSnippets={config.quickSnippets ?? []}
      features={features}
      onFork={harness.enableFork ? event => forkDemoConversation(assistant, event, baseAssistant.reloadConfig) : undefined}
      active={{
        model: active.endpoint.id === 'local-demo' ? { ...active.model, supportsVision: harness.demoSupportsVision } : active.model
      }}
      imageToolsEnabled={features.imageGeneration && (availableImageModels(config).length > 0 || harness.simulation.simulateImageGeneration)}
      maxImageAttachments={features.imageGeneration ? Math.max(4, ...availableImageModels(config).map(model => model.maxReferenceImages ?? 1)) : 4}
      toolLabels={{
        demo_context: ['读取工作区上下文', 'Read workspace context'],
        read_workspace: ['读取工作区画布', 'Read workspace canvas'],
        read_chapter_content: ['读取指定章节', 'Read chapter content'],
        query_novel_outline: ['查询小说卷纲', 'Query novel outline'],
        query_character_sheet: ['读取角色设定卡', 'Query character sheet'],
        render_canvas_preview: ['生成版式过程预览', 'Render layout preview'],
        skill: ['读取 SKILL 规则', 'Read skill'],
        list_fonts: ['查询字体目录', 'List fonts'],
        generate_image: ['生成视觉图像', 'Generate image']
      }}
      availableTools={availableTools}
      showHeaderToolPicker={harness.showHeaderToolPicker ? undefined : false}
      composerRef={composerRef}
      renderComposerToolbar={
        harness.showComposerToolbar
          ? composer => (
              <>
                <select
                  aria-label={composer.language === 'en' ? 'Quick prompt template' : '快捷提示词下拉框'}
                  defaultValue=""
                  disabled={composer.disabled}
                  onChange={event => {
                    const selected = event.target.value;
                    if (!selected) return;
                    composer.setValue(selected);
                    composer.focus();
                    event.target.value = '';
                  }}
                >
                  <option value="">{composer.language === 'en' ? 'Quick Prompts...' : '快捷提示词…'}</option>
                  {DEMO_COMPOSER_QUICK_PROMPTS.map(item => (
                    <option key={item.label} value={item.text}>{item.label}</option>
                  ))}
                </select>
                {features.placeholders && (
                  <select
                    aria-label={composer.language === 'en' ? 'Insert placeholder' : '插入占位符'}
                    defaultValue=""
                    disabled={composer.disabled}
                    onChange={event => {
                      const key = event.target.value;
                      if (!key) return;
                      composer.insertPlaceholder(key);
                      event.target.value = '';
                    }}
                  >
                    <option value="">{composer.language === 'en' ? '{{ Placeholder }}...' : '{{ 占位符 }}…'}</option>
                    {DEMO_PLACEHOLDER_ITEMS.map(item => (
                      <option key={item.key} value={item.key}>{`{{${item.key}}}`}</option>
                    ))}
                  </select>
                )}
                {composer.value.trim().length > 0 && (
                  <button
                    type="button"
                    disabled={composer.disabled}
                    onClick={() => composer.clear()}
                  >
                    {composer.language === 'en' ? 'Clear' : '清空'}
                  </button>
                )}
              </>
            )
          : undefined
      }
      loadImage={loadDemoImage}
      createImageUpload={createImageUpload}
      imageModelForTool={tool => {
        try {
          const args: unknown = JSON.parse(tool.arguments);
          return args && typeof args === 'object' && 'modelConfigId' in args
            ? config.imageModels?.find(model => model.id === args.modelConfigId)
            : undefined;
        } catch {
          return undefined;
        }
      }}
      sumUsage={sumUsage}
      renderMarkdown={content => <div className="cf-ai-markdown" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(content, { async: false }) as string) }} />}
      renderUsage={(prompt, english) =>
        harness.showUsageBar ? (
          <TokenUsageBar
            usage={sessionUsageSummary(assistant.sessions.find(session => session.id === assistant.activeSessionId), active.model, active.endpoint.endpoint, config.systemPrompt, prompt)}
            model={active.model}
            busy={assistant.busy}
            english={english}
          />
        ) : null
      }
      renderModelControls={(disabled, english) =>
        harness.showModelControls ? (
          <ModelControls
            config={config}
            configure={configure}
            resolveSelection={resolveSelection}
            selectModel={selectModel}
            updateActiveModel={updateActiveModel}
            disabled={disabled}
            english={english}
          />
        ) : null
      }
      renderSettings={(close, initialSecurity) => (
        <AiSettings
          config={config}
          features={features}
          onSave={configure}
          onBack={close}
          english={harness.language === 'en'}
          theme={theme}
          store={harness.enableEncryptionSlot ? configStore : { loadConfig: configStore.loadConfig }}
          onKeyChanged={reloadConfig}
          initialSecurity={initialSecurity}
          createEndpoint={createEndpoint}
          createModel={createModel}
          normalizeConfig={normalizeConfig}
          resolveSelection={resolveSelection}
          defaults={defaults}
          showTurnLimits={harness.showTurnLimits}
          supportsVision={active.endpoint.id === 'local-demo' ? harness.demoSupportsVision : active.model.supportsVision}
          renderImageModels={(draft, onChange, english) => <ImageModelSettings config={draft} onChange={onChange} english={english} />}
          renderSkills={(skills, onChange, english) => <SkillSettings skills={skills} onChange={onChange} english={english} />}
          renderFonts={(fonts, onChange, english, enabled) => (
            <FontSettings
              fonts={fonts}
              onChange={onChange}
              english={english}
              loadGooglePreviews={harness.loadGooglePreviews}
              showLocalFonts={enabled.localFonts}
              showOnlineFonts={enabled.onlineFonts}
            />
          )}
          renderEncryption={
            harness.enableEncryptionSlot
              ? (manager, callbacks, english) => (
                  <EncryptionKeySettings
                    manager={manager}
                    english={english}
                    {...callbacks}
                    {...keyBackup}
                    saveBackup={saveBackup}
                    isDecryptionError={error => error instanceof ConfigDecryptionError}
                  />
                )
              : undefined
          }
          notice={
            harness.showSecurityNotice ? (
              <p className="sang-ai-security-notice text-xs text-amber-300">
                API Key 在本机加密存储，但浏览器脚本仍可能读取解密后的密钥。真实请求可能产生费用；生产环境建议使用后端代理。
              </p>
            ) : undefined
          }
        />
      )}
    />
  </main>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<Demo />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());