// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ColorMattingEditor from '../../src/background-removal/ColorMattingEditor';
import { removeColorBackground } from '../../src/background-removal/colorMatting';

vi.mock('../../src/background-removal/colorMatting', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/background-removal/colorMatting')>(),
  removeColorBackground: vi.fn()
}));

it('passes original-resolution strokes to the worker and preserves them across color changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ImageData', class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2000, height: 1000, close: vi.fn() })));
  const context = {
    drawImage: vi.fn(), putImageData: vi.fn(),
    getImageData: vi.fn(() => new ImageData(new Uint8ClampedArray(800 * 400 * 4).fill(255), 800, 400))
  };
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const bounds = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 200, height: 100 } as DOMRect);
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  const host = document.createElement('div');
  const root = createRoot(host);
  const output = new Blob(['output']);
  const onApply = vi.fn();
  const onClose = vi.fn();
  vi.mocked(removeColorBackground).mockResolvedValue(output);
  try {
    await act(async () => root.render(<ColorMattingEditor image={new Blob(['image'])} onApply={onApply} onClose={onClose} />));
    const canvas = host.querySelector('canvas')!;
    const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    await act(async () => button('擦除').click());
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 60, clientY: 45 }));
      canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 110, clientY: 70 }));
      canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(button('撤销笔迹').disabled).toBe(false);
    await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent === '应用')!.click());
    expect(removeColorBackground).toHaveBeenCalledWith(expect.any(Blob), expect.any(Object), expect.any(AbortSignal), {
      colorMatting: false, strokes: [{ mode: 'erase', radius: 18, points: [{ x: 500, y: 250 }, { x: 1000, y: 500 }] }]
    });
    expect(onApply).toHaveBeenCalledWith(output, expect.any(AbortSignal));
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => button('撤销笔迹').click());
    expect(button('撤销笔迹').disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    getContext.mockRestore();
    bounds.mockRestore();
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'setPointerCapture');
    vi.unstubAllGlobals();
  }
});