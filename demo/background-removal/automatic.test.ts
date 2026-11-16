import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installModel, removeBackground } from '../../src/background-removal/index.ts';
import { createBackgroundRemovalTool } from '../../src/background-removal/tool.ts';
import { createBuiltInTools } from '../../src/builtInTools.ts';
import { deleteModel, deleteRuntime, readModel, readRuntime } from '../../src/background-removal/storage.ts';
import type { WorkerRequest, WorkerResponse } from '../../src/background-removal/types.ts';

const jobs: WorkerRequest[] = [];
class TestWorker {
  onmessage?: (event: { data: WorkerResponse }) => void;
  onerror?: unknown;
  terminate() {}
  postMessage(request: WorkerRequest) {
    jobs.push(request);
    queueMicrotask(() => this.onmessage?.({ data: { type: 'result', blob: new Blob(['removed'], { type: 'image/png' }), provider: 'wasm' } }));
  }
}
beforeEach(async () => {
  jobs.length = 0;
  await Promise.all([deleteRuntime(), deleteModel('u2netp'), deleteModel('modnet')]);
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal('document', { createElement: () => ({
    width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect() {} }),
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['sample'], { type: 'image/png' }))
  }) });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('.wasm')) return new Response(new Uint8Array([0, 97, 115, 109, 1]));
    if (url.includes('.onnx')) return new Response(new Uint8Array(1024));
    return new Response('export default {};'.repeat(100));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('automatic local removal resources', () => {
  it('passes nested color options to the worker and preserves omitted defaults', async () => {
    const postMessage = vi.spyOn(TestWorker.prototype, 'postMessage');
    const tool = createBackgroundRemovalTool({
      loadImage: async () => new Blob(['source']),
      saveImage: async (blob, name) => ({ id: 'result', name, type: 'image/png', size: blob.size })
    });
    for (const [colorOptions, expected] of [
      [undefined, { targetColor: [255, 255, 255], tolerance: 25, feather: 1.5, contiguous: true }],
      [{ tolerance: 0 }, { targetColor: [255, 255, 255], tolerance: 0, feather: 1.5, contiguous: true }],
      [{ color: '#12abEF', tolerance: 100, feather: 0, contiguous: false }, { targetColor: [18, 171, 239], tolerance: 100, feather: 0, contiguous: false }]
    ] as const) {
      await expect(tool.execute({ imageId: 'source', modelId: 'color', colorOptions }, new AbortController().signal)).resolves.toMatchObject({ modelId: 'color' });
      expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ options: expected }));
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects flat, malformed and unknown color options before reading images', async () => {
    const loadImage = vi.fn(async () => new Blob(['source']));
    const tool = createBackgroundRemovalTool({ loadImage, saveImage: vi.fn() });
    for (const args of [
      { color: '#ffffff' }, { tolerance: 20 }, { feather: 1 }, { contiguous: false },
      ...[null, [], 'white', { unexpected: true }, { color: 'white' }, { tolerance: 101 }, { feather: -1 }, { contiguous: 'true' }]
        .map(colorOptions => ({ colorOptions }))
    ]) {
      await expect(tool.execute({ imageId: 'source', modelId: 'color', ...args }, new AbortController().signal)).rejects.toThrow();
    }
    expect(loadImage).not.toHaveBeenCalled();
  });
  it('prepares runtime for manual model installation without requiring a separate setup step', async () => {
    await installModel('u2netp', new Blob([new Uint8Array(1024)]), 'manual.onnx', 'auto', { signal: new AbortController().signal });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(jobs).toHaveLength(1);
    expect(await readModel('u2netp')).toMatchObject({ name: 'manual.onnx' });
  });
  it('downloads missing resources, verifies and caches the model, then reuses them for manual removal', async () => {
    const progress = vi.fn();
    const source = new Blob(['original']);
    await removeBackground(source, { modelId: 'u2netp', device: 'auto', signal: new AbortController().signal, onProgress: progress });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(jobs).toHaveLength(2);
    expect(jobs[1].image).toBe(source);
    expect(await readRuntime()).toBeDefined();
    expect(await readModel('u2netp')).toMatchObject({ provider: 'wasm', name: 'u2netp.onnx' });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'runtime_download' }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'download' }));
    expect(progress).toHaveBeenCalledWith({ stage: 'verify' });
    await removeBackground(source, { modelId: 'u2netp', device: 'auto', signal: new AbortController().signal });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(jobs).toHaveLength(3);
  });
  it('uses the same automatic entry from the tool, defaults to U2NetP and saves a session image only', async () => {
    const saveImage = vi.fn(async (blob: Blob, name: string) => ({ id: 'result', name, type: 'image/png' as const, size: blob.size }));
    const tool = createBackgroundRemovalTool({ loadImage: async () => new Blob(['original']), saveImage });
    const result = await tool.execute({ imageId: 'source' }, new AbortController().signal);
    expect(result).toMatchObject({ image: { id: 'result' }, modelId: 'u2netp' });
    expect(jobs.at(-1)).toMatchObject({ modelId: 'u2netp', device: 'auto' });
    expect(saveImage).toHaveBeenCalledOnce();
  });
  it('accepts a host-provided original and returns the processed blob to the host without saving a session image', async () => {
    const source = new Blob(['original'], { type: 'image/png' });
    const saveImage = vi.fn(async (blob: Blob, name: string) => ({ id: 'result', name, type: 'image/png' as const, size: blob.size }));
    const complete = vi.fn(async result => ({ layerId: 'copy', model: result.model }));
    const tool = createBackgroundRemovalTool({ saveImage, extension: {
      description: '宿主抠图', properties: { layerId: { type: 'string' } }, required: ['layerId'], optional: ['imageId'],
      prepare: async () => ({ inputImage: source, complete })
    } });
    expect(tool.parameters.required).toEqual(['layerId']);
    await expect(tool.execute({ layerId: 'source' }, new AbortController().signal)).resolves.toEqual({ layerId: 'copy', model: 'u2netp' });
    expect(jobs.at(-1)?.image).toBe(source);
    expect(complete).toHaveBeenCalledOnce();
    expect(saveImage).not.toHaveBeenCalled();
  });
  it('preserves a failed host result and blocks repeating removal in the same turn', async () => {
    const saveImage = vi.fn(async (blob: Blob, name: string) => ({ id: 'recovery', name, type: 'image/png' as const, size: blob.size }));
    const tool = createBuiltInTools({
      config: { endpoints: [], activeSelection: { endpointId: '', modelId: '' }, systemPrompt: '' },
      saveImage, imageExtensions: { remove_background: {
        description: '宿主抠图', properties: { layerId: { type: 'string' } }, required: ['layerId'], optional: ['imageId'],
        prepare: async () => ({ inputImage: new Blob(['source']), complete: async () => { throw new Error('Canvas failed'); } })
      } }
    }).tools.find(item => item.name === 'remove_background')!;
    await expect(tool.execute({ layerId: 'source' }, new AbortController().signal)).rejects.toThrow('Recovery image IDs: recovery');
    await expect(tool.execute({ layerId: 'source' }, new AbortController().signal)).rejects.toThrow('Do not retry');
    expect(jobs).toHaveLength(2);
    expect(saveImage).toHaveBeenCalledOnce();
  });
  it('reports failed model downloads without caching a partial model and permits retry', async () => {
    const goodFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('.onnx')
      ? new Response('', { status: 503 }) : goodFetch(url)));
    const options = { modelId: 'modnet' as const, device: 'auto' as const, signal: new AbortController().signal };
    await expect(removeBackground(new Blob(['image']), options)).rejects.toThrow('503');
    expect(await readModel('modnet')).toBeUndefined();
    expect(jobs).toHaveLength(0);
    vi.stubGlobal('fetch', goodFetch);
    await expect(removeBackground(new Blob(['image']), options)).resolves.toMatchObject({ modelId: 'modnet' });
  });
  it('reports runtime download errors before downloading a model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(removeBackground(new Blob(['image']), { signal: new AbortController().signal })).rejects.toThrow('运行时下载失败');
    expect(fetch).toHaveBeenCalledOnce();
    expect(jobs).toHaveLength(0);
    expect(await readRuntime()).toBeUndefined();
  });
  it('cancels resource downloads without inference or result saving', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
      controller.abort(new Error('Stopped'));
    })));
    const saveImage = vi.fn();
    const tool = createBackgroundRemovalTool({ loadImage: async () => new Blob(['source']), saveImage });
    await expect(tool.execute({ imageId: 'source' }, controller.signal)).rejects.toThrow('Stopped');
    expect(jobs).toHaveLength(0);
    expect(saveImage).not.toHaveBeenCalled();
    expect(await readModel('u2netp')).toBeUndefined();
  });
});
