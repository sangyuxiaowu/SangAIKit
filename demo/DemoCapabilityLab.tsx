import { useState } from 'react';
import {
  Bot,
  Cpu,
  Image as ImageIcon,
  Languages,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Scissors,
  Sliders,
  Sparkles,
  Wand2
} from 'lucide-react';
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
  enableBackgroundRemovalSlot: boolean;
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
  enableBackgroundRemovalSlot: true,
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
  assistantBusy
}: DemoCapabilityLabProps) {
  const [seeding, setSeeding] = useState(false);
  const [activeTab, setActiveTab] = useState<'ui' | 'slots' | 'gallery' | 'simulator'>('simulator');

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
                checked={settings.enableBackgroundRemovalSlot}
                onChange={e => update('enableBackgroundRemovalSlot', e.target.checked)}
              />
              <span>
                <strong>注入「智能抠图」宿主扩展设置页 (<code>renderBackgroundRemoval</code>)</strong>
                <small>向配置中心动态注入第 3 个标签页「智能抠图」，演示宿主专用设置面板插槽。</small>
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

// 宿主通过 renderBackgroundRemoval 插槽注入到 AiSettings 中的「智能抠图」演示面板
export function DemoBackgroundRemovalPanel({ english }: { english: boolean }) {
  const [model, setModel] = useState<'rmbg-1.4' | 'birefnet-lite' | 'modnet'>('rmbg-1.4');
  const [device, setDevice] = useState<'webgpu' | 'wasm'>('webgpu');
  const [feather, setFeather] = useState(2);
  const label = (zh: string, en: string) => (english ? en : zh);

  return (
    <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900/50 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
            <Scissors size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">
              {label('本地 ONNX 智能背景移除（宿主插槽演示）', 'Local ONNX Background Removal (Host Slot Demo)')}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {label(
                '此标签页由宿主通过 renderBackgroundRemoval 插槽动态注入，用于配置浏览器端本地抠图引擎。',
                'Injected by the host via renderBackgroundRemoval to configure browser-local background removal.'
              )}
            </p>
          </div>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300">
          {device === 'webgpu' ? 'WebGPU Accelerated' : 'WASM SIMD'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            {label('抠图推理模型', 'Segmentation Model')}
          </label>
          <select
            value={model}
            onChange={e => setModel(e.target.value as typeof model)}
            className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
          >
            <option value="rmbg-1.4">RMBG-1.4 (通用高精度 · 44MB)</option>
            <option value="birefnet-lite">BiRefNet-Lite (发丝级边缘 · 68MB)</option>
            <option value="modnet">MODNet (轻量极速人像 · 25MB)</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            {label('计算后端优先级', 'Execution Backend')}
          </label>
          <div className="flex items-center gap-2">
            {(['webgpu', 'wasm'] as const).map(item => (
              <button
                key={item}
                type="button"
                onClick={() => setDevice(item)}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  device === item
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-850 text-slate-300 border-slate-750 hover:bg-slate-800'
                }`}
              >
                <Cpu size={13} />
                <span>{item === 'webgpu' ? 'WebGPU 优先' : 'WASM 兼容'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="font-semibold text-slate-300">{label('边缘羽化半径 (px)', 'Edge Feathering (px)')}</span>
          <span className="font-mono text-blue-400">{feather} px</span>
        </div>
        <input
          type="range"
          min={0}
          max={8}
          step={1}
          value={feather}
          onChange={e => setFeather(Number(e.target.value))}
          className="w-full accent-blue-600 cursor-pointer"
        />
      </div>
    </section>
  );
}
