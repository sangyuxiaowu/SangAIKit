import { ConfigDecryptionError, createAiConfigStore, type StoredChatSession } from './configStore';
import { generateEncryptionKey } from './encryption';
import type { AiConfig, EncryptionManager } from './settingsTypes';

export function createBrowserAiStore<Session extends StoredChatSession>(options: {
  databaseName: string;
  defaultConfig: () => AiConfig;
  normalizeConfig: (config: AiConfig) => AiConfig;
}) {
  const database = createAiConfigStore<Session>(options.databaseName);
  const loadConfig = async () => options.normalizeConfig(await database.loadStoredConfig() ?? options.defaultConfig());
  const encryption: EncryptionManager = {
    status: async () => {
      try { await loadConfig(); }
      catch (error) { if (error instanceof ConfigDecryptionError) return 'locked'; throw error; }
      return await database.readEncryptionKey() ? 'ready' : 'missing';
    },
    generate: async mode => {
      const current = await encryption.status();
      if ((mode === 'create' && current !== 'missing') || (mode === 'rotate' && current !== 'ready') || (mode === 'reset' && current !== 'locked')) throw new Error('Encryption key status changed. Reload settings before continuing.');
      const generated = await generateEncryptionKey();
      try {
        if (mode === 'create') await database.replaceEncryptionKey(generated.key, false, true);
        else await database.replaceEncryptionKey(generated.key, mode === 'reset');
        return generated.bytes;
      } catch (error) { generated.bytes.fill(0); throw error; }
    },
    import: async key => {
      if (key.extractable || key.algorithm.name !== 'AES-GCM' || (key.algorithm as AesKeyAlgorithm).length !== 256) throw new Error('Invalid encryption key.');
      await database.verifyStoredEncryptionKey(key);
      await database.replaceEncryptionKey(key, false);
    }
  };
  return {
    ...database,
    encryption,
    loadConfig,
    saveConfig: async (config: AiConfig) => {
      const normalized = options.normalizeConfig(config);
      await loadConfig();
      await database.saveStoredConfig(normalized);
    }
  };
}