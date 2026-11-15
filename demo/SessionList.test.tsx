// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SessionList from '../src/SessionList';
import type { ChatSession } from '../src/sessionTypes';

it('portals the half-page gallery preview above a transformed AI panel', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:gallery-preview' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  const panel = document.createElement('div');
  panel.className = 'cf-ai-panel';
  panel.style.transform = 'translateZ(0)';
  panel.style.overflow = 'hidden';
  document.body.appendChild(panel);
  const root = createRoot(panel);
  const session: ChatSession = {
    id: 'session-1', title: 'Preview chat', updatedAt: 1,
    entries: [{ content: 'image', images: [{ id: 'image-1', name: 'preview.png', type: 'image/png', size: 12 }] }]
  };
  try {
    await act(async () => root.render(<SessionList
      sessions={[session]}
      activeId={session.id}
      disabled={false}
      english={false}
      onNew={async () => {}}
      onSelect={async () => {}}
      onRename={async () => {}}
      onDelete={async () => {}}
      onLoadImage={async () => new Blob(['image'], { type: 'image/png' })}
    />));
    const galleryCard = [...panel.querySelectorAll('[role="button"]')].find(element => element.textContent?.includes('图片资产'));
    await act(async () => { galleryCard?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const image = panel.querySelector<HTMLImageElement>('img[alt="preview.png"]');
    expect(image).toBeTruthy();
    await act(async () => { image!.closest('.group')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const portal = document.body.querySelector<HTMLElement>('.sang-ai-portal');
    const dialog = portal?.querySelector<HTMLElement>('[role="dialog"]');
    expect(portal?.parentElement).toBe(document.body);
    expect(panel.contains(portal)).toBe(false);
    expect(portal?.className).toContain('z-[130]');
    expect(dialog?.className).toContain('w-[92vw]');
    expect(dialog?.className).toContain('rounded-2xl');
    expect(dialog?.className).toContain('sm:w-[min(56vw,900px)]');
    expect(dialog?.className).toContain('h-[min(72dvh,720px)]');

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(document.body.querySelector('.sang-ai-portal')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    panel.remove();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
    vi.unstubAllGlobals();
  }
});
