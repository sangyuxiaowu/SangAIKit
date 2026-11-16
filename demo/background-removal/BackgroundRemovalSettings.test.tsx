// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BackgroundRemovalSettings from '../../src/background-removal/BackgroundRemovalSettings.tsx';
import { installModel } from '../../src/background-removal/index.ts';
import { saveSettings } from '../../src/background-removal/storage.ts';
import { downloadModel } from '../../src/background-removal/resources.ts';
import { useResources } from '../../src/background-removal/useResources.ts';
import type { ModelId } from '../../src/background-removal/models.ts';
import type { StoredModel } from '../../src/background-removal/types.ts';

vi.mock('../../src/background-removal/index.ts', () => ({ installModel: vi.fn(), verifyModel: vi.fn() }));
vi.mock('../../src/background-removal/storage.ts', () => ({
  RUNTIME_VERSION: '1.23.2', readSettings: vi.fn(async () => ({ modelId: 'u2netp', device: 'wasm' })),
  saveSettings: vi.fn(async () => {}), deleteModel: vi.fn(), deleteRuntime: vi.fn()
}));
vi.mock('../../src/background-removal/resources.ts', () => ({
  RUNTIME_ASSETS: {}, RUNTIME_BASE: '', downloadModel: vi.fn(), importRuntime: vi.fn(),
  installRuntime: vi.fn(), loadResources: vi.fn()
}));
vi.mock('../../src/background-removal/useResources.ts', () => ({ useResources: vi.fn(() => ({
  settings: { modelId: 'u2netp' as const, device: 'wasm' as const },
  models: {} as Partial<Record<ModelId, StoredModel>>, runtime: true, loading: false, error: ''
})) }));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<BackgroundRemovalSettings english={false} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('model activation settings', () => {
  it('allows choosing an uncached model and downloading without a preinstalled runtime', async () => {
    vi.mocked(useResources).mockReturnValue({ ...useResources(), runtime: false, models: {} });
    await act(async () => root.render(<BackgroundRemovalSettings english={false} />));
    const model = container.querySelector<HTMLSelectElement>('#removal-active-model')!;
    expect([...model.options].every(option => !option.disabled)).toBe(true);
    await act(async () => { model.value = 'modnet'; model.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(saveSettings).toHaveBeenCalledWith({ modelId: 'modnet', device: 'wasm' });
    expect([...container.querySelectorAll('button')].find(button => button.textContent?.includes('下载模型'))!.disabled).toBe(false);
  });
  it('downloads U2NetP instead of treating it as bundled', async () => {
    const card = [...container.querySelectorAll('article')].find(article => article.querySelector('strong')?.textContent === 'U2NetP')!;
    expect(card.textContent).toContain('未安装');
    vi.mocked(downloadModel).mockResolvedValue(new Blob(['model']));
    vi.mocked(installModel).mockResolvedValue();
    await act(async () => [...card.querySelectorAll('button')].find(button => button.textContent?.includes('下载模型'))!.click());
    expect(downloadModel).toHaveBeenCalledWith('u2netp', expect.any(AbortSignal), expect.any(Function));
    expect(installModel).toHaveBeenCalledWith('u2netp', expect.any(Blob), 'u2netp.onnx', 'wasm', expect.any(Object));
  });
  it.each([
    ['fp16', 'model_fp16.onnx'], ['fp32', 'model.onnx']
  ] as const)('downloads, validates and activates the selected %s variant', async (precision, filename) => {
    const blob = new Blob(['model']);
    vi.mocked(downloadModel).mockResolvedValue(blob);
    vi.mocked(installModel).mockResolvedValue();
    const button = [...container.querySelectorAll('button')].find(button => button.textContent?.includes(`下载 ${precision.toUpperCase()}`))!;
    await act(async () => button.click());
    expect(downloadModel).toHaveBeenCalledWith('birefnet', expect.any(AbortSignal), expect.any(Function), precision);
    expect(installModel).toHaveBeenCalledWith('birefnet', blob, filename, 'wasm', expect.any(Object));
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ modelId: 'birefnet', device: 'wasm' });
  });
  it('uses a neutral model title and actual installed FP32 size without mislabeling it FP16', async () => {
    const state = useResources();
    vi.mocked(useResources).mockReturnValue({ ...state, models: { birefnet: {
      blob: { size: 191877254 } as Blob, name: 'model.onnx', importedAt: 1, provider: 'webgpu'
    } } });
    await act(async () => root.render(<BackgroundRemovalSettings english={false} />));
    const card = [...container.querySelectorAll('article')].find(article => article.querySelector('strong')?.textContent === 'BiRefNet Lite 512')!;
    expect(card.textContent).toContain('191.88 MB');
    expect(card.textContent).toContain('model.onnx');
    expect(container.querySelector('option[value="birefnet"]')?.textContent).toContain('191.9 MB');
    expect(card.querySelector('strong')?.textContent).not.toContain('FP16');
    expect([...card.querySelectorAll('button')].filter(button => button.textContent?.includes('下载 FP'))).toHaveLength(2);
    expect(card.querySelector('a')?.href).toBe('https://www.modelscope.cn/models/sangsq/birefnet-lite-512');
  });
  it.each(['fp32', 'fp16'] as const)('downloads MODNet %s in its own portrait card', async precision => {
    const card = [...container.querySelectorAll('article')].find(article => article.querySelector('strong')?.textContent === 'MODNet')!;
    expect(card.textContent).toContain('人像专用');
    expect(card.textContent).toContain('512 × 512');
    expect(card.textContent).toContain('CPU/WASM');
    vi.mocked(downloadModel).mockResolvedValue(new Blob(['portrait']));
    vi.mocked(installModel).mockResolvedValue();
    const button = [...card.querySelectorAll('button')].find(button => button.textContent?.includes(`下载 ${precision.toUpperCase()}`))!;
    await act(async () => button.click());
    expect(downloadModel).toHaveBeenCalledWith('modnet', expect.any(AbortSignal), expect.any(Function), precision);
    expect(installModel).toHaveBeenCalledWith('modnet', expect.any(Blob), precision === 'fp32' ? 'model.onnx' : 'model_fp16.onnx', 'wasm', expect.any(Object));
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ modelId: 'modnet', device: 'wasm' });
  });
  it('does not advertise an old MODNet GPU verification record as the active backend', async () => {
    vi.mocked(useResources).mockReturnValue({ ...useResources(), models: { modnet: {
      blob: new Blob(['model']), name: 'model.onnx', importedAt: 1, provider: 'webgpu'
    } } });
    await act(async () => root.render(<BackgroundRemovalSettings english={false} />));
    const card = [...container.querySelectorAll('article')].find(article => article.querySelector('strong')?.textContent === 'MODNet')!;
    expect(card.querySelector('.cf-removal-meta')?.textContent).toContain('CPU WASM');
    expect(card.querySelector('.cf-removal-meta')?.textContent).not.toContain('GPU 加速');
  });
  it('keeps previous selection when validation fails', async () => {
    vi.mocked(downloadModel).mockResolvedValue(new Blob(['model']));
    vi.mocked(installModel).mockRejectedValue(new Error('Unsupported model input'));
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('下载 FP16'))!.click());
    expect(saveSettings).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unsupported model input');
  });
});