import type { ReactNode } from 'react';
import type { ReasoningEffort } from './ModelControls';
import type { AssistantTheme } from './useResolvedTheme';
import type { AiFeatures } from './features';

export interface AiModelConfig {
  id: string; label: string; modelId: string; maxTokens: number; contextWindow: number;
  thinkingAvailable: boolean; supportsVision: boolean; supportedReasoningEfforts: ReasoningEffort[];
  thinkingEnabled: boolean; reasoningEffort: ReasoningEffort; defaultThinkingEnabled?: boolean;
  defaultReasoningEffort?: ReasoningEffort; temperature?: number;
}
export interface AiEndpointConfig { id: string; name: string; endpoint: string; apiKey: string; models: AiModelConfig[] }
export interface AiSkillConfig { name: string; description: string; content: string }
export interface LocalFontSelection { family: string; fullName: string; styles: string[]; description?: string }
export interface ImageModelConfig {
  id: string; adapter: 'kolors' | 'agnes' | 'gpt-image'; label: string; description: string; modelId: string;
  version?: string; releasedAt?: string; endpointId: string; requestUrl: string; enabled: boolean;
  size: string; ratio: string; steps: number; guidance: number;
  quality?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto'; n?: number; timeoutSeconds?: number;
}
export interface AiConfig {
  endpoints: AiEndpointConfig[]; imageModels?: ImageModelConfig[];
  activeSelection: { endpointId: string; modelId: string }; systemPrompt: string; imageToolPrompt?: string;
  skills?: AiSkillConfig[]; localFonts?: LocalFontSelection[]; quickSnippets?: string[];
  maxToolRounds?: number; maxImageFailures?: number;
}
export type EncryptionStatus = 'missing' | 'ready' | 'locked';
export interface EncryptionManager {
  status: () => Promise<EncryptionStatus>;
  generate: (mode: 'create' | 'rotate' | 'reset') => Promise<Uint8Array<ArrayBuffer>>;
  import: (key: CryptoKey) => Promise<void>;
}

export interface SettingsProps {
  config: AiConfig;
  onSave: (config: AiConfig) => Promise<void>;
  onBack: () => void;
  english: boolean;
  theme?: AssistantTheme;
  features?: Partial<AiFeatures>;
  store: { encryption?: EncryptionManager; loadConfig: () => Promise<AiConfig> };
  onKeyChanged: () => Promise<void>;
  initialSecurity?: boolean;
  showTurnLimits?: boolean;
  supportsVision?: boolean;
  recommendedSnippets?: string[];
  notice?: ReactNode;
  createEndpoint: (provider: 'openai' | 'deepseek' | 'local' | 'custom') => AiEndpointConfig;
  createModel: (modelId: string) => AiModelConfig;
  normalizeConfig: (config: AiConfig) => AiConfig;
  resolveSelection: (config: AiConfig) => { endpoint: AiEndpointConfig; model: AiModelConfig };
  defaults: { systemPrompt: string; imageToolPrompt: string; quickSnippets: string[]; maxToolRounds: number; maxImageFailures: number };
  renderImageModels?: (config: AiConfig, onChange: (config: AiConfig) => void, english: boolean) => ReactNode;
  renderBackgroundRemoval?: (english: boolean) => ReactNode;
  renderFonts?: (fonts: LocalFontSelection[], onChange: (fonts: LocalFontSelection[]) => void, english: boolean, enabled: { localFonts: boolean; onlineFonts: boolean }) => ReactNode;
  renderSkills?: (skills: AiSkillConfig[], onChange: (skills: AiSkillConfig[]) => Promise<void>, english: boolean) => ReactNode;
  renderEncryption?: (manager: EncryptionManager, callbacks: { onStatus: (status: EncryptionStatus) => void; onBusy: (busy: boolean) => void; onBackupPending: (pending: boolean) => void; onChanged: () => Promise<void> }, english: boolean) => ReactNode;
}