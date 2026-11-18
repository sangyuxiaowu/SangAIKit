// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DEFAULT_AI_FEATURES, type AiFeatures } from '../src/features';
import AiSettings from '../src/AiSettings';
import ImageModelSettings from '../src/ImageModelSettings';
import { createImageModel } from '../src/image-generation';
import { DEFAULT_SETTINGS, createEndpoint, createModel, normalizeConfig, resolveSelection } from '../src/modelConfig';
import DemoIntegrationSettings from './DemoIntegrationSettings';

it('edits the reference image limit including zero', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const endpoint = createEndpoint('openai');
  const model = createImageModel('gpt-image-2');
  const config = { endpoints: [endpoint], imageModels: [model], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: '' };
  const onChange = vi.fn();
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ImageModelSettings config={config} onChange={onChange} english={false} />));
    const field = host.querySelector<HTMLInputElement>(`#${model.id}-references`)!;
    expect(field.value).toBe('5');
    expect(field.min).toBe('0');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '0');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ imageModels: [expect.objectContaining({ maxReferenceImages: 0 })] }));
  } finally { await act(async () => root.unmount()); }
});

vi.mock('../src/background-removal/useResources', () => ({ useResources: () => ({
  settings: { modelId: 'u2netp', device: 'wasm' }, models: {}, runtime: false, loading: false, error: ''
}) }));

it('updates host features, keeps online fonts subordinate, and previews registered tools', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onFeaturesChange = vi.fn<(features: AiFeatures) => void>();
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DemoIntegrationSettings
      features={{ ...DEFAULT_AI_FEATURES, fontManagement: false }}
      onFeaturesChange={onFeaturesChange}
      maxToolRounds={24}
      maxImageFailures={3}
      onLimitChange={vi.fn()}
      validImageModelCount={0}
      skillCount={1}
      onReset={vi.fn()}
    />));
    const onlineFonts = host.querySelector<HTMLInputElement>('input[type=checkbox][disabled]');
    expect(onlineFonts).toBeTruthy();
    expect(host.textContent).toContain('未找到有效生图模型');
    expect(host.querySelector('.demo-effective code')?.textContent).toBe('read_workspace · remove_background · skill');
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    });
    expect(onFeaturesChange).toHaveBeenCalledWith({ ...DEFAULT_AI_FEATURES, fontManagement: false, imageGeneration: false });
  } finally {
    await act(async () => root.unmount());
  }
});

it('accepts zero as an unlimited runtime limit', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onLimitChange = vi.fn();
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DemoIntegrationSettings
      features={{ ...DEFAULT_AI_FEATURES }}
      onFeaturesChange={vi.fn()}
      maxToolRounds={24}
      maxImageFailures={3}
      onLimitChange={onLimitChange}
      validImageModelCount={1}
      skillCount={0}
      onReset={vi.fn()}
    />));
    const limit = host.querySelector<HTMLInputElement>('input[aria-label="工具调用轮次上限"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(limit, '0');
      limit.dispatchEvent(new Event('input', { bubbles: true }));
      limit.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onLimitChange).toHaveBeenCalledWith('maxToolRounds', 0);
    expect(host.textContent).toContain('0 表示无上限');
  } finally {
    await act(async () => root.unmount());
  }
});

it('uses the real background removal settings and hides them when disabled', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const endpoint = createEndpoint('custom');
  const config = {
    endpoints: [endpoint], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id },
    systemPrompt: DEFAULT_SETTINGS.systemPrompt
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  const render = (enabled: boolean) => root.render(<AiSettings
    config={config} features={{ backgroundRemoval: enabled }} onSave={async () => {}} onBack={() => {}}
    english={false} store={{ loadConfig: async () => config }} onKeyChanged={async () => {}}
    createEndpoint={createEndpoint} createModel={createModel} normalizeConfig={normalizeConfig}
    resolveSelection={resolveSelection} defaults={DEFAULT_SETTINGS}
  />);
  try {
    await act(async () => render(true));
    const tab = host.querySelector<HTMLButtonElement>('#ai-settings-tab-removal')!;
    expect(tab).toBeTruthy();
    await act(async () => tab.click());
    expect([...host.querySelectorAll('article strong')].map(item => item.textContent)).toEqual(['U2NetP', 'BiRefNet Lite 512', 'MODNet']);
    expect(host.textContent).toContain('下载模型');
    expect(host.textContent).not.toContain('RMBG-1.4');
    expect(host.textContent).not.toContain('宿主插槽演示');
    await act(async () => render(false));
    expect(host.querySelector('#ai-settings-tab-removal')).toBeNull();
    expect(host.querySelector('[aria-label="抠图设置"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    vi.unstubAllGlobals();
  }
});