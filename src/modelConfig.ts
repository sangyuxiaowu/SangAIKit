import type { AiConfig, AiEndpointConfig, AiModelConfig } from './settingsTypes';
import { normalizeSkills } from './skills';
import { normalizeLocalFonts } from './fonts';
import { validateImageModel } from './image-generation/index';

export const DEFAULT_SETTINGS = {
  systemPrompt: 'You are a helpful assistant.',
  imageToolPrompt: '',
  quickSnippets: [] as string[],
  maxToolRounds: 24,
  maxImageFailures: 3
};

export function createModel(modelId = 'gpt-4o-mini'): AiModelConfig {
  return { id: crypto.randomUUID(), label: modelId, modelId, maxTokens: 4096, contextWindow: 128000,
    thinkingAvailable: false, supportsVision: false, supportedReasoningEfforts: ['none', 'low', 'medium', 'high'],
    thinkingEnabled: false, reasoningEffort: 'none', defaultReasoningEffort: 'medium' };
}

export function createEndpoint(provider: 'openai' | 'deepseek' | 'local' | 'custom' = 'custom'): AiEndpointConfig {
  const preset = provider === 'deepseek' ? { name: 'DeepSeek', endpoint: 'https://api.deepseek.com', model: 'deepseek-chat' }
    : provider === 'local' ? { name: 'Ollama', endpoint: 'http://localhost:11434/v1', model: 'qwen3' }
      : { name: provider === 'custom' ? 'Custom' : 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };
  return { id: crypto.randomUUID(), name: preset.name, endpoint: preset.endpoint, apiKey: '', models: [createModel(preset.model)] };
}

export function resolveSelection(config: AiConfig) {
  const endpoint = config.endpoints.find(item => item.id === config.activeSelection.endpointId) || config.endpoints[0];
  if (!endpoint?.models.length) throw new Error('Configure at least one endpoint and model.');
  return { endpoint, model: endpoint.models.find(item => item.id === config.activeSelection.modelId) || endpoint.models[0] };
}

export function selectModel(config: AiConfig, endpointId: string, modelId: string): AiConfig {
  if (!config.endpoints.some(endpoint => endpoint.id === endpointId && endpoint.models.some(model => model.id === modelId))) throw new Error('Model not found.');
  return { ...config, activeSelection: { endpointId, modelId } };
}

export function updateActiveModel(config: AiConfig, patch: Partial<Pick<AiModelConfig, 'thinkingEnabled' | 'reasoningEffort'>>): AiConfig {
  const { endpoint, model } = resolveSelection(config);
  return { ...config, endpoints: config.endpoints.map(item => item.id !== endpoint.id ? item : {
    ...item, models: item.models.map(candidate => candidate.id !== model.id ? candidate : { ...candidate, ...patch })
  }) };
}

export function normalizeConfig(config: AiConfig): AiConfig {
  if (!config.endpoints.length || config.endpoints.some(endpoint => !endpoint.models.length)) throw new Error('Configure at least one endpoint and model.');
  const endpointIds = new Set<string>();
  for (const endpoint of config.endpoints) {
    if (!endpoint.id || endpointIds.has(endpoint.id)) throw new Error('Endpoint IDs must be unique.');
    endpointIds.add(endpoint.id);
    const url = new URL(endpoint.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /\/(?:responses|chat\/completions)\/?$/i.test(url.pathname)) throw new Error('Invalid endpoint base URL.');
    if (new Set(endpoint.models.map(model => model.id)).size !== endpoint.models.length || endpoint.models.some(model => !model.id)) throw new Error('Model IDs must be unique within an endpoint.');
    if (endpoint.models.some(model => !model.modelId.trim() || !Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1 || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1)) throw new Error('Invalid model configuration.');
  }
  if (!config.endpoints.some(endpoint => endpoint.id === config.activeSelection.endpointId && endpoint.models.some(model => model.id === config.activeSelection.modelId))) throw new Error('Active model not found.');
  for (const limit of [config.maxToolRounds, config.maxImageFailures]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('Turn limits must be positive integers.');
  }
  for (const imageModel of config.imageModels || []) validateImageModel(imageModel, config);
  return { ...structuredClone(config), ...(config.skills !== undefined ? { skills: normalizeSkills(config.skills) } : {}),
    ...(config.localFonts !== undefined ? { localFonts: normalizeLocalFonts(config.localFonts) } : {}) };
}