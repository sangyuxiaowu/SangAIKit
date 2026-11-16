export interface AiFeatures {
  imageGeneration: boolean;
  skills: boolean;
  quickSnippets: boolean;
  fontManagement: boolean;
  onlineFonts: boolean;
  backgroundRemoval: boolean;
}

export const DEFAULT_AI_FEATURES: Readonly<AiFeatures> = {
  imageGeneration: true,
  skills: true,
  quickSnippets: true,
  fontManagement: true,
  onlineFonts: true,
  backgroundRemoval: true
};

export function normalizeAiFeatures(value: unknown): AiFeatures {
  if (value === undefined) return { ...DEFAULT_AI_FEATURES };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI feature settings.');
  const result = { ...DEFAULT_AI_FEATURES };
  for (const key of Object.keys(result) as (keyof AiFeatures)[]) {
    const setting = (value as Record<string, unknown>)[key];
    if (setting !== undefined && typeof setting !== 'boolean') throw new Error(`Invalid AI feature setting: ${key}.`);
    if (typeof setting === 'boolean') result[key] = setting;
  }
  return result;
}