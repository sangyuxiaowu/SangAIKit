import type { ResponsesTool } from './openai';
import { builtInToolDefinitions } from './builtInToolDefinitions';
import { createBuiltInTools, type BuiltInToolOptions } from './builtInTools';
import { availableImageModels } from './image-generation/index';
import { normalizeSkills } from './skills';
import type { AiConfig, AiSkillConfig } from './settingsTypes';
import type { AiFeatures } from './features';
import type { ImagePromptConfig } from './image-generation/types';
import type { ImageToolExtensions } from './imageToolHost';

export type ToolLabel = string | [string, string] | { zh: string; en?: string };

export interface ToolMetadataOverride {
  /** Display label shown in UI */
  label?: ToolLabel;
  /** Tree group name shown in UI (e.g. "编辑工具", "视觉与插画") */
  group?: ToolLabel;
  /** User-facing tool introduction shown in UI (separate from LLM schema description) */
  uiDescription?: ToolLabel;
  /** Whether enabled by default when session has no explicit tool allowlist */
  defaultEnabled?: boolean;
}

export interface RegisteredTool extends ResponsesTool {
  /** Display label in Chinese / English tuple, localized object, or plain string */
  label?: ToolLabel;
  /** Tree group name for organizing tools in the UI (e.g. "编辑工具") */
  group?: ToolLabel;
  /** User-facing description shown in the UI, separate from `description` sent to the LLM */
  uiDescription?: ToolLabel;
  /** @deprecated Prefer `group` for tree grouping */
  category?: string;
  /** Origin of this tool (defaults to 'host' for registered business tools) */
  source?: 'host' | 'builtin';
  /** Whether enabled by default when session has no explicit tool allowlist (default: true) */
  defaultEnabled?: boolean;
}

export interface ToolDescriptor {
  name: string;
  /** LLM-facing tool schema description */
  description: string;
  label?: ToolLabel;
  /** Tree group name for organizing tools in the UI */
  group?: ToolLabel;
  /** User-facing tool introduction shown in UI */
  uiDescription?: ToolLabel;
  /** @deprecated Prefer `group` */
  category?: string;
  source: 'host' | 'builtin';
  defaultEnabled?: boolean;
}

export interface ToolRegistry {
  /** Register a host business tool and return an unregister callback. */
  register: (tool: RegisteredTool, options?: { replace?: boolean }) => () => void;
  /** Register multiple host business tools and return a disposer that removes them all. */
  registerMany: (tools: readonly RegisteredTool[], options?: { replace?: boolean }) => () => void;
  /** Unregister a tool by name. Returns true if it existed. */
  unregister: (name: string) => boolean;
  /** Check whether a tool is registered. */
  has: (name: string) => boolean;
  /** Retrieve a registered tool by name. */
  get: (name: string) => RegisteredTool | undefined;
  /** List all currently registered tools in registration order. */
  list: () => RegisteredTool[];
  /** Subscribe to registry mutations (compatible with useSyncExternalStore). */
  subscribe: (listener: () => void) => () => void;
}

export const BUILT_IN_TOOL_LABELS: Readonly<Record<string, [string, string]>> = {
  remove_background: ['智能抠图', 'Remove background'],
  list_fonts: ['查询字体目录', 'List fonts'],
  skill: ['读取 SKILL 规则', 'Read skill'],
  list_image_models: ['查询生图模型', 'List image models'],
  generate_image: ['生成视觉图像', 'Generate image']
};

export const BUILT_IN_TOOL_GROUPS: Readonly<Record<string, [string, string]>> = {
  remove_background: ['图像处理', 'Image Processing'],
  list_fonts: ['字体与排版', 'Fonts & Typography'],
  skill: ['知识与技能', 'Skills & Guides'],
  list_image_models: ['图像生成', 'Image Generation'],
  generate_image: ['图像生成', 'Image Generation']
};

export const BUILT_IN_TOOL_UI_DESCRIPTIONS: Readonly<Record<string, [string, string]>> = {
  remove_background: ['自动去除图片背景并输出透明底图', 'Remove image background automatically with transparency'],
  list_fonts: ['查看当前可用的本地字体与在线字体列表', 'Browse available local and online fonts'],
  skill: ['读取已配置的业务规范与 SKILL 指导文档', 'Read configured skill instructions and guidelines'],
  list_image_models: ['查看当前已启用的图像生成模型及能力参数', 'Inspect enabled image generation models and capabilities'],
  generate_image: ['根据提示词或参考图生成新图片并保存到会话画廊', 'Generate or edit images from prompts or reference images']
};

function resolveLocalizedText(value: ToolLabel | undefined, english: boolean): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const picked = value[english ? 1 : 0] || value[0];
    return picked?.trim() || undefined;
  }
  if (typeof value === 'object') {
    const picked = english ? (value.en || value.zh) : value.zh;
    return picked?.trim() || undefined;
  }
  return value.trim() || undefined;
}

export function resolveToolLabel(
  tool: Pick<ToolDescriptor, 'name' | 'label'>,
  english: boolean,
  overrides?: Record<string, [string, string]>
): string {
  const override = overrides?.[tool.name];
  if (override) return override[english ? 1 : 0];
  const explicit = resolveLocalizedText(tool.label, english);
  if (explicit) return explicit;
  const builtIn = BUILT_IN_TOOL_LABELS[tool.name];
  if (builtIn) return builtIn[english ? 1 : 0];
  return tool.name;
}

export function resolveToolGroup(
  tool: Pick<ToolDescriptor, 'name' | 'group' | 'category' | 'source'>,
  english: boolean
): string {
  const explicit = resolveLocalizedText(tool.group, english);
  if (explicit) return explicit;
  if (tool.category?.trim()) return tool.category.trim();
  if (tool.source === 'builtin') {
    const builtInGroup = BUILT_IN_TOOL_GROUPS[tool.name];
    if (builtInGroup) return builtInGroup[english ? 1 : 0];
    return english ? 'Built-in Tools' : '内置工具';
  }
  return english ? 'Host Tools' : '业务工具';
}

export function resolveToolUiDescription(
  tool: Pick<ToolDescriptor, 'name' | 'description' | 'uiDescription' | 'source'>,
  english: boolean
): string {
  const explicit = resolveLocalizedText(tool.uiDescription, english);
  if (explicit) return explicit;
  if (tool.source === 'builtin') {
    const builtInDesc = BUILT_IN_TOOL_UI_DESCRIPTIONS[tool.name];
    if (builtInDesc) return builtInDesc[english ? 1 : 0];
  }
  return tool.description;
}

export function applyToolMetadataOverrides(
  descriptors: readonly ToolDescriptor[],
  overrides?: Partial<Record<string, ToolMetadataOverride>>
): ToolDescriptor[] {
  if (!overrides) return [...descriptors];
  return descriptors.map(descriptor => {
    const patch = overrides[descriptor.name];
    if (!patch) return descriptor;
    return {
      ...descriptor,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.group !== undefined ? { group: patch.group } : {}),
      ...(patch.uiDescription !== undefined ? { uiDescription: patch.uiDescription } : {}),
      ...(patch.defaultEnabled !== undefined ? { defaultEnabled: patch.defaultEnabled } : {})
    };
  });
}

export function createToolRegistry(initialTools: readonly RegisteredTool[] = []): ToolRegistry {
  const map = new Map<string, RegisteredTool>();
  const listeners = new Set<() => void>();
  let snapshot: RegisteredTool[] = [];

  const refresh = () => {
    snapshot = Array.from(map.values());
  };

  const notify = () => {
    refresh();
    for (const listener of listeners) listener();
  };

  const insert = (tool: RegisteredTool, replace = false) => {
    const name = tool.name?.trim();
    if (!name) throw new Error('Tool name must be a non-empty string.');
    if (!replace && map.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }
    map.set(name, { ...tool, name, source: tool.source ?? 'host' });
  };

  for (const tool of initialTools) {
    insert(tool, false);
  }
  refresh();

  return {
    register(tool, options) {
      insert(tool, options?.replace === true);
      const name = tool.name.trim();
      notify();
      return () => {
        if (map.delete(name)) notify();
      };
    },
    registerMany(tools, options) {
      const names: string[] = [];
      for (const tool of tools) {
        insert(tool, options?.replace === true);
        names.push(tool.name.trim());
      }
      if (names.length) notify();
      return () => {
        let changed = false;
        for (const name of names) {
          if (map.delete(name)) changed = true;
        }
        if (changed) notify();
      };
    },
    unregister(name) {
      const removed = map.delete(name);
      if (removed) notify();
      return removed;
    },
    has(name) {
      return map.has(name);
    },
    get(name) {
      return map.get(name);
    },
    list() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

export interface ListAvailableToolsOptions {
  hostTools?: readonly RegisteredTool[];
  features?: Partial<AiFeatures>;
  skills?: AiSkillConfig[];
  config?: Partial<AiConfig>;
  imageModels?: ImagePromptConfig[];
  imageStorage?: boolean;
  imageExtensions?: ImageToolExtensions;
  /** Customize built-in tools' group, uiDescription, label, or defaultEnabled per host project */
  builtInOverrides?: Partial<Record<string, ToolMetadataOverride>>;
  /** Customize metadata for any tool (host or built-in) by name */
  toolOverrides?: Partial<Record<string, ToolMetadataOverride>>;
  builtIn?: {
    features?: Partial<AiFeatures>;
    skills?: AiSkillConfig[];
    config?: Partial<AiConfig>;
    imageModels?: ImagePromptConfig[];
    imageStorage?: boolean;
    imageExtensions?: ImageToolExtensions;
  };
}

function toHostDescriptor(tool: RegisteredTool): ToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    ...(tool.label ? { label: tool.label } : {}),
    ...(tool.group ? { group: tool.group } : {}),
    ...(tool.uiDescription ? { uiDescription: tool.uiDescription } : {}),
    ...(tool.category ? { category: tool.category } : {}),
    source: tool.source ?? 'host',
    ...(tool.defaultEnabled !== undefined ? { defaultEnabled: tool.defaultEnabled } : {})
  };
}

function toBuiltInDescriptor(
  def: Pick<ResponsesTool, 'name' | 'description'>,
  override?: ToolMetadataOverride
): ToolDescriptor {
  return {
    name: def.name,
    description: def.description,
    ...(override?.label ?? BUILT_IN_TOOL_LABELS[def.name] ? { label: override?.label ?? BUILT_IN_TOOL_LABELS[def.name] } : {}),
    ...(override?.group ?? BUILT_IN_TOOL_GROUPS[def.name] ? { group: override?.group ?? BUILT_IN_TOOL_GROUPS[def.name] } : {}),
    ...(override?.uiDescription ?? BUILT_IN_TOOL_UI_DESCRIPTIONS[def.name]
      ? { uiDescription: override?.uiDescription ?? BUILT_IN_TOOL_UI_DESCRIPTIONS[def.name] }
      : {}),
    source: 'builtin',
    defaultEnabled: override?.defaultEnabled ?? true
  };
}

export function listAvailableTools(options: ListAvailableToolsOptions = {}): ToolDescriptor[] {
  const hostDescriptors: ToolDescriptor[] = (options.hostTools || []).map(toHostDescriptor);

  const builtInSource = options.builtIn ?? {
    features: options.features,
    skills: options.skills,
    config: options.config,
    imageModels: options.imageModels,
    imageStorage: options.imageStorage,
    imageExtensions: options.imageExtensions
  };
  const hasBuiltInOptions = Boolean(
    options.builtIn ||
    options.config ||
    options.features ||
    options.skills ||
    options.imageModels ||
    options.imageStorage !== undefined ||
    options.imageExtensions
  );
  const derivedConfig = builtInSource.config;
  const builtInDefs = hasBuiltInOptions
    ? builtInToolDefinitions({
        ...builtInSource,
        skills: builtInSource.skills ?? (derivedConfig?.skills ? normalizeSkills(derivedConfig.skills) : undefined),
        imageModels: builtInSource.imageModels ?? (derivedConfig?.endpoints && derivedConfig?.imageModels ? availableImageModels(derivedConfig as AiConfig) : undefined),
        imageStorage: builtInSource.imageStorage ?? (derivedConfig !== undefined)
      })
    : [];
  const builtInDescriptors: ToolDescriptor[] = builtInDefs.map(def =>
    toBuiltInDescriptor(def, options.builtInOverrides?.[def.name])
  );

  const combined = applyToolMetadataOverrides([...hostDescriptors, ...builtInDescriptors], options.toolOverrides);
  const seen = new Set<string>();
  for (const descriptor of combined) {
    if (!descriptor.name.trim()) throw new Error('工具名称必须非空且唯一。');
    if (seen.has(descriptor.name)) throw new Error(`工具名称重复：${descriptor.name}`);
    seen.add(descriptor.name);
  }
  return combined;
}

export function filterSessionTools<T extends { name: string; defaultEnabled?: boolean }>(
  tools: readonly T[],
  enabledTools?: readonly string[]
): T[] {
  if (enabledTools === undefined) {
    return tools.filter(tool => tool.defaultEnabled !== false);
  }
  const allowed = new Set(enabledTools);
  return tools.filter(tool => allowed.has(tool.name));
}

export interface ResolveSessionToolsOptions {
  hostTools?: readonly RegisteredTool[];
  builtIn?: BuiltInToolOptions;
  /** Pre-created built-in tools (alternative to passing builtIn options). */
  builtInTools?: readonly ResponsesTool[];
  /** Customize built-in tools' group, uiDescription, label, or defaultEnabled per host project */
  builtInOverrides?: Partial<Record<string, ToolMetadataOverride>>;
  /** Customize metadata for any tool (host or built-in) by name */
  toolOverrides?: Partial<Record<string, ToolMetadataOverride>>;
  /** Session-level selected tool names. Undefined means default-enabled tools; string[] means explicit allowlist. */
  enabledTools?: readonly string[];
}

export interface ResolvedSessionTools {
  tools: ResponsesTool[];
  hostTools: RegisteredTool[];
  builtInTools: ResponsesTool[];
  availableTools: ToolDescriptor[];
  selectedToolNames: string[];
  instructions: string;
}

export function resolveSessionTools(options: ResolveSessionToolsOptions = {}): ResolvedSessionTools {
  const hostTools = options.hostTools || [];
  const fullBuiltIn = options.builtIn ? createBuiltInTools({ ...options.builtIn, enabledTools: undefined }) : undefined;
  const rawBuiltInTools = fullBuiltIn?.tools ?? options.builtInTools ?? [];

  const allHostDescriptors: ToolDescriptor[] = hostTools.map(toHostDescriptor);
  const allBuiltInDescriptors: ToolDescriptor[] = rawBuiltInTools.map(tool =>
    toBuiltInDescriptor(tool, options.builtInOverrides?.[tool.name])
  );

  const availableTools = applyToolMetadataOverrides([...allHostDescriptors, ...allBuiltInDescriptors], options.toolOverrides);
  if (new Set(availableTools.map(tool => tool.name)).size !== availableTools.length || availableTools.some(tool => !tool.name.trim())) {
    throw new Error('工具名称必须非空且唯一。');
  }

  const descriptorByName = new Map(availableTools.map(item => [item.name, item]));
  const selectedHost = filterSessionTools(
    hostTools.map(tool => ({
      ...tool,
      defaultEnabled: descriptorByName.get(tool.name)?.defaultEnabled ?? tool.defaultEnabled
    })),
    options.enabledTools
  );
  const activeBuiltIn = options.builtIn
    ? createBuiltInTools({ ...options.builtIn, enabledTools: options.enabledTools ?? options.builtIn.enabledTools })
    : undefined;
  const selectedBuiltIn = activeBuiltIn
    ? activeBuiltIn.tools.filter(tool => options.enabledTools !== undefined || descriptorByName.get(tool.name)?.defaultEnabled !== false)
    : filterSessionTools(
        rawBuiltInTools.map(tool => ({
          ...tool,
          defaultEnabled: descriptorByName.get(tool.name)?.defaultEnabled
        })),
        options.enabledTools
      );
  const tools: ResponsesTool[] = [...selectedHost, ...selectedBuiltIn];

  return {
    tools,
    hostTools: selectedHost,
    builtInTools: selectedBuiltIn,
    availableTools,
    selectedToolNames: tools.map(tool => tool.name),
    instructions: activeBuiltIn?.instructions ?? options.builtIn?.config.systemPrompt ?? ''
  };
}
