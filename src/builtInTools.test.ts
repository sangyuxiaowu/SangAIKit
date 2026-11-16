import { expect, test } from 'bun:test';
import { createBuiltInTools } from './builtInTools';
import { createEndpoint } from './modelConfig';
import { createImageModel } from './image-generation/index';
import type { AiConfig } from './settingsTypes';

function config(): AiConfig {
  const endpoint = createEndpoint('openai');
  const imageModel = { ...createImageModel('gpt-image-2'), enabled: true, endpointId: endpoint.id };
  return { endpoints: [endpoint], imageModels: [imageModel], activeSelection: { endpointId: endpoint.id, modelId: endpoint.models[0].id }, systemPrompt: 'System', imageToolPrompt: 'Images',
    skills: [{ name: 'review', description: 'Review text', content: 'Be concise.' }], localFonts: [{ family: 'Local Font', fullName: 'Local Font', styles: [] }] };
}
const options = (value: AiConfig) => ({ config: value, loadImage: async () => null, saveImage: async (blob: Blob, name: string) => ({ id: 'image', name, type: 'image/png' as const, size: blob.size }) });

test('registers built-in tools independently and keeps disabled configuration', async () => {
  const value = config();
  const normal = createBuiltInTools(options(value));
  expect(normal.tools.map(tool => tool.name)).toEqual(['remove_background', 'list_fonts', 'skill', 'generate_image']);
  expect(normal.instructions).toContain('Images');
  expect(normal.instructions).toContain('<available_skills>');
  const repeated = createBuiltInTools(options({ ...value, systemPrompt: normal.instructions }));
  expect(repeated.instructions).toBe(normal.instructions);
  const disabled = createBuiltInTools({ ...options(value), features: { imageGeneration: false, skills: false, fontManagement: false, onlineFonts: true, backgroundRemoval: false } });
  expect(disabled.tools).toEqual([]);
  expect(disabled.instructions).toBe('System');
  expect(value.skills).toHaveLength(1);
  expect(value.imageModels).toHaveLength(1);
  expect(value.localFonts).toHaveLength(1);
});

test('online fonts are optional when font management is enabled', async () => {
  for (const onlineFonts of [false, true]) {
    const builtIn = createBuiltInTools({ ...options(config()), features: { fontManagement: true, onlineFonts } });
    const fonts = await builtIn.tools.find(tool => tool.name === 'list_fonts')!.execute({}, new AbortController().signal) as { source: string }[];
    expect(fonts.filter(font => font.source === 'local')).toHaveLength(1);
    expect(fonts.filter(font => font.source === 'google')).toHaveLength(onlineFonts ? 9 : 0);
  }
});

test('registers background removal only with both image storage callbacks', () => {
  const value = config();
  const storage = options(value);
  for (const [loadImage, saveImage, expected] of [
    [undefined, undefined, false],
    [storage.loadImage, undefined, false],
    [undefined, storage.saveImage, false],
    [storage.loadImage, storage.saveImage, true]
  ] as const) {
    const builtIn = createBuiltInTools({ config: value, loadImage, saveImage });
    expect(builtIn.tools.some(tool => tool.name === 'remove_background')).toBe(expected);
  }
});

test('zero image failure budget is unlimited while a positive budget stops requests', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = Object.assign(async () => { requests++; return new Response('', { status: 503 }); }, { preconnect: originalFetch.preconnect });
  try {
    for (const limit of [0, 2]) {
      requests = 0;
      const value = { ...config(), maxImageFailures: limit };
      const tool = createBuiltInTools(options(value)).tools.find(item => item.name === 'generate_image')!;
      for (let attempt = 0; attempt < 4; attempt++) {
        await expect(tool.execute({ modelConfigId: value.imageModels![0].id, prompt: 'Test' }, new AbortController().signal)).rejects.toThrow(attempt >= 2 && limit === 2 ? 'failure limit' : 'HTTP 503');
      }
      expect(requests).toBe(limit === 0 ? 4 : 2);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('does not expose image tools or prompts without an enabled valid model', () => {
  for (const mode of ['empty', 'disabled', 'invalid', 'no-storage'] as const) {
    const value = config();
    value.skills = [];
    if (mode === 'empty') value.imageModels = [];
    if (mode === 'disabled') value.imageModels![0].enabled = false;
    if (mode === 'invalid') value.imageModels![0].endpointId = 'missing';
    const builtIn = createBuiltInTools(mode === 'no-storage' ? { config: value, features: { imageGeneration: true } } : { ...options(value), features: { imageGeneration: true } });
    expect(builtIn.tools.some(tool => tool.name === 'generate_image')).toBe(false);
    expect(builtIn.instructions).toBe('System');
  }
});