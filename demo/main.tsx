import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Bot, CircleHelp, LayoutDashboard, MessageSquare, Sun, Moon, Monitor } from 'lucide-react';
import { AiAssistant, AiSettings, ConfigDecryptionError, EncryptionKeySettings, FontSettings, ImageModelSettings, ModelControls, SkillSettings, TokenUsageBar, DEFAULT_SETTINGS, availableImageModels, createBrowserAiStore, createEndpoint, createImageUpload, createKeyBackupCodec, createModel, normalizeConfig, normalizeAiFeatures, resolveSelection, selectModel, sessionUsageSummary, sumUsage, updateActiveModel, useFloatingPanel, type AiConfig, type AiFeatures, type AssistantTheme, type FloatingStore } from '../src';
import { DEMO_FEATURES, forkDemoConversation, loadDemoImage, useDemoAssistant } from './useDemoAssistant';
import DemoIntegrationSettings from './DemoIntegrationSettings';
import './demo.css';

const floatingStore: FloatingStore = {
  async loadUiState() { try { return JSON.parse(localStorage.getItem('sang-ai-kit-demo-window') || '{}'); } catch { return {}; } },
  async saveUiState(value) { localStorage.setItem('sang-ai-kit-demo-window', JSON.stringify(value)); }
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
function initialFeatures(): AiFeatures {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(integrationStorageKey) || 'null');
    return saved ? normalizeAiFeatures(saved) : { ...DEMO_FEATURES };
  } catch { return { ...DEMO_FEATURES }; }
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

function Demo() {
  const [theme, setTheme] = useState<AssistantTheme>('dark');
  const [accent, setAccent] = useState('#10b981');
  const [open, setOpen] = useState(true);
  const [features, setFeatures] = useState(initialFeatures);
  const [config, setConfig] = useState(initialConfig);
  const configRef = useRef(config);
  configRef.current = config;
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [keyError, setKeyError] = useState(false);
  const baseAssistant = useDemoAssistant(config, features);
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
  const assistant = { ...baseAssistant, loading: baseAssistant.loading || configLoading, loadError: baseAssistant.loadError || configError, keyError, reloadConfig };
  const floating = useFloatingPanel(floatingStore);
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

  return <main className="demo-shell" style={{ '--sang-ai-accent': accent } as CSSProperties}>
    <aside className="demo-rail"><div className="demo-logo">S</div><button title="工作区" aria-label="工作区"><LayoutDashboard size={20} /></button><button className="active" title="AI 助手" aria-label="打开 AI 助手" onClick={() => setOpen(true)}><MessageSquare size={20} /></button><button title="帮助" aria-label="帮助"><CircleHelp size={20} /></button></aside>
    <div className="demo-workspace"><header className="demo-topbar"><div><strong>SangAIKit</strong><span> / </span> 助手演示</div><div className="demo-actions"><label className="demo-color" title="选择强调色"><input type="color" aria-label="强调色" value={accent} onChange={event => setAccent(event.target.value)} /></label><div className="demo-themes" role="group" aria-label="主题">{([['light', '浅色', Sun], ['dark', '深色', Moon], ['system', '跟随系统', Monitor]] as const).map(([value, label, Icon]) => <button key={value} type="button" title={label} aria-label={label} aria-pressed={theme === value} onClick={() => setTheme(value)}><Icon size={16} /></button>)}</div><button className="demo-open" onClick={() => setOpen(true)}><Bot size={16} /> AI 助手</button></div></header>
      <div className="demo-content"><div className="demo-content-heading"><div><span className="demo-eyebrow">WORKSPACE / DEMO</span><h1>工作区</h1></div><span className="demo-live"><i /> 本地演示</span></div><div className="demo-document"><div className="demo-document-top"><span>项目概览</span><span>01 / 03</span></div><h2>从想法开始</h2><p>在工作区中整理想法，与 AI 助手协作。</p><div className="demo-rule" /><div className="demo-lines"><span /><span /><span /></div></div>
        <DemoIntegrationSettings features={features} onFeaturesChange={updateFeatures} maxToolRounds={config.maxToolRounds ?? DEFAULT_SETTINGS.maxToolRounds} maxImageFailures={config.maxImageFailures ?? DEFAULT_SETTINGS.maxImageFailures}
          onLimitChange={updateLimit} validImageModelCount={availableImageModels(config).length} skillCount={config.skills?.length ?? 0} onReset={resetIntegration} />
      </div>
    </div>
    <AiAssistant assistant={assistant} floating={floating} language="zh" theme={theme} open={open} onOpenChange={setOpen}
      title="AI 助手" emptyTitle="智能助手已就绪" emptyDescription="与助手交流想法，探索工作区中的内容。"
      contextTitle="演示工作区" quickSnippets={config.quickSnippets ?? []} features={features} onFork={event => forkDemoConversation(assistant, event, baseAssistant.reloadConfig)}
      active={{ endpoint: active.endpoint.id === 'local-demo' ? { ...active.endpoint, apiKey: 'demo' } : active.endpoint, model: active.endpoint.id === 'local-demo' ? { ...active.model, supportsVision: false } : active.model }}
      imageToolsEnabled={features.imageGeneration && availableImageModels(config).length > 0}
      toolLabels={{ demo_context: ['读取工作区', 'Read workspace'], read_workspace: ['读取工作区', 'Read workspace'], skill: ['读取技能', 'Read skill'], list_fonts: ['读取字体', 'List fonts'], generate_image: ['生成图片', 'Generate image'] }}
      loadImage={loadDemoImage} createImageUpload={createImageUpload} imageModelForTool={tool => { try { const args: unknown = JSON.parse(tool.arguments); return args && typeof args === 'object' && 'modelConfigId' in args ? config.imageModels?.find(model => model.id === args.modelConfigId) : undefined; } catch { return undefined; } }} sumUsage={sumUsage}
      renderMarkdown={content => <div className="cf-ai-markdown" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(content, { async: false }) as string) }} />}
      renderUsage={(prompt, english) => <TokenUsageBar usage={sessionUsageSummary(assistant.sessions.find(session => session.id === assistant.activeSessionId), active.model, active.endpoint.endpoint, config.systemPrompt, prompt)} model={active.model} busy={assistant.busy} english={english} />}
      renderModelControls={disabled => <ModelControls config={config} configure={configure} resolveSelection={resolveSelection} selectModel={selectModel} updateActiveModel={updateActiveModel} disabled={disabled} english={false} />}
      renderSettings={(close, initialSecurity) => <AiSettings config={config} features={features} onSave={configure} onBack={close} english={false} theme={theme} store={configStore} onKeyChanged={reloadConfig} initialSecurity={initialSecurity}
        createEndpoint={createEndpoint} createModel={createModel} normalizeConfig={normalizeConfig} resolveSelection={resolveSelection} defaults={defaults} showTurnLimits={true}
        renderImageModels={(draft, onChange, english) => <ImageModelSettings config={draft} onChange={onChange} english={english} />}
        renderSkills={(skills, onChange, english) => <SkillSettings skills={skills} onChange={onChange} english={english} />}
        renderFonts={(fonts, onChange, english, enabled) => <FontSettings fonts={fonts} onChange={onChange} english={english} loadGooglePreviews={false} showLocalFonts={enabled.localFonts} showOnlineFonts={enabled.onlineFonts} />}
        renderEncryption={(manager, callbacks, english) => <EncryptionKeySettings manager={manager} english={english} {...callbacks} {...keyBackup} saveBackup={saveBackup} isDecryptionError={error => error instanceof ConfigDecryptionError} />}
        notice={<p className="sang-ai-security-notice text-xs text-amber-300">API Key 在本机加密存储，但浏览器脚本仍可能读取解密后的密钥。真实请求可能产生费用；生产环境建议使用后端代理。</p>} />}
    />
  </main>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<Demo />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());