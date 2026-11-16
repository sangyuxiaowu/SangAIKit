import { expect, test } from 'bun:test';
import { createBuiltInTools, type ImageToolExtension } from './builtInTools';
import { createEndpoint } from './modelConfig';
import { createImageModel, imageModelToolId } from './image-generation/index';
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

test('shares Chinese dynamic schemas, short model aliases and credential-free model discovery', async () => {
  const value = config();
  value.imageModels![0].id = 'legacy-model-identifier';
  value.imageModels!.push({ ...value.imageModels![0], id: 'second', description: 'Other model' });
  const tools = createBuiltInTools(options(value)).tools;
  const generate = tools.find(tool => tool.name === 'generate_image')!;
  expect(generate.parameters.required).toEqual(['modelConfigId', 'prompt']);
  expect(JSON.stringify(generate.parameters)).not.toContain('projectId');
  expect(JSON.stringify(generate.parameters)).toContain('生图提示词');
  const listed = await tools.find(tool => tool.name === 'list_image_models')!.execute({}, new AbortController().signal);
  expect(listed).toMatchObject({ models: [{ id: imageModelToolId(value.imageModels![0]) }, { id: 'second' }] });
  expect(JSON.stringify(listed)).not.toContain('apiKey');
  const single = createBuiltInTools(options(config())).tools;
  expect(single.some(tool => tool.name === 'list_image_models')).toBe(false);
  expect(single.find(tool => tool.name === 'generate_image')!.parameters.required).toEqual(['prompt']);
});

test('generates multiple saved images from one original reference without any host parameters', async () => {
  const originalFetch = globalThis.fetch;
  const value = config();
  const source = new Blob([Uint8Array.from(atob('iVBORw0KGgo='), c => c.charCodeAt(0))], { type: 'image/png' });
  const saved: Blob[] = [];
  let body: FormData | undefined;
  globalThis.fetch = Object.assign(async (_url: unknown, init?: RequestInit) => {
    body = init?.body as FormData;
    return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }, { b64_json: 'iVBORw0KGgo=' }] });
  }, { preconnect: originalFetch.preconnect });
  try {
    const tool = createBuiltInTools({ config: value, loadImage: async () => source,
      saveImage: async (blob, name) => {
        saved.push(blob);
        return { id: `image-${saved.length}`, name, type: 'image/png', size: blob.size };
      } }).tools.find(tool => tool.name === 'generate_image')!;
    const result = await tool.execute({ prompt: 'City', referenceImageId: 'source', n: 2 }, new AbortController().signal);
    expect(saved).toHaveLength(2);
    expect(await saved[0].arrayBuffer()).toEqual(await source.arrayBuffer());
    expect(body!.get('n')).toBe('2');
    expect(await (body!.get('image') as File).arrayBuffer()).toEqual(await source.arrayBuffer());
    expect(result).toMatchObject({ images: [{ id: 'image-1' }, { id: 'image-2' }] });
    expect(JSON.stringify(result)).not.toContain('base64');
    await expect(tool.execute({ prompt: 'City', projectId: 'host' }, new AbortController().signal)).rejects.toThrow('parameter');
  } finally { globalThis.fetch = originalFetch; }
});

test('host extension injects a schema, supplies original reference bytes and receives results without session saving', async () => {
  const originalFetch = globalThis.fetch;
  const source = new Blob([Uint8Array.from(atob('iVBORw0KGgo='), c => c.charCodeAt(0))], { type: 'image/png' });
  let request: FormData | undefined;
  let saves = 0;
  const extension: ImageToolExtension = {
    description: '生成并交给宿主。',
    properties: { projectId: { type: 'string' }, referenceLayerId: { type: 'string' } },
    required: ['projectId'],
    prepare: async args => {
      expect(args.referenceLayerId).toBe('layer');
      return { inputImage: source, complete: async result => ({ layerIds: result.images.map((_, i) => `layer-${i}`), model: result.model }) };
    }
  };
  globalThis.fetch = Object.assign(async (_url: unknown, init?: RequestInit) => {
    request = init?.body as FormData;
    return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }, { b64_json: 'iVBORw0KGgo=' }] });
  }, { preconnect: originalFetch.preconnect });
  try {
    const tool = createBuiltInTools({ config: config(), imageExtensions: { generate_image: extension },
      saveImage: async (blob, name) => { saves++; return { id: 'saved', name, type: 'image/png', size: blob.size }; } })
      .tools.find(item => item.name === 'generate_image')!;
    expect(tool.parameters.required).toEqual(['prompt', 'projectId']);
    expect(tool.description).toBe('生成并交给宿主。');
    const result = await tool.execute({ prompt: 'City', projectId: 'p', referenceLayerId: 'layer', n: 2 }, new AbortController().signal);
    expect(result).toMatchObject({ layerIds: ['layer-0', 'layer-1'] });
    expect(await (request!.get('image') as File).arrayBuffer()).toEqual(await source.arrayBuffer());
    expect(saves).toBe(0);
    await expect(tool.execute({ prompt: 'City', referenceLayerId: 'layer' }, new AbortController().signal)).rejects.toThrow('projectId');
    expect(() => createBuiltInTools({ config: config(), imageExtensions: { generate_image: { ...extension, properties: { prompt: { type: 'string' } } } } })).toThrow('conflicts');
  } finally { globalThis.fetch = originalFetch; }
});

test('host application failure saves recovery images and blocks repeated generation in the same turn', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const saved: string[] = [];
  const extension: ImageToolExtension = {
    description: '宿主工具', properties: {}, prepare: async () => ({
      complete: async () => { throw new Error('Save may have applied'); }
    })
  };
  globalThis.fetch = Object.assign(async () => { requests++; return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }); }, { preconnect: originalFetch.preconnect });
  try {
    const tool = createBuiltInTools({ config: { ...config(), maxImageFailures: 1 }, imageExtensions: { generate_image: extension },
      saveImage: async (blob, name) => ({ id: 'recovery', name, type: 'image/png', size: blob.size }),
      onImage: image => { saved.push(image.id); } }).tools.find(item => item.name === 'generate_image')!;
    await expect(tool.execute({ prompt: 'City' }, new AbortController().signal)).rejects.toThrow('Recovery image IDs: recovery');
    await expect(tool.execute({ prompt: 'City' }, new AbortController().signal)).rejects.toThrow('Do not retry');
    expect(requests).toBe(1);
    expect(saved).toEqual(['recovery']);
  } finally { globalThis.fetch = originalFetch; }
});

test('reports both application and recovery-storage failures', async () => {
  const originalFetch = globalThis.fetch;
  const extension: ImageToolExtension = {
    description: '宿主工具', properties: {}, prepare: async () => ({
      complete: async () => { throw new Error('Canvas failed'); }
    })
  };
  globalThis.fetch = Object.assign(async () => Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }), { preconnect: originalFetch.preconnect });
  try {
    const tool = createBuiltInTools({ config: config(), imageExtensions: { generate_image: extension },
      saveImage: async () => { throw new Error('Storage full'); } }).tools.find(item => item.name === 'generate_image')!;
    await expect(tool.execute({ prompt: 'City' }, new AbortController().signal)).rejects.toThrow('Canvas failed. No recovery images were saved. Recovery saving failed: Storage full.');
  } finally { globalThis.fetch = originalFetch; }
});