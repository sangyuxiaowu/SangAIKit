import { useState } from 'react';
import {
  Bot,
  Braces,
  Image as ImageIcon,
  Languages,
  Maximize2,
  Minimize2,
  Play,
  Rocket,
  RotateCcw,
  Sliders,
  Sparkles,
  Wand2,
  Wrench
} from 'lucide-react';
import { resolveToolGroup, resolveToolLabel, resolveToolUiDescription, type StartSessionOptions, type ToolDescriptor } from '../src';
import type { DemoSimulationOptions } from './useDemoAssistant';
import { DEFAULT_SIMULATION_OPTIONS } from './useDemoAssistant';

export interface DemoHarnessSettings {
  language: 'zh' | 'en';
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  showContextBar: boolean;
  contextTitle: string;
  contextMeta: string;
  enableFork: boolean;
  demoSupportsVision: boolean;
  showUsageBar: boolean;
  showModelControls: boolean;
  showComposerToolbar: boolean;
  showHeaderToolPicker: boolean;
  enableEncryptionSlot: boolean;
  showTurnLimits: boolean;
  showSecurityNotice: boolean;
  loadGooglePreviews: boolean;
  enableGalleryInsert: boolean;
  galleryInsertEnabled: boolean;
  galleryInsertAllowPreview: boolean;
  insertLabel: string;
  insertSuccessLabel: string;
  insertDisabledReason: string;
  simulation: DemoSimulationOptions;
}

export const DEFAULT_HARNESS_SETTINGS: Readonly<DemoHarnessSettings> = {
  language: 'zh',
  title: 'AI 助手',
  emptyTitle: '智能助手已就绪',
  emptyDescription: '与助手交流想法，探索工作区中的内容。',
  showContextBar: true,
  contextTitle: '演示工作区 · 主画布',
  contextMeta: '1920×1080 · 3 个活动图层',
  enableFork: true,
  demoSupportsVision: true,
  showUsageBar: true,
  showModelControls: true,
  showComposerToolbar: true,
  showHeaderToolPicker: true,
  enableEncryptionSlot: true,
  showTurnLimits: true,
  showSecurityNotice: true,
  loadGooglePreviews: false,
  enableGalleryInsert: true,
  galleryInsertEnabled: true,
  galleryInsertAllowPreview: true,
  insertLabel: '置入工作区',
  insertSuccessLabel: '已置入画布',
  insertDisabledReason: '当前工作区画布已锁定，请先在实验室中解锁置入权限',
  simulation: {
    ...DEFAULT_SIMULATION_OPTIONS,
    simulateReasoning: true,
    simulateMultiTools: true,
    simulateImageGeneration: false,
    simulateTokenUsage: true,
    simulateContinuable: false
  }
};

export const PERSONA_PRESETS: Array<{
  id: string;
  badge: string;
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  contextTitle: string;
  contextMeta: string;
}> = [
  {
    id: 'workspace',
    badge: '默认通用',
    title: 'AI 助手',
    emptyTitle: '智能助手已就绪',
    emptyDescription: '与助手交流想法，探索工作区中的内容。',
    contextTitle: '演示工作区 · 主画布',
    contextMeta: '1920×1080 · 3 个活动图层'
  },
  {
    id: 'design',
    badge: '视觉海报',
    title: '视觉设计助手',
    emptyTitle: '主视觉创意工作台',
    emptyDescription: '支持读取本地字体、调用 SKILL 视觉规范并生成高清海报素材。',
    contextTitle: '春季发布会 KV 画布',
    contextMeta: '1024×1024 · RGB / 300 DPI'
  },
  {
    id: 'code',
    badge: '研发审计',
    title: '架构与代码助手',
    emptyTitle: '代码审查与重构就绪',
    emptyDescription: '分析模块边界、检查类型契约并生成可验证的重构方案。',
    contextTitle: 'src/AiAssistant.tsx',
    contextMeta: 'TypeScript 7 · React 19'
  },
  {
    id: 'english',
    badge: 'English UI',
    title: 'Studio Copilot',
    emptyTitle: 'Copilot Ready',
    emptyDescription: 'Collaborate on layouts, typography, skills, and visual assets.',
    contextTitle: 'Demo Canvas · Artboard 01',
    contextMeta: '1920×1080 · 3 active layers'
  }
];

export interface DemoPlaceholderValues {
  '故事介绍': string;
  '卷纲': string;
  '角色:张三': string;
  '角色:李四': string;
}

interface DemoCapabilityLabProps {
  settings: DemoHarnessSettings;
  onChange: (next: DemoHarnessSettings) => void;
  onReset: () => void;
  panelOpen: boolean;
  onOpenChange: (open: boolean) => void;
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
  onApplyWindowPreset: (preset: 'default' | 'compact' | 'wide' | 'center') => void;
  onSeedShowcaseSession: () => Promise<void>;
  onTriggerMinimizedTickerDemo: () => Promise<void>;
  assistantBusy: boolean;
  availableTools: ToolDescriptor[];
  activeSessionTools: string[];
  onStartHostSession: (options: StartSessionOptions) => Promise<void>;
  onUpdateSessionTools: (toolNames: string[]) => Promise<void>;
  placeholderValues: DemoPlaceholderValues;
  onPlaceholderValuesChange: (next: DemoPlaceholderValues) => void;
  placeholdersEnabled: boolean;
  onInjectComposerExample: () => void;
}

export default function DemoCapabilityLab({
  settings,
  onChange,
  onReset,
  panelOpen,
  onOpenChange,
  minimized,
  onMinimizedChange,
  onApplyWindowPreset,
  onSeedShowcaseSession,
  onTriggerMinimizedTickerDemo,
  assistantBusy,
  availableTools,
  activeSessionTools,
  onStartHostSession,
  onUpdateSessionTools,
  placeholderValues,
  onPlaceholderValuesChange,
  placeholdersEnabled,
  onInjectComposerExample
}: DemoCapabilityLabProps) {
  const [seeding, setSeeding] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [activeTab, setActiveTab] = useState<'workflow' | 'ui' | 'slots' | 'gallery' | 'simulator'>('workflow');
  const [launchTitle, setLaunchTitle] = useState('小说创作：寒雾古城');
  const [launchSystemPrompt, setLaunchSystemPrompt] = useState(
    '你是一位擅长东方悬疑长篇小说的共创编辑。当前作品世界观设定：{{故事介绍}}。请严格依据设定、卷纲与角色档案展开情节，人物言行须符合设定。'
  );
  const [launchShowSystemPrompt, setLaunchShowSystemPrompt] = useState(true);
  const [launchInitialPrompt, setLaunchInitialPrompt] = useState(
    '请结合{{故事介绍}}与{{卷纲}}，围绕{{角色:张三}}设计第一章开篇的冲突场景。'
  );
  const [launchAutoSend, setLaunchAutoSend] = useState(true);
  const [launchTools, setLaunchTools] = useState<string[]>(() =>
    availableTools.filter(tool => tool.source === 'host' || tool.name === 'list_fonts').map(tool => tool.name)
  );

  const update = <K extends keyof DemoHarnessSettings>(key: K, value: DemoHarnessSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const updateSim = <K extends keyof DemoSimulationOptions>(key: K, value: DemoSimulationOptions[K]) => {
    onChange({
      ...settings,
      simulation: {
        ...settings.simulation,
        [key]: value
      }
    });
  };

  const handleSeed = async () => {
    if (seeding || assistantBusy) return;
    setSeeding(true);
    try {
      await onSeedShowcaseSession();
    } finally {
      setSeeding(false);
    }
  };

  const toggleLaunchTool = (name: string) => {
    setLaunchTools(prev => (prev.includes(name) ? prev.filter(item => item !== name) : [...prev, name]));
  };

  const toggleLiveSessionTool = (name: string) => {
    const next = activeSessionTools.includes(name)
      ? activeSessionTools.filter(item => item !== name)
      : [...activeSessionTools, name];
    void onUpdateSessionTools(next);
  };

  const handleLaunchSession = async () => {
    if (launching || assistantBusy) return;
    setLaunching(true);
    try {
      await onStartHostSession({
        title: launchTitle.trim() || undefined,
        systemPrompt: launchSystemPrompt,
        showSystemPrompt: launchShowSystemPrompt,
        initialPrompt: launchInitialPrompt,
        autoSend: launchAutoSend,
        enabledTools: launchTools.filter(name => availableTools.some(tool => tool.name === name))
      });
    } finally {
      setLaunching(false);
    }
  };

  return (
    <section className="demo-lab" aria-label="组件能力与交互实验室">
      <header className="demo-lab-header">
        <div>
          <span className="demo-section-kicker">CAPABILITY PLAYGROUND & PROPS CONTROLS</span>
          <h2>组件能力与交互实验室（全量参数实时演练）</h2>
        </div>
        <div className="demo-lab-header-actions">
          <button
            type="button"
            className="demo-lab-seed-btn"
            disabled={seeding || assistantBusy}
            onClick={() => void handleSeed()}
            title="向助手注入包含思考流、多工具调用、AI生图、过程预览图与参考附件的完整演示会话"
          >
            <Wand2 size={13} />
            <span>{seeding ? '正在注入演示数据...' : '一键注入全功能演示会话'}</span>
          </button>
          <button type="button" className="demo-reset" onClick={onReset} title="恢复实验室默认参数">
            <RotateCcw size={13} /> 重置实验室
          </button>
        </div>
      </header>

      <p className="demo-integration-note">
        全方位控制 <code>AiAssistant</code>、<code>AiSettings</code>、<code>SessionList</code>、<code>ModelControls</code> 与 <code>TokenUsageBar</code> 的所有 Props、插槽与本地模拟行为。
      </p>

      {/* 顶部子标签切换 */}
      <div className="demo-lab-tabs" role="tablist" aria-label="能力分类">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'workflow'}
          className={`demo-lab-tab ${activeTab === 'workflow' ? 'active' : ''}`}
          onClick={() => setActiveTab('workflow')}
        >
          <Rocket size={13} />
          <span>会话启动、工具与占位符</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'simulator'}
          className={`demo-lab-tab ${activeTab === 'simulator' ? 'active' : ''}`}
          onClick={() => setActiveTab('simulator')}
        >
          <Sparkles size={13} />
          <span>本地模拟与场景触发</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'ui'}
          className={`demo-lab-tab ${activeTab === 'ui' ? 'active' : ''}`}
          onClick={() => setActiveTab('ui')}
        >
          <Languages size={13} />
          <span>文案、多语言与浮窗尺寸</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'slots'}
          className={`demo-lab-tab ${activeTab === 'slots' ? 'active' : ''}`}
          onClick={() => setActiveTab('slots')}
        >
          <Sliders size={13} />
          <span>组件插槽与设置中心扩展</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'gallery'}
          className={`demo-lab-tab ${activeTab === 'gallery' ? 'active' : ''}`}
          onClick={() => setActiveTab('gallery')}
        >
          <ImageIcon size={13} />
          <span>图片画廊与画布联动</span>
        </button>
      </div>

      {/* 面板 0：宿主启动会话、统一工具选择、占位符快照与工具栏插槽 */}
      {activeTab === 'workflow' && (
        <div className="demo-lab-panel demo-workflow-panel">
          <div className="demo-workflow-card">
            <div className="demo-workflow-card-head">
              <div>
                <strong>1. 宿主启动新会话 (<code>assistant.startSession</code>)</strong>
                <small>传入系统提示词、是否展示给用户、首条用户提示词及本会话可用工具（业务工具 + 内置工具）。</small>
              </div>
              <button
                type="button"
                className="demo-lab-seed-btn"
                disabled={launching || assistantBusy}
                onClick={() => void handleLaunchSession()}
              >
                <Rocket size={13} />
                <span>{launching ? '启动中...' : '以当前配置启动新会话'}</span>
              </button>
            </div>

            <div className="demo-limit-grid">
              <label>
                会话标题 (<code>title</code>)
                <input
                  type="text"
                  value={launchTitle}
                  onChange={e => setLaunchTitle(e.target.value)}
                />
              </label>
              <label className="demo-feature">
                <input
                  type="checkbox"
                  checked={launchShowSystemPrompt}
                  onChange={e => setLaunchShowSystemPrompt(e.target.checked)}
                />
                <span>
                  <strong>向用户展示系统提示词 (<code>showSystemPrompt</code>)</strong>
                  <small>开启后在对话流顶部渲染可折叠的系统提示词卡片。</small>
                </span>
              </label>
              <label className="demo-lab-span-2">
                系统提示词 (<code>systemPrompt</code>，支持 <code>{'{{占位符}}'}</code>)
                <textarea
                  rows={2}
                  value={launchSystemPrompt}
                  onChange={e => setLaunchSystemPrompt(e.target.value)}
                />
              </label>
              <label className="demo-lab-span-2">
                首条用户提示词 (<code>initialPrompt</code>，支持 <code>{'{{占位符}}'}</code>)
                <textarea
                  rows={2}
                  value={launchInitialPrompt}
                  onChange={e => setLaunchInitialPrompt(e.target.value)}
                />
              </label>
            </div>

            <div className="demo-workflow-tools-block">
              <div className="demo-workflow-subhead">
                <span><Wrench size={12} /> 新会话初始可用工具 (<code>enabledTools</code>)</span>
                <label className="demo-inline-check">
                  <input
                    type="checkbox"
                    checked={launchAutoSend}
                    onChange={e => setLaunchAutoSend(e.target.checked)}
                  />
                  <span>启动后立即发送首条提示词</span>
                </label>
              </div>
              <div className="demo-tool-chip-grid">
                {availableTools.map(tool => {
                  const checked = launchTools.includes(tool.name);
                  return (
                    <label key={tool.name} className={`demo-tool-chip ${checked ? 'is-checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLaunchTool(tool.name)}
                      />
                      <span>
                        <strong>{resolveToolLabel(tool, false)}</strong>
                        <small>{resolveToolGroup(tool, false)} · {tool.source === 'host' ? '业务' : '内置'}</small>
                        <small>{resolveToolUiDescription(tool, false)}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="demo-workflow-card">
            <div className="demo-workflow-card-head">
              <div>
                <strong>2. 随时调整当前会话可用工具 (<code>assistant.setSessionTools</code>)</strong>
                <small>与助手右上角扳手面板实时双向同步，修改后立即影响下一次模型请求。</small>
              </div>
              <div className="demo-lab-btn-group">
                <button
                  type="button"
                  className="demo-lab-action-chip"
                  onClick={() => void onUpdateSessionTools(availableTools.map(tool => tool.name))}
                >
                  全部启用
                </button>
                <button
                  type="button"
                  className="demo-lab-action-chip"
                  onClick={() => void onUpdateSessionTools([])}
                >
                  全部关闭
                </button>
              </div>
            </div>
            <div className="demo-tool-chip-grid">
              {availableTools.map(tool => {
                const checked = activeSessionTools.includes(tool.name);
                return (
                  <label key={`live-${tool.name}`} className={`demo-tool-chip ${checked ? 'is-checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLiveSessionTool(tool.name)}
                    />
                    <span>
                      <strong>{resolveToolLabel(tool, false)}</strong>
                      <small>{resolveToolGroup(tool, false)} · {tool.source === 'host' ? '业务' : '内置'}</small>
                      <small>{resolveToolUiDescription(tool, false)}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.showHeaderToolPicker}
                onChange={e => update('showHeaderToolPicker', e.target.checked)}
              />
              <span>
                <strong>显示右上角自带工具设置面板 (<code>showHeaderToolPicker</code>)</strong>
                <small>关闭后隐藏右上角扳手按钮，方便宿主仅在输入框上方工具栏插槽自定义工具选择控件。</small>
              </span>
            </label>
          </div>

          <div className="demo-workflow-card">
            <div className="demo-workflow-card-head">
              <div>
                <strong>3. 宿主占位符实时数据与快照验证 (<code>placeholders</code>)</strong>
                <small>
                  {placeholdersEnabled
                    ? '先发送带 {{角色:张三}} 的消息，再修改下方内容；点击历史消息里的 {{角色:张三}} 芯片即可验证发送时的快照未被覆盖。'
                    : '当前已在下方「接入配置」中关闭占位符替换开关，发送时将原样保留 {{...}}。'}
                </small>
              </div>
              <div className="demo-lab-btn-group">
                <button
                  type="button"
                  className="demo-lab-action-chip"
                  onClick={onInjectComposerExample}
                >
                  <Braces size={12} />
                  <span>通过 composerRef 写入带占位符草稿</span>
                </button>
              </div>
            </div>
            <div className="demo-limit-grid">
              {(Object.keys(placeholderValues) as Array<keyof DemoPlaceholderValues>).map(key => (
                <label key={key}>
                  <code>{`{{${key}}}`}</code>
                  <textarea
                    rows={2}
                    value={placeholderValues[key]}
                    onChange={e => onPlaceholderValuesChange({ ...placeholderValues, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.showComposerToolbar}
                onChange={e => update('showComposerToolbar', e.target.checked)}
              />
              <span>
                <strong>启用输入框上方工具栏插槽 (<code>renderComposerToolbar</code>)</strong>
                <small>在输入框上方渲染快捷提示词下拉框、占位符插入下拉框及操作按钮，直接调用 <code>ComposerController</code> 操控光标与内容。</small>
              </span>
            </label>
          </div>
        </div>
      )}

      {/* 面板 1：本地模拟与场景触发 */}
      {activeTab === 'simulator' && (
        <div className="demo-lab-panel">
          <div className="demo-feature-list">
            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.simulation.simulateReasoning}
                onChange={e => updateSim('simulateReasoning', e.target.checked)}
              />
              <span>
                <strong>模拟思考过程流 (Reasoning Stream)</strong>
                <small>本地演示回复前流式输出可折叠的思考推理摘要卡片。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.simulation.simulateMultiTools}
                onChange={e => updateSim('simulateMultiTools', e.target.checked)}
              />
              <span>
                <strong>模拟多步工具调用链 (Multi-Tool Loop)</strong>
                <small>依次调用读取工作区、查询字体与上下文工具并展示实时耗时。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.simulation.simulateImageGeneration}
                onChange={e => updateSim('simulateImageGeneration', e.target.checked)}
              />
              <span>
                <strong>模拟本地生图并写入画廊 (Image Generation)</strong>
                <small>无需外部 API Key，自动生成 PNG 图像存入 IndexedDB 并关联至工具卡片与图片画廊。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.simulation.simulateTokenUsage}
                onChange={e => updateSim('simulateTokenUsage', e.target.checked)}
              />
              <span>
                <strong>模拟 Token 用量与吞吐速率统计 (Usage)</strong>
                <small>在消息底部生成 Token 徽章（悬停查看输入/输出/缓存/推理明细与 tokens/s）并更新底部用量环。</small>
              </span>
            </label>
          </div>

          <div className="demo-lab-actions-bar">
            <div className="demo-lab-actions-label">
              <strong>快捷交互演练：</strong>
              <span>一键触发特殊组件状态</span>
            </div>
            <div className="demo-lab-btn-group">
              <button
                type="button"
                className="demo-lab-action-chip"
                disabled={assistantBusy}
                onClick={() => void handleSeed()}
              >
                <Wand2 size={12} />
                <span>生成含 3 类图片的完整会话</span>
              </button>
              <button
                type="button"
                className="demo-lab-action-chip"
                disabled={assistantBusy}
                onClick={() => void onTriggerMinimizedTickerDemo()}
              >
                <Play size={12} />
                <span>最小化并演示胶囊条实时轮播</span>
              </button>
              <button
                type="button"
                className="demo-lab-action-chip"
                onClick={() => {
                  onOpenChange(true);
                  onMinimizedChange(false);
                }}
              >
                <Bot size={12} />
                <span>展开并聚焦助手浮窗</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 面板 2：文案、多语言与浮窗尺寸 */}
      {activeTab === 'ui' && (
        <div className="demo-lab-panel">
          <div className="demo-lab-row">
            <div className="demo-lab-field">
              <span className="demo-lab-label">界面语言 (<code>language</code>)</span>
              <div className="demo-lab-segmented" role="group" aria-label="组件界面语言">
                <button
                  type="button"
                  aria-pressed={settings.language === 'zh'}
                  onClick={() => update('language', 'zh')}
                >
                  简体中文 (zh)
                </button>
                <button
                  type="button"
                  aria-pressed={settings.language === 'en'}
                  onClick={() => update('language', 'en')}
                >
                  English (en)
                </button>
              </div>
            </div>

            <div className="demo-lab-field">
              <span className="demo-lab-label">浮窗状态与尺寸预设 (<code>useFloatingPanel</code>)</span>
              <div className="demo-lab-btn-group">
                <button
                  type="button"
                  className="demo-lab-action-chip"
                  onClick={() => onOpenChange(!panelOpen)}
                >
                  <Bot size={12} />
                  <span>{panelOpen ? '关闭浮窗' : '打开浮窗'}</span>
                </button>
                <button
                  type="button"
                  className="demo-lab-action-chip"
                  disabled={!panelOpen}
                  onClick={() => onMinimizedChange(!minimized)}
                >
                  {minimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
                  <span>{minimized ? '恢复展开' : '最小化为胶囊'}</span>
                </button>
                <button type="button" className="demo-lab-action-chip" onClick={() => onApplyWindowPreset('compact')}>
                  紧凑 360×500
                </button>
                <button type="button" className="demo-lab-action-chip" onClick={() => onApplyWindowPreset('default')}>
                  标准 410×640
                </button>
                <button type="button" className="demo-lab-action-chip" onClick={() => onApplyWindowPreset('wide')}>
                  宽屏 560×720
                </button>
                <button type="button" className="demo-lab-action-chip" onClick={() => onApplyWindowPreset('center')}>
                  居中浮窗
                </button>
              </div>
            </div>
          </div>

          <div className="demo-lab-presets">
            <span className="demo-lab-label">一键切换场景人设预设：</span>
            <div className="demo-lab-btn-group">
              {PERSONA_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  className="demo-lab-action-chip"
                  onClick={() =>
                    onChange({
                      ...settings,
                      language: preset.id === 'english' ? 'en' : settings.language,
                      title: preset.title,
                      emptyTitle: preset.emptyTitle,
                      emptyDescription: preset.emptyDescription,
                      contextTitle: preset.contextTitle,
                      contextMeta: preset.contextMeta
                    })
                  }
                >
                  <strong>{preset.badge}</strong> · {preset.title}
                </button>
              ))}
            </div>
          </div>

          <div className="demo-limit-grid">
            <label>
              助手主标题 (<code>title</code>)
              <input
                type="text"
                value={settings.title}
                onChange={e => update('title', e.target.value)}
              />
            </label>
            <label>
              空白态标题 (<code>emptyTitle</code>)
              <input
                type="text"
                value={settings.emptyTitle}
                onChange={e => update('emptyTitle', e.target.value)}
              />
            </label>
            <label className="demo-lab-span-2">
              空白态引导描述 (<code>emptyDescription</code>)
              <input
                type="text"
                value={settings.emptyDescription}
                onChange={e => update('emptyDescription', e.target.value)}
              />
            </label>
          </div>

          <div className="demo-limit-grid">
            <label className="demo-feature demo-lab-span-2">
              <input
                type="checkbox"
                checked={settings.showContextBar}
                onChange={e => update('showContextBar', e.target.checked)}
              />
              <span>
                <strong>显示顶部工作区上下文状态栏 (<code>contextTitle</code> / <code>contextMeta</code>)</strong>
                <small>在浮窗标题栏下方显示带绿点指示的当前宿主文档/画布状态信息。</small>
              </span>
            </label>
            {settings.showContextBar && (
              <>
                <label>
                  上下文主标题 (<code>contextTitle</code>)
                  <input
                    type="text"
                    value={settings.contextTitle}
                    onChange={e => update('contextTitle', e.target.value)}
                  />
                </label>
                <label>
                  上下文附加信息 (<code>contextMeta</code>)
                  <input
                    type="text"
                    value={settings.contextMeta}
                    onChange={e => update('contextMeta', e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
        </div>
      )}

      {/* 面板 3：组件插槽与设置中心扩展 */}
      {activeTab === 'slots' && (
        <div className="demo-lab-panel">
          <div className="demo-feature-list">
            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.enableFork}
                onChange={e => update('enableFork', e.target.checked)}
              />
              <span>
                <strong>启用对话分支分叉 (<code>onFork</code>)</strong>
                <small>在每条已完成 AI 回复底部展示分叉按钮，可从该节点切出新会话分支。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.demoSupportsVision}
                onChange={e => update('demoSupportsVision', e.target.checked)}
              />
              <span>
                <strong>当前演示模型支持视觉输入 (<code>supportsVision</code>)</strong>
                <small>开启后输入框显示添加图片按钮并支持粘贴截图；关闭后可演示纯文本模型的图片暂存提示。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.showUsageBar}
                onChange={e => update('showUsageBar', e.target.checked)}
              />
              <span>
                <strong>显示底部 Token 用量进度环 (<code>renderUsage</code>)</strong>
                <small>在输入框左下角渲染 TokenUsageBar，实时估算上下文占用率与请求明细。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.showModelControls}
                onChange={e => update('showModelControls', e.target.checked)}
              />
              <span>
                <strong>显示底部模型与思考切换器 (<code>renderModelControls</code>)</strong>
                <small>在输入框左下角渲染 ModelControls，支持内联切换模型与思考推理强度。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.enableEncryptionSlot}
                onChange={e => update('enableEncryptionSlot', e.target.checked)}
              />
              <span>
                <strong>启用本机密钥管理面板 (<code>renderEncryption</code>)</strong>
                <small>在配置中心「其他设置」中渲染 AES-256-GCM 密钥生成、轮换与口令备份面板。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.showTurnLimits}
                onChange={e => update('showTurnLimits', e.target.checked)}
              />
              <span>
                <strong>配置中心显示轮次与失败上限 (<code>showTurnLimits</code>)</strong>
                <small>控制配置中心是否展示工具调用轮次上限与生图失败上限表单。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.showSecurityNotice}
                onChange={e => update('showSecurityNotice', e.target.checked)}
              />
              <span>
                <strong>配置中心显示安全提示横幅 (<code>notice</code>)</strong>
                <small>在配置中心模型配置页渲染宿主自定义的安全与计费提醒卡片。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.loadGooglePreviews}
                onChange={e => update('loadGooglePreviews', e.target.checked)}
              />
              <span>
                <strong>加载 Google Fonts 真实字形样式表 (<code>loadGooglePreviews</code>)</strong>
                <small>在字体管理面板中动态请求 Google Fonts CSS 以真实字形渲染字体名称。</small>
              </span>
            </label>
          </div>
        </div>
      )}

      {/* 面板 4：图片画廊与画布联动 */}
      {activeTab === 'gallery' && (
        <div className="demo-lab-panel">
          <div className="demo-feature-list">
            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.enableGalleryInsert}
                onChange={e => update('enableGalleryInsert', e.target.checked)}
              />
              <span>
                <strong>启用画廊「置入工作区」动作 (<code>assistant.insertImage</code>)</strong>
                <small>在「历史对话 → 图片画廊」卡片上显示置入按钮，点击后将图片直接插入下方工作区文档。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.galleryInsertEnabled}
                disabled={!settings.enableGalleryInsert}
                onChange={e => update('galleryInsertEnabled', e.target.checked)}
              />
              <span>
                <strong>允许执行置入操作 (<code>imageInsertAction.enabled</code>)</strong>
                <small>取消勾选可测试画布锁定时的按钮禁用态与悬停原因提示（disabledReason）。</small>
              </span>
            </label>

            <label className="demo-feature">
              <input
                type="checkbox"
                checked={settings.galleryInsertAllowPreview}
                disabled={!settings.enableGalleryInsert}
                onChange={e => update('galleryInsertAllowPreview', e.target.checked)}
              />
              <span>
                <strong>允许置入「过程预览 (preview)」图片 (<code>isVisible</code>)</strong>
                <small>默认仅 AI 生图与附件显示置入按钮；开启后过程预览图也支持一键置入。</small>
              </span>
            </label>
          </div>

          {settings.enableGalleryInsert && (
            <div className="demo-limit-grid">
              <label>
                置入按钮文案 (<code>label</code>)
                <input
                  type="text"
                  value={settings.insertLabel}
                  onChange={e => update('insertLabel', e.target.value)}
                />
              </label>
              <label>
                置入成功反馈文案 (<code>successLabel</code>)
                <input
                  type="text"
                  value={settings.insertSuccessLabel}
                  onChange={e => update('insertSuccessLabel', e.target.value)}
                />
              </label>
              <label className="demo-lab-span-2">
                禁用原因提示 (<code>disabledReason</code>，取消勾选“允许执行置入操作”时生效)
                <input
                  type="text"
                  value={settings.insertDisabledReason}
                  onChange={e => update('insertDisabledReason', e.target.value)}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
