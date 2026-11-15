// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SessionList, { type GalleryInsertAction } from '../src/SessionList';
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

it('lets the host update gallery action visibility, labels and availability in both views', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:gallery-image' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onInsertImage = vi.fn(async () => {});
  const session: ChatSession = {
    id: 'session', title: 'Document', updatedAt: 1,
    entries: [{ content: '', images: [{ id: 'image', name: 'layer-photo.png', type: 'image/png', size: 12 }] }]
  };
  const render = async (action: GalleryInsertAction, callback = onInsertImage) => {
    await act(async () => root.render(<SessionList sessions={[session]} activeId="session" disabled={false} english={true}
      onNew={async () => {}} onSelect={async () => {}} onRename={async () => {}} onDelete={async () => {}}
      onLoadImage={async () => new Blob(['image'])} onInsertImage={callback} imageInsertAction={action} />));
  };
  try {
    await render({ visible: false, label: 'Insert at cursor' });
    const galleryCard = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(element => element.textContent?.includes('Image Assets'));
    expect(galleryCard).toBeTruthy();
    await act(async () => { galleryCard!.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector('[aria-label="Insert at cursor: layer-photo.png"]')).toBeNull();

    await render({ enabled: false, label: 'Insert at cursor', disabledReason: 'Select a document' });
    const thumbnailButton = host.querySelector<HTMLButtonElement>('[aria-label="Insert at cursor: layer-photo.png"]')!;
    expect(thumbnailButton.disabled).toBe(true);
    expect(thumbnailButton.title).toBe('Select a document');
    await act(async () => { host.querySelector<HTMLImageElement>('img[alt="layer-photo.png"]')!.closest<HTMLElement>('.group')!.click(); });
    expect(document.querySelector<HTMLButtonElement>('[role="dialog"] button[title="Select a document"]')?.disabled).toBe(true);

    await render({ label: 'Insert at cursor', successLabel: 'Added to document' });
    const previewButton = document.querySelector<HTMLButtonElement>('[role="dialog"] button[title="Insert at cursor"]')!;
    await act(async () => { previewButton.click(); });
    expect(onInsertImage).toHaveBeenCalledWith({ sessionId: 'session', imageId: 'image', name: 'layer-photo.png', category: 'attachment', prompt: undefined });
    expect(previewButton.textContent).toContain('Added to document');
    expect(thumbnailButton.title).toBe('Added to document');
    await render({ visible: false });
    expect(document.querySelector('[role="dialog"] button[title="Added to document"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
    vi.unstubAllGlobals();
  }
});

it('allows host-defined preview classification and action visibility with generic error fallback', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const session: ChatSession = {
    id: 'session', title: 'Chat', updatedAt: 1,
    entries: [{ content: '', tools: [{ name: 'render_document', arguments: '{}', image: { id: 'image', name: 'result.png', type: 'image/png', size: 12 } }] }]
  };
  const onInsertImage = vi.fn(async () => { throw 'failed'; });
  try {
    await act(async () => root.render(<SessionList sessions={[session]} activeId="session" disabled={false} english={true}
      onNew={async () => {}} onSelect={async () => {}} onRename={async () => {}} onDelete={async () => {}}
      classifyGalleryImage={(_, tools) => tools.some(tool => tool.name === 'render_document') ? 'preview' : undefined}
      imageInsertAction={{ isVisible: item => item.category === 'preview' }} onInsertImage={onInsertImage} />));
    const galleryCard = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(element => element.textContent?.includes('Image Assets'));
    expect(galleryCard).toBeTruthy();
    await act(async () => { galleryCard!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Insert image: result.png"]')!.click(); });
    expect(onInsertImage).toHaveBeenCalledWith(expect.objectContaining({ category: 'preview' }));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Failed to insert image.');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
