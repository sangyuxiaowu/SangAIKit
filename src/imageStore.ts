export interface ImageStore {
  saveImage: (sessionId: string, imageId: string, blob: Blob) => Promise<void>;
  loadImage: (sessionId: string, imageId: string) => Promise<Blob | null>;
  deleteImages: (images: { sessionId: string; imageId: string }[]) => Promise<void>;
  deleteSessionImages: (sessionId: string) => Promise<void>;
}

export function createIndexedDbImageStore(databaseName: string): ImageStore {
  if (!databaseName.trim()) throw new Error('Image database name is required.');
  let databasePromise: Promise<IDBDatabase> | undefined;
  const database = () => {
    if (!databasePromise) databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: ['sessionId', 'imageId'] }).createIndex('sessionId', 'sessionId');
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); databasePromise = undefined; }; resolve(request.result); };
      request.onerror = () => reject(request.error || new Error('Unable to open image storage.'));
      request.onblocked = () => reject(new Error('Image storage is blocked by another tab.'));
    }).catch(error => { databasePromise = undefined; throw error; });
    return databasePromise;
  };
  const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Image storage failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Image storage was aborted.'));
  });
  return {
    async saveImage(sessionId, imageId, blob) {
      const db = await database();
      const transaction = db.transaction('images', 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore('images').put({ sessionId, imageId, blob });
      await done;
    },
    async loadImage(sessionId, imageId) {
      const db = await database();
      const transaction = db.transaction('images', 'readonly');
      const done = transactionDone(transaction);
      const request = transaction.objectStore('images').get([sessionId, imageId]);
      const item = await new Promise<{ blob: Blob } | undefined>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await done;
      return item?.blob || null;
    },
    async deleteImages(images) {
      const db = await database();
      const transaction = db.transaction('images', 'readwrite');
      const done = transactionDone(transaction);
      for (const image of images) transaction.objectStore('images').delete([image.sessionId, image.imageId]);
      await done;
    },
    async deleteSessionImages(sessionId) {
      const db = await database();
      const transaction = db.transaction('images', 'readwrite');
      const done = transactionDone(transaction);
      const request = transaction.objectStore('images').index('sessionId').openKeyCursor(IDBKeyRange.only(sessionId));
      request.onsuccess = () => { const cursor = request.result; if (cursor) { transaction.objectStore('images').delete(cursor.primaryKey); cursor.continue(); } };
      await done;
    }
  };
}