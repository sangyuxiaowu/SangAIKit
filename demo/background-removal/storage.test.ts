import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { deleteModel, deleteRuntime, readModel, readRuntime, readSettings, saveModel, saveRuntime, saveSettings, subscribeResources } from '../../src/background-removal/storage.ts';
import { loadResources } from '../../src/background-removal/resources.ts';

describe('independent background-removal storage', () => {
  it('defaults to U2NetP selection and persists selection', async () => {
    expect(await readSettings()).toEqual({ modelId: 'u2netp', device: 'auto' });
    await saveSettings({ modelId: 'birefnet', device: 'wasm' });
    expect(await readSettings()).toEqual({ modelId: 'birefnet', device: 'wasm' });
  });
  it('stores binaries separately and notifies only committed writes', async () => {
    let changes = 0;
    const unsubscribe = subscribeResources(() => { changes++; });
    const blob = new Blob(['model-binary']);
    await saveModel('birefnet', { blob, name: 'updated-model.onnx', importedAt: 123, provider: 'wasm' });
    const restored = await readModel('birefnet');
    expect(await restored?.blob.text()).toBe('model-binary');
    expect(restored?.provider).toBe('wasm');
    expect(changes).toBe(1);
    await deleteModel('birefnet');
    expect(await readModel('birefnet')).toBeUndefined();
    expect(changes).toBe(2);
    unsubscribe();
  });
  it('persists MODNet selection and keeps its binary separate from BiRefNet', async () => {
    const previous = await readSettings();
    await saveSettings({ modelId: 'modnet', device: 'auto' });
    expect(await readSettings()).toEqual({ modelId: 'modnet', device: 'auto' });
    await saveModel('modnet', { blob: new Blob(['portrait']), name: 'model.onnx', importedAt: 1, provider: 'webgpu' });
    expect(await (await readModel('modnet'))?.blob.text()).toBe('portrait');
    await deleteModel('birefnet');
    expect(await readModel('modnet')).toBeDefined();
    await deleteModel('modnet');
    await saveSettings(previous);
  });
  it('keeps model deletion independent from runtime cache', async () => {
    await saveRuntime({ script: new Blob(['script']), loader: new Blob(['loader']), wasm: new Blob(['wasm']) });
    await deleteModel('u2netp');
    expect(await (await readRuntime())?.wasm.text()).toBe('wasm');
    await deleteRuntime();
    expect(await readRuntime()).toBeUndefined();
  });
  it('does not fetch an application-bundled U2NetP when the model is missing', async () => {
    await deleteModel('u2netp');
    await saveRuntime({ script: new Blob(['script']), loader: new Blob(['loader']), wasm: new Blob(['wasm']) });
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(loadResources('u2netp', new AbortController().signal)).rejects.toThrow('MODEL_MISSING');
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); await deleteRuntime(); }
  });
  it('does not reuse old 1024 or unrelated binaries under the Lite 512 profile', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sang-ai-kit-background-removal', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('resources', 'readwrite');
      transaction.objectStore('resources').put({ blob: new Blob(['old-model']), name: 'old.onnx', provider: 'wasm', importedAt: 1 }, 'model-birefnet');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    expect(await readModel('birefnet')).toBeUndefined();
    await saveModel('birefnet', { blob: new Blob(['lite-512']), name: 'model_fp16.onnx', provider: 'webgpu', importedAt: 2 });
    expect(await (await readModel('birefnet'))?.blob.text()).toBe('lite-512');
    await deleteModel('birefnet');
    expect(await readModel('birefnet')).toBeUndefined();
  });
});

it('allows a host database before first use and prevents switching afterwards', async () => {
  vi.resetModules();
  const storage = await import('../../src/background-removal/storage.ts');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('host-background-removal-test', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('resources');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('resources', 'readwrite');
    transaction.objectStore('resources').put({ modelId: 'modnet', device: 'wasm' }, 'settings');
    transaction.objectStore('resources').put({ blob: new Blob(['existing-model']), name: 'model.onnx', importedAt: 1, provider: 'wasm' }, 'model-modnet');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  expect(() => storage.configureBackgroundRemovalStorage({ databaseName: ' ' })).toThrow('name is required');
  storage.configureBackgroundRemovalStorage({ databaseName: 'host-background-removal-test' });
  expect(await storage.readSettings()).toEqual({ modelId: 'modnet', device: 'wasm' });
  expect(await (await storage.readModel('modnet'))?.blob.text()).toBe('existing-model');
  await storage.saveSettings({ modelId: 'u2netp', device: 'auto' });
  expect(await storage.readSettings()).toEqual({ modelId: 'u2netp', device: 'auto' });
  expect(() => storage.configureBackgroundRemovalStorage({ databaseName: 'host-background-removal-test' })).not.toThrow();
  expect(() => storage.configureBackgroundRemovalStorage({ databaseName: 'another-host' })).toThrow('already in use');
});