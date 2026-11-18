import { expect, test } from 'bun:test';
import { builtInToolDefinitions, createBuiltInTools, type ImageToolExtension } from './builtInTools';
import { createEndpoint } from './modelConfig';
import { createImageModel, generateImages, imageCapabilities, imageModelToolId, validateImageModel } from './image-generation/index';
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

for (const fontManagement of [false, true]) for (const onlineFonts of [false, true]) for (const hasLocalFonts of [false, true]) {
  test(`font tool registration, description and results match enabled sources: management=${fontManagement}, online=${onlineFonts}, local=${hasLocalFonts}`, async () => {
    const value = config();
    if (!hasLocalFonts) value.localFonts = [];
    const features = { fontManagement, onlineFonts };
    const builtIn = createBuiltInTools({ ...options(value), features });
    const tool = builtIn.tools.find(tool => tool.name === 'list_fonts');
    const definition = builtInToolDefinitions({ features, config: value }).find(tool => tool.name === 'list_fonts');
    const registered = fontManagement && (hasLocalFonts || onlineFonts);
    expect(Boolean(tool)).toBe(registered);
    expect(Boolean(definition)).toBe(registered);
    if (!tool) return;
    const { execute, ...schema } = tool;
    expect(schema).toEqual(definition!);
    expect(tool.description.includes('本地字体')).toBe(hasLocalFonts);
    expect(tool.description.includes('Google Fonts')).toBe(onlineFonts);
    expect(tool.parameters).toEqual({ type: 'object', properties: {} });
    const fonts = await execute({}, new AbortController().signal) as { source: string }[];
    expect(fonts.filter(font => font.source === 'local')).toHaveLength(hasLocalFonts ? 1 : 0);
    expect(fonts.filter(font => font.source === 'google')).toHaveLength(onlineFonts ? 9 : 0);
    await expect(execute({ query: 'font' }, new AbortController().signal)).rejects.toThrow('does not accept parameters');
  });
}

test('font tool uses the turn configuration snapshot without adding prompt text', async () => {
  const value = config();
  const selectedFonts = value.localFonts!;
  value.localFonts = [];
  const features = { fontManagement: true, onlineFonts: false };
  const withoutFonts = createBuiltInTools({ ...options(value), features });
  value.localFonts = selectedFonts;
  const withFonts = createBuiltInTools({ ...options(value), features });
  const tool = withFonts.tools.find(item => item.name === 'list_fonts');
  expect(withoutFonts.tools.some(item => item.name === 'list_fonts')).toBe(false);
  expect(tool).toBeDefined();
  expect(withFonts.instructions).toBe(withoutFonts.instructions);
  selectedFonts[0].family = 'Changed';
  value.localFonts = [];
  const fonts = await tool!.execute({}, new AbortController().signal) as { family: string }[];
  expect(fonts.map(font => font.family)).toEqual(['Local Font']);
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

test('host extension injects a schema, supplies original reference bytes and archives results', async () => {
  const originalFetch = globalThis.fetch;
  const source = new Blob([Uint8Array.from(atob('iVBORw0KGgo='), c => c.charCodeAt(0))], { type: 'image/png' });
  let request: FormData | undefined;
  let saves = 0;
  const savedNames: string[] = [];
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
      saveImage: async (blob, name) => { saves++; savedNames.push(name); return { id: `saved-${saves}`, name, type: 'image/png', size: blob.size }; } })
      .tools.find(item => item.name === 'generate_image')!;
    expect(tool.parameters.required).toEqual(['prompt', 'projectId']);
    expect(tool.description).toBe('生成并交给宿主。');
    const result = await tool.execute({ prompt: 'City', projectId: 'p', referenceLayerId: 'layer', n: 2 }, new AbortController().signal);
    expect(result).toMatchObject({ layerIds: ['layer-0', 'layer-1'], images: [{ id: 'saved-1' }, { id: 'saved-2' }] });
    expect(savedNames.every(name => /^generated-/.test(name))).toBe(true);
    expect(await (request!.get('image') as File).arrayBuffer()).toEqual(await source.arrayBuffer());
    expect(saves).toBe(2);
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

test('reports archive failure without applying or retrying generation', async () => {
  const originalFetch = globalThis.fetch;
  let applied = false;
  const extension: ImageToolExtension = {
    description: '宿主工具', properties: {}, prepare: async () => ({
      complete: async () => { applied = true; }
    })
  };
  globalThis.fetch = Object.assign(async () => Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }), { preconnect: originalFetch.preconnect });
  try {
    const tool = createBuiltInTools({ config: config(), imageExtensions: { generate_image: extension },
      saveImage: async () => { throw new Error('Storage full'); } }).tools.find(item => item.name === 'generate_image')!;
    await expect(tool.execute({ prompt: 'City' }, new AbortController().signal)).rejects.toThrow('Image generation succeeded but saving failed: Storage full');
    expect(applied).toBe(false);
    await expect(tool.execute({ prompt: 'City' }, new AbortController().signal)).rejects.toThrow('Do not retry');
  } finally { globalThis.fetch = originalFetch; }
});

test('preserves already archived images when a later archive write fails', async () => {
  const originalFetch = globalThis.fetch;
  const images: string[] = [];
  let applied = false;
  const extension: ImageToolExtension = { description: 'Host', properties: {}, prepare: async () => ({ complete: async () => { applied = true; } }) };
  globalThis.fetch = Object.assign(async () => Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }, { b64_json: 'iVBORw0KGgo=' }] }), { preconnect: originalFetch.preconnect });
  try {
    let count = 0;
    const tool = createBuiltInTools({ config: config(), imageExtensions: { generate_image: extension },
      saveImage: async (blob, name) => {
        if (++count === 2) throw new Error('Storage full');
        return { id: 'first', name, type: 'image/png', size: blob.size };
      }, onImage: image => images.push(image.id) }).tools.find(item => item.name === 'generate_image')!;
    await expect(tool.execute({ prompt: 'City', n: 2 }, new AbortController().signal)).rejects.toThrow('Saved image IDs: first');
    expect(images).toEqual(['first']);
    expect(applied).toBe(false);
  } finally { globalThis.fetch = originalFetch; }
});

test('reference limits default correctly and validate model configurations', () => {
  const value = config();
  const model = value.imageModels![0];
  expect(model.maxReferenceImages).toBe(5);
  expect(createImageModel('agnes').maxReferenceImages).toBe(1);
  expect(imageCapabilities({ ...model, maxReferenceImages: undefined }).maxReferenceImages).toBe(1);
  for (const limit of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => validateImageModel({ ...model, maxReferenceImages: limit }, value)).toThrow('Reference image limit');
  }
  expect(() => validateImageModel({ ...createImageModel('kolors'), maxReferenceImages: 2 }, value)).toThrow('at most one');
});

test('supports multiple stored and host references and enforces the model limit', async () => {
  const originalFetch = globalThis.fetch;
  const source = new Blob([Uint8Array.from(atob('iVBORw0KGgo='), character => character.charCodeAt(0))], { type: 'image/png' });
  const value = config();
  let requests = 0;
  let body: FormData | undefined;
  globalThis.fetch = Object.assign(async (_url: unknown, init?: RequestInit) => {
    requests++;
    body = init?.body as FormData;
    return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
  }, { preconnect: originalFetch.preconnect });
  try {
    const tool = createBuiltInTools({ ...options(value), loadImage: async id => id === 'missing' ? null : source }).tools.find(item => item.name === 'generate_image')!;
    expect((tool.parameters.properties as Record<string, any>).referenceImageIds.maxItems).toBe(5);
    await tool.execute({ prompt: 'City', referenceImageIds: ['one', 'two'] }, new AbortController().signal);
    expect(body!.getAll('image[]')).toHaveLength(2);
    expect(await (body!.getAll('image[]')[1] as File).arrayBuffer()).toEqual(await source.arrayBuffer());
    await expect(tool.execute({ prompt: 'City', referenceImageIds: Array(6).fill('one') }, new AbortController().signal)).rejects.toThrow('at most 5');
    await expect(tool.execute({ prompt: 'City', referenceImageId: 'one', referenceImageIds: ['two'] }, new AbortController().signal)).rejects.toThrow('either');
    await expect(tool.execute({ prompt: 'City', referenceImageIds: ['missing'] }, new AbortController().signal)).rejects.toThrow('not found');
    expect(requests).toBe(1);

    const hostTool = createBuiltInTools({ config: value, imageExtensions: { generate_image: {
      description: 'Host', properties: {}, prepare: async () => ({ inputImages: [source, source], complete: async () => ({ ok: true }) })
    } } }).tools.find(item => item.name === 'generate_image')!;
    await hostTool.execute({ prompt: 'City' }, new AbortController().signal);
    expect(body!.getAll('image[]')).toHaveLength(2);
  } finally { globalThis.fetch = originalFetch; }
});

test('zero reference limit allows text generation only, including direct API calls', async () => {
  const originalFetch = globalThis.fetch;
  const value = config();
  value.imageModels![0].maxReferenceImages = 0;
  let requests = 0;
  globalThis.fetch = Object.assign(async () => { requests++; return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }); }, { preconnect: originalFetch.preconnect });
  try {
    const tool = createBuiltInTools(options(value)).tools.find(item => item.name === 'generate_image')!;
    expect(tool.parameters.properties).not.toHaveProperty('referenceImageIds');
    expect(tool.parameters.properties).not.toHaveProperty('referenceImageId');
    await expect(tool.execute({ prompt: 'City', referenceImageIds: ['one'] }, new AbortController().signal)).rejects.toThrow('at most 0');
    await expect(generateImages(value, { modelConfigId: value.imageModels![0].id, prompt: 'City' }, new AbortController().signal, 'data:image/png;base64,aA==')).rejects.toThrow('at most 0');
    await tool.execute({ prompt: 'City' }, new AbortController().signal);
    expect(requests).toBe(1);
  } finally { globalThis.fetch = originalFetch; }
});

test('Agnes sends multiple references in the image array', async () => {
  const originalFetch = globalThis.fetch;
  const value = config();
  value.imageModels = [{ ...createImageModel('agnes'), enabled: true, endpointId: value.endpoints[0].id, maxReferenceImages: 2 }];
  const images = ['data:image/png;base64,aA==', 'data:image/png;base64,aQ=='];
  let body: Record<string, any> = {};
  globalThis.fetch = Object.assign(async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(init!.body as string);
    return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
  }, { preconnect: originalFetch.preconnect });
  try {
    await generateImages(value, { modelConfigId: value.imageModels[0].id, prompt: 'City' }, new AbortController().signal, images);
    expect(body.extra_body.image).toEqual(images);
  } finally { globalThis.fetch = originalFetch; }
});