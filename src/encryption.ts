export interface KeyBackupOptions { format: string; context: string; iterations?: number }

const encode = (bytes: Uint8Array<ArrayBuffer>) => btoa(String.fromCharCode(...bytes));
function decode(value: unknown, length: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > 128) throw new Error('Invalid encryption key backup.');
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (bytes.length !== length) throw new Error('Invalid encryption key backup.');
  return bytes;
}

export async function generateEncryptionKey(): Promise<{ key: CryptoKey; bytes: Uint8Array<ArrayBuffer> }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return { bytes, key: await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']) };
}

export function createKeyBackupCodec(options: KeyBackupOptions) {
  const iterations = options.iterations ?? 600_000;
  if (!options.format || !options.context || !Number.isSafeInteger(iterations) || iterations < 600_000) throw new Error('Invalid key backup options.');
  const context = new TextEncoder().encode(options.context);
  async function backupKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  return {
    async createKeyBackup(bytes: Uint8Array<ArrayBuffer>, password: string): Promise<string> {
      if (bytes.length !== 32) throw new Error('Invalid encryption key.');
      if (password.length < 12 || password.length > 1024) throw new Error('Use a backup password of 12 to 1024 characters.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await backupKey(password, salt);
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context }, key, bytes);
      return JSON.stringify({ format: options.format, version: 1, kdf: 'PBKDF2-SHA256', iterations,
        salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }, null, 2);
    },
    async readKeyBackup(content: string, password: string): Promise<CryptoKey> {
      if (content.length > 4096 || password.length > 1024) throw new Error('Invalid encryption key backup.');
      const value = JSON.parse(content);
      if (!value || value.format !== options.format || value.version !== 1 || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== iterations) throw new Error('Unsupported encryption key backup.');
      const salt = decode(value.salt, 16);
      const iv = decode(value.iv, 12);
      const ciphertext = decode(value.ciphertext, 48);
      const key = await backupKey(password, salt);
      let bytes: ArrayBuffer;
      try { bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: context }, key, ciphertext); }
      catch { throw new Error('Incorrect backup password or damaged key file.'); }
      try { return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }
      finally { new Uint8Array(bytes).fill(0); }
    }
  };
}