import type { AiConfig, AiEndpointConfig, AiModelConfig } from './settingsTypes';
import { normalizeSkills } from './skills';
import { normalizeLocalFonts } from './fonts';
import { validateImageModel } from './image-generation/index';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const ALL_REASONING_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

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

export function createEndpoint(provider: 'openai' | 'deepseek' | 'agnes' | 'local' | 'custom' = 'custom'): AiEndpointConfig {
  const preset = provider === 'deepseek' ? { name: 'DeepSeek', endpoint: 'https://api.deepseek.com', model: 'deepseek-flash', contextWindow: 1_000_000, maxTokens: 128_000 }
    : provider === 'agnes' ? { name: 'Agnes AI', endpoint: 'https://apihub.agnes-ai.com/v1', model: 'agnes-3.0-flash', contextWindow: 512_000, maxTokens: 65_536 }
    : provider === 'openai' ? { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-5.6-luna', contextWindow: 1_050_000, maxTokens: 128_000 }
    : provider === 'local' ? { name: 'Ollama', endpoint: 'http://localhost:11434/v1', model: 'qwen3' }
      : { name: 'Custom', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };
  const model = createModel(preset.model);
  if ('contextWindow' in preset) Object.assign(model, { contextWindow: preset.contextWindow, maxTokens: preset.maxTokens,
    thinkingAvailable: true, supportsVision: provider !== 'agnes' });
  return { id: crypto.randomUUID(), name: preset.name, endpoint: preset.endpoint, apiKey: '', models: [model] };
}

export function resolveSelection(config: AiConfig) {
  const endpoint = config.endpoints.find(item => item.id === config.activeSelection.endpointId) || config.endpoints[0];
  if (!endpoint?.models.length) throw new Error('Configure at least one endpoint and model.');
  return { endpoint, model: endpoint.models.find(item => item.id === config.activeSelection.modelId) || endpoint.models[0] };
}

export function selectModel(config: AiConfig, endpointId: string, modelId: string, options: { restoreThinkingDefaults?: boolean } = {}): AiConfig {
  const endpoint = config.endpoints.find(item => item.id === endpointId);
  const selected = endpoint?.models.find(model => model.id === modelId);
  if (!endpoint || !selected) throw new Error('Model not found.');
  if (!options.restoreThinkingDefaults) return { ...config, activeSelection: { endpointId, modelId } };
  const thinkingEnabled = Boolean(selected.thinkingAvailable && (selected.defaultThinkingEnabled ?? selected.thinkingEnabled));
  const defaultEffort = selected.defaultReasoningEffort ?? (selected.reasoningEffort !== 'none' ? selected.reasoningEffort : 'medium');
  return {
    ...config,
    activeSelection: { endpointId, modelId },
    endpoints: config.endpoints.map(item => item.id !== endpointId ? item : {
      ...item, models: item.models.map(model => model.id !== modelId ? model : {
        ...model, thinkingEnabled, reasoningEffort: thinkingEnabled ? defaultEffort : 'none'
      })
    })
  };
}

export function updateActiveModel(
  config: AiConfig,
  patch: Partial<Pick<AiModelConfig, 'thinkingEnabled' | 'reasoningEffort'>>,
  options: { synchronizeThinking?: boolean } = {}
): AiConfig {
  let active = config.activeSelection;
  if (!options.synchronizeThinking) {
    const { endpoint, model } = resolveSelection(config);
    active = { endpointId: endpoint.id, modelId: model.id };
  }
  return { ...config, endpoints: config.endpoints.map(endpoint => endpoint.id !== active.endpointId ? endpoint : {
    ...endpoint, models: endpoint.models.map(model => {
      if (model.id !== active.modelId) return model;
      if (!options.synchronizeThinking) return { ...model, ...patch };
      let thinkingEnabled = patch.thinkingEnabled !== undefined ? patch.thinkingEnabled : model.thinkingEnabled;
      let reasoningEffort = patch.reasoningEffort !== undefined ? patch.reasoningEffort : model.reasoningEffort;
      if (patch.reasoningEffort === 'none') {
        thinkingEnabled = false;
        reasoningEffort = 'none';
      } else if (patch.thinkingEnabled === false) {
        thinkingEnabled = false;
        if (patch.reasoningEffort) reasoningEffort = patch.reasoningEffort;
      } else if (patch.thinkingEnabled === true && (reasoningEffort === 'none' || !reasoningEffort)) {
        thinkingEnabled = true;
        reasoningEffort = model.defaultReasoningEffort && model.defaultReasoningEffort !== 'none' ? model.defaultReasoningEffort : 'medium';
      } else if (patch.reasoningEffort) {
        thinkingEnabled = true;
      }
      return { ...model, ...patch, thinkingEnabled, reasoningEffort };
    })
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
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('Turn limits must be non-negative safe integers.');
  }
  for (const imageModel of config.imageModels || []) validateImageModel(imageModel, config);
  return { ...structuredClone(config), ...(config.skills !== undefined ? { skills: normalizeSkills(config.skills) } : {}),
    ...(config.localFonts !== undefined ? { localFonts: normalizeLocalFonts(config.localFonts) } : {}) };
}