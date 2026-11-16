import { expect, test } from 'bun:test';
import { createEndpoint, normalizeConfig, selectModel, updateActiveModel } from './modelConfig';
import type { AiConfig } from './settingsTypes';

const config = (): AiConfig => {
  const endpoint = createEndpoint('openai');
  return { endpoints: [endpoint], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: '' };
};

test('validates and clones model settings', () => {
  const source = config();
  const result = normalizeConfig(source);
  expect(result).toEqual(source);
  expect(result).not.toBe(source);
  expect(selectModel(source, source.endpoints[0].id, source.endpoints[0].models[0].id)).toEqual(source);
});

test('rejects request paths, invalid models and missing selection', () => {
  const source = config();
  source.endpoints[0].endpoint = 'https://example.com/v1/responses';
  expect(() => normalizeConfig(source)).toThrow('base URL');
  source.endpoints[0].endpoint = 'https://example.com/v1';
  source.endpoints[0].models[0].maxTokens = 0;
  expect(() => normalizeConfig(source)).toThrow('model configuration');
  source.endpoints[0].models[0].maxTokens = 4096;
  source.activeSelection.modelId = 'missing';
  expect(() => normalizeConfig(source)).toThrow('Active model');
});

test('allows zero limits and rejects negative or fractional limits', () => {
  expect(normalizeConfig({ ...config(), maxToolRounds: 0, maxImageFailures: 0 })).toMatchObject({ maxToolRounds: 0, maxImageFailures: 0 });
  for (const value of [-1, 0.5, Infinity]) expect(() => normalizeConfig({ ...config(), maxToolRounds: value })).toThrow('non-negative');
});

test('preserves generic model selection and supports the host thinking-default policy', () => {
  const source = config();
  const endpoint = source.endpoints[0];
  const model = endpoint.models[0];
  Object.assign(model, { thinkingAvailable: true, thinkingEnabled: false, reasoningEffort: 'none',
    defaultThinkingEnabled: true, defaultReasoningEffort: 'high' });

  expect(selectModel(source, endpoint.id, model.id).endpoints[0].models[0]).toMatchObject({
    thinkingEnabled: false, reasoningEffort: 'none'
  });
  expect(selectModel(source, endpoint.id, model.id, { restoreThinkingDefaults: true }).endpoints[0].models[0]).toMatchObject({
    thinkingEnabled: true, reasoningEffort: 'high'
  });
  expect(source.endpoints[0].models[0].thinkingEnabled).toBe(false);
  expect(() => selectModel(source, 'missing', model.id, { restoreThinkingDefaults: true })).toThrow('Model not found');
});

test('can synchronize partial thinking updates without changing the generic patch policy', () => {
  const source = config();
  Object.assign(source.endpoints[0].models[0], { thinkingAvailable: true, thinkingEnabled: false,
    reasoningEffort: 'none', defaultReasoningEffort: 'high' });
  expect(updateActiveModel(source, { reasoningEffort: 'low' }).endpoints[0].models[0]).toMatchObject({
    thinkingEnabled: false, reasoningEffort: 'low'
  });
  const enabled = updateActiveModel(source, { reasoningEffort: 'low' }, { synchronizeThinking: true });
  expect(enabled.endpoints[0].models[0]).toMatchObject({ thinkingEnabled: true, reasoningEffort: 'low' });
  expect(updateActiveModel(enabled, { thinkingEnabled: false }, { synchronizeThinking: true }).endpoints[0].models[0]).toMatchObject({
    thinkingEnabled: false, reasoningEffort: 'low'
  });
  expect(updateActiveModel(source, { thinkingEnabled: true }, { synchronizeThinking: true }).endpoints[0].models[0]).toMatchObject({
    thinkingEnabled: true, reasoningEffort: 'high'
  });
  expect(updateActiveModel(enabled, { reasoningEffort: 'none' }, { synchronizeThinking: true }).endpoints[0].models[0]).toMatchObject({
    thinkingEnabled: false, reasoningEffort: 'none'
  });
});