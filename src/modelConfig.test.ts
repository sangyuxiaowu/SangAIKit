import { expect, test } from 'bun:test';
import { createEndpoint, normalizeConfig, selectModel } from './modelConfig';
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