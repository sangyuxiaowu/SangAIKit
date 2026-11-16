// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SessionList, { type GalleryInsertAction } from '../src/SessionList';
import { ResolvedThemeContext } from '../src/useResolvedTheme';
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
  const render = (theme: 'light' | 'dark') => <ResolvedThemeContext.Provider value={theme}><SessionList
    sessions={[session]}
    activeId={session.id}
    disabled={false}
    english={false}
    onNew={async () => {}}
    onSelect={async () => {}}
    onRename={async () => {}}
    onDelete={async () => {}}
    onLoadImage={async () => new Blob(['image'], { type: 'image/png' })}
  /></ResolvedThemeContext.Provider>;
  try {
    await act(async () => root.render(render('light')));
    const galleryCard = [...panel.querySelectorAll('[role="button"]')].find(element => element.textContent?.includes('图片资产'));
    await act(async () => { galleryCard?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const image = panel.querySelector<HTMLImageElement>('img[alt="preview.png"]');
    expect(image).toBeTruthy();
    await act(async () => { image!.closest('.group')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const portal = document.body.querySelector<HTMLElement>('.sang-ai-portal');
    const dialog = portal?.querySelector<HTMLElement>('[role="dialog"]');
    expect(portal?.parentElement).toBe(document.body);
    expect(portal?.dataset.theme).toBe('light');
    expect(panel.contains(portal)).toBe(false);
    expect(portal?.className).toContain('z-[130]');
    expect(dialog?.className).toContain('w-[92vw]');
    expect(dialog?.className).toContain('rounded-2xl');
    expect(dialog?.className).toContain('sm:w-[min(56vw,900px)]');
    expect(dialog?.className).toContain('h-[min(72dvh,720px)]');

    const otherPanel = document.createElement('div');
    otherPanel.className = 'cf-ai-panel';
    otherPanel.dataset.theme = 'light';
    document.body.appendChild(otherPanel);
    try {
      await act(async () => root.render(render('dark')));
      expect(portal?.dataset.theme).toBe('dark');
    } finally {
      otherPanel.remove();
    }

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

it('selects and inverts only the current category and confirms before deleting', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const onDeleteImages = vi.fn(async () => true);
  const session: ChatSession = {
    id: 'session', title: 'Test', updatedAt: 1,
    entries: [{ content: '', images: [
      { id: 'p1', name: 'canvas-preview-1.webp', type: 'image/webp', size: 100 },
      { id: 'p2', name: 'canvas-preview-2.webp', type: 'image/webp', size: 200 },
      { id: 'gen', name: 'generated-1.png', type: 'image/png', size: 300 }
    ] }]
  };
  const click = async (selector: string) => {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element, selector).not.toBeNull();
    await act(async () => { element!.click(); });
  };
  try {
    await act(async () => { root.render(<SessionList sessions={[session]} activeId="session" disabled={false} english={false} onNew={async () => {}} onSelect={async () => {}} onRename={async () => {}} onDelete={async () => {}} onDeleteImages={onDeleteImages} classifyGalleryImage={image => image.name.includes('preview') ? 'preview' : undefined} />); });
    await click('[title="点击打开图片画廊并预览保存"]');
    await click('[title="预览图片"]');
    await click('[aria-label="批量选择"]');
    await click('[aria-label="全选当前分类"]');
    expect(host.querySelectorAll('input:checked')).toHaveLength(2);
    await click('[aria-label="反选当前分类"]');
    expect(host.querySelectorAll('input:checked')).toHaveLength(0);
    await click('input[type="checkbox"]');
    await click('[aria-label="反选当前分类"]');
    expect(host.querySelector<HTMLInputElement>('input:checked')?.getAttribute('aria-label')).toContain('preview-2');
    await click('[aria-label="删除选中图片"]');
    expect(onDeleteImages).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('1 张图片');
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === '确认删除')!;
    await act(async () => { confirm.click(); });
    expect(onDeleteImages).toHaveBeenCalledWith([{ sessionId: 'session', imageId: 'p2' }]);
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    await click('[title="显示所有图片素材"]');
    expect(host.querySelectorAll('input:checked')).toHaveLength(0);
  } finally {
    await act(async () => { root.unmount(); });
    vi.unstubAllGlobals();
  }
});

it('offers insertion for generated and attachment images but not previews', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const onInsertImage = vi.fn(async () => true);
  const session: ChatSession = {
    id: 'session', title: 'Test', updatedAt: 1,
    entries: [
      { content: 'upload attachment', images: [{ id: 'att1', name: 'logo.png', type: 'image/png', size: 120 }] },
      { content: '', images: [{ id: 'p1', name: 'canvas-preview-1.webp', type: 'image/webp', size: 100 }],
        tools: [{ name: 'generate_image', arguments: JSON.stringify({ prompt: 'test image' }),
          image: { id: 'gen1', name: 'generated-1.png', type: 'image/png', size: 300 } }] }
    ]
  };
  try {
    await act(async () => root.render(<SessionList sessions={[session]} activeId="session" disabled={false} english={false}
      imageInsertAction={{ label: '插入到当前画布' }} classifyGalleryImage={image => image.name.includes('preview') ? 'preview' : undefined}
      onNew={async () => {}} onSelect={async () => {}} onRename={async () => {}} onDelete={async () => {}} onInsertImage={onInsertImage} />));
    await act(async () => { host.querySelector<HTMLElement>('[title="点击打开图片画廊并预览保存"]')!.click(); });
    const insertButtons = host.querySelectorAll<HTMLButtonElement>('[title="插入到当前画布"]');
    expect(insertButtons).toHaveLength(2);
    await act(async () => { insertButtons[0].click(); });
    expect(onInsertImage).toHaveBeenCalledWith({ sessionId: 'session', imageId: 'att1', name: 'logo.png', category: 'attachment', prompt: undefined });
    await act(async () => { insertButtons[1].click(); });
    expect(onInsertImage).toHaveBeenCalledWith({ sessionId: 'session', imageId: 'gen1', name: 'generated-1.png', category: 'generated', prompt: 'test image' });
  } finally {
    await act(async () => { root.unmount(); });
    vi.unstubAllGlobals();
  }
});
