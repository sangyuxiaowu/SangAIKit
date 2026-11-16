import { MODELS, type ModelId } from './models.ts';
import type { RemovalSettings, RuntimeFiles, StoredModel } from './types.ts';

let databaseName = 'sang-ai-kit-background-removal';
let storageUsed = false;
export const RUNTIME_VERSION = '1.23.2';
const RUNTIME_KEY = `runtime-${RUNTIME_VERSION}`;
const listeners = new Set<() => void>();

export function configureBackgroundRemovalStorage(options: { databaseName: string }): void {
  if (!options.databaseName.trim()) throw new Error('Background removal database name is required');
  if (storageUsed && options.databaseName !== databaseName) throw new Error('Background removal storage is already in use');
  databaseName = options.databaseName;
}

export function subscribeResources(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function access<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  storageUsed = true;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('resources');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('resources', mode);
    const request = operation(transaction.objectStore('resources'));
    transaction.oncomplete = () => {
      db.close();
      if (mode === 'readwrite') listeners.forEach(listener => listener());
      resolve(request.result as T);
    };
    transaction.onabort = transaction.onerror = () => {
      db.close();
      reject(transaction.error || request.error || new Error('Resource storage failed'));
    };
  });
}

export async function readSettings(): Promise<RemovalSettings> {
  const saved = await access<RemovalSettings | undefined>('readonly', store => store.get('settings'));
  return { modelId: MODELS.find(model => model.id === saved?.modelId)?.id ?? 'u2netp',
    device: saved?.device === 'wasm' || saved?.device === 'webgpu' ? saved.device : 'auto' };
}
export const saveSettings = (settings: RemovalSettings) => access('readwrite', store => store.put(settings, 'settings'));
const modelKey = (id: ModelId) => id === 'birefnet' ? 'model-birefnet-lite-512' : `model-${id}`;
export const readModel = (id: ModelId) => access<StoredModel | undefined>('readonly', store => store.get(modelKey(id)));
export const saveModel = (id: ModelId, model: StoredModel) => access('readwrite', store => store.put(model, modelKey(id)));
export const deleteModel = (id: ModelId) => access('readwrite', store => store.delete(modelKey(id)));
export const readRuntime = () => access<RuntimeFiles | undefined>('readonly', store => store.get(RUNTIME_KEY));
export const saveRuntime = (files: RuntimeFiles) => access('readwrite', store => store.put(files, RUNTIME_KEY));
export const deleteRuntime = () => access('readwrite', store => store.delete(RUNTIME_KEY));