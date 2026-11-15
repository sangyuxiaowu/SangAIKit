// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DEFAULT_AI_FEATURES, type AiFeatures } from '../src/features';
import DemoIntegrationSettings from './DemoIntegrationSettings';

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
    expect(host.querySelector('.demo-effective code')?.textContent).toBe('read_workspace · skill');
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