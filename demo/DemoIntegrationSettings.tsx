import { RotateCcw } from 'lucide-react';
import type { AiFeatures } from '../src/features';

const FEATURE_OPTIONS: { key: keyof AiFeatures; label: string; description: string }[] = [
  { key: 'imageGeneration', label: '生图工具', description: '仅在存在有效启用的生图模型时注册。' },
  { key: 'skills', label: 'SKILL', description: '启用已配置的技能读取工具。' },
  { key: 'quickSnippets', label: '快捷短语', description: '在助手空白状态显示快捷提问。' },
  { key: 'fontManagement', label: '字体管理', description: '提供本地字体管理与字体工具。' },
  { key: 'onlineFonts', label: '在线字体', description: '字体管理开启时，允许查询在线字体。' },
  { key: 'backgroundRemoval', label: '抠图', description: '启用本地抠图设置及工具。' },
  { key: 'placeholders', label: '占位符替换', description: '发送前将 {{占位符}} 替换为宿主实时内容并保存赋值快照。' },
  { key: 'sessionToolPicker', label: '右上角工具设置', description: '是否在助手标题栏右上角显示自带的树形工具选择面板（宿主也可关闭后在输入工具栏插槽自定义）。' }
];

type LimitKey = 'maxToolRounds' | 'maxImageFailures';

interface DemoIntegrationSettingsProps {
  features: AiFeatures;
  onFeaturesChange: (features: AiFeatures) => void;
  maxToolRounds: number;
  maxImageFailures: number;
  onLimitChange: (key: LimitKey, value: number) => void;
  validImageModelCount: number;
  skillCount: number;
  hostToolNames?: readonly string[];
  onReset: () => void;
}

export default function DemoIntegrationSettings({
  features, onFeaturesChange, maxToolRounds, maxImageFailures, onLimitChange,
  validImageModelCount, skillCount, hostToolNames, onReset
}: DemoIntegrationSettingsProps) {
  const toolNames = [
    ...(hostToolNames?.length ? hostToolNames : ['read_workspace']),
    ...(features.backgroundRemoval ? ['remove_background'] : []),
    ...(features.fontManagement ? ['list_fonts'] : []),
    ...(features.skills && skillCount ? ['skill'] : []),
    ...(features.imageGeneration && validImageModelCount > 1 ? ['list_image_models'] : []),
    ...(features.imageGeneration && validImageModelCount ? ['generate_image'] : [])
  ];

  const updateLimit = (key: LimitKey, value: string) => {
    if (value === '') return;
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) onLimitChange(key, parsed);
  };

  return <section className="demo-integration" aria-label="演示接入配置">
    <header className="demo-integration-header">
      <div><span className="demo-section-kicker">HOST INTEGRATION</span><h2>接入配置</h2></div>
      <button type="button" className="demo-reset" onClick={onReset} title="恢复演示默认设置"><RotateCcw size={14} /> 重置</button>
    </header>
    <p className="demo-integration-note">开发演示配置，修改后立即影响助手面板和下一次请求。</p>
    <div className="demo-feature-list">
      {FEATURE_OPTIONS.map(option => <label className="demo-feature" key={option.key}>
        <input
          type="checkbox"
          checked={features[option.key]}
          disabled={option.key === 'onlineFonts' && !features.fontManagement}
          onChange={event => onFeaturesChange({ ...features, [option.key]: event.target.checked })}
        />
        <span><strong>{option.label}</strong><small>{option.description}</small></span>
      </label>)}
    </div>
    <div className="demo-limit-grid">
      <label>工具调用轮次上限
        <input
          type="number" min={0} step={1} value={maxToolRounds}
          onChange={event => updateLimit('maxToolRounds', event.target.value)}
          aria-label="工具调用轮次上限"
        />
      </label>
      <label>生图累计失败上限
        <input
          type="number" min={0} step={1} value={maxImageFailures}
          onChange={event => updateLimit('maxImageFailures', event.target.value)}
          aria-label="生图累计失败上限"
        />
      </label>
    </div>
    <p className="demo-limit-note">0 表示无上限；无限制可能增加调用次数和费用。</p>
    <div className="demo-effective" aria-live="polite">
      <span>当前工具</span>
      <code>{toolNames.join(' · ')}</code>
      {features.imageGeneration && validImageModelCount === 0 && <small>未找到有效生图模型，generate_image 不会注册。</small>}
      {!features.fontManagement && <small>在线字体被字体管理总开关屏蔽。</small>}
    </div>
  </section>;
}