import type { AiFeatures } from './features';

export interface PlaceholderItem {
  /** Unique placeholder key used inside {{key}}, e.g. '故事介绍', '卷纲', '角色:张三' */
  key: string;
  /** Optional display label (defaults to key) */
  label?: string;
  /** Optional group/category name for host UI menus */
  group?: string;
  /** Optional short description */
  description?: string;
}

export interface PlaceholderResolveContext {
  /** Exact matched token in raw content, e.g. '{{角色:张三}}' */
  token: string;
  /** Normalized trimmed placeholder key, e.g. '角色:张三' */
  key: string;
  /** Matching item from the host list, if present */
  item?: PlaceholderItem;
  /** Active session ID */
  sessionId: string;
  /** Whether the placeholder is being resolved for a user message or system prompt */
  target?: 'user' | 'system';
}

export type PlaceholderResolver = (
  key: string,
  context: PlaceholderResolveContext
) => string | undefined | null | Promise<string | undefined | null>;

export interface PlaceholderConfig {
  /** Whether placeholder replacement is enabled (defaults to true when config is provided). */
  enabled?: boolean;
  /** Host-provided list of placeholders (or dynamic getter). */
  items: readonly PlaceholderItem[] | (() => readonly PlaceholderItem[]);
  /** Host-provided value resolver executed at send time. */
  resolve: PlaceholderResolver;
  /**
   * When true, also passes {{key}} tokens not listed in `items` to `resolve`.
   * Defaults to false so unrelated {{...}} syntax in user messages is untouched.
   */
  allowDynamic?: boolean;
}

export interface PlaceholderSnapshot {
  /** Placeholder key without braces, e.g. '角色:张三' */
  key: string;
  /** Exact token matched in raw input, e.g. '{{角色:张三}}' */
  token: string;
  /** Display label captured at send time */
  label?: string;
  /** Group captured at send time */
  group?: string;
  /** Resolved text value captured at send time */
  value: string;
  /** True when the resolver returned a string value; false when null/undefined */
  resolved: boolean;
  /** Timestamp (ms) when the value snapshot was captured */
  resolvedAt: number;
}

export interface PlaceholderResolutionResult {
  /** Original user input containing {{...}} tokens */
  rawContent: string;
  /** Replaced content to send to the model API */
  sentContent: string;
  /** Send-time snapshots of all matched placeholders (deduplicated by key, in order of first appearance) */
  placeholders: PlaceholderSnapshot[];
}

export type PlaceholderTextSegment =
  | { type: 'text'; text: string }
  | { type: 'placeholder'; token: string; key: string; snapshot: PlaceholderSnapshot };

const PLACEHOLDER_TOKEN_PATTERN = /\{\{([^{}]+?)\}\}/g;

export function formatPlaceholderToken(key: string): string {
  const trimmed = key.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
  return `{{${trimmed}}}`;
}

export function getPlaceholderItems(config?: PlaceholderConfig): PlaceholderItem[] {
  if (!config) return [];
  const raw = typeof config.items === 'function' ? config.items() : config.items;
  return Array.isArray(raw) ? raw.filter(item => Boolean(item && typeof item.key === 'string' && item.key.trim())) : [];
}

export function isPlaceholdersEnabled(config?: PlaceholderConfig, features?: Partial<AiFeatures>): boolean {
  if (!config) return false;
  if (features?.placeholders === false) return false;
  return config.enabled !== false;
}

export function getEntryModelContent(entry: { content: string; sentContent?: string }): string {
  return entry.sentContent !== undefined ? entry.sentContent : entry.content;
}

export function getSessionSystemPrompt(
  session: { systemPrompt?: string; sentSystemPrompt?: string } | undefined,
  fallback?: string
): string | undefined {
  if (session?.sentSystemPrompt !== undefined) return session.sentSystemPrompt;
  if (session?.systemPrompt !== undefined) return session.systemPrompt;
  return fallback;
}

/**
 * Resolves {{placeholder}} tokens in user input or system prompts in a single non-recursive pass,
 * returning rawContent, sentContent, and send-time value snapshots.
 */
export async function resolvePlaceholders(
  rawContent: string,
  config: PlaceholderConfig | undefined,
  sessionId = '',
  features?: Partial<AiFeatures>,
  target: 'user' | 'system' = 'user'
): Promise<PlaceholderResolutionResult> {
  if (!isPlaceholdersEnabled(config, features) || !config || !rawContent.includes('{{')) {
    return { rawContent, sentContent: rawContent, placeholders: [] };
  }

  const items = getPlaceholderItems(config);
  const itemMap = new Map<string, PlaceholderItem>();
  for (const item of items) {
    const normalizedKey = item.key.trim();
    if (normalizedKey && !itemMap.has(normalizedKey)) {
      itemMap.set(normalizedKey, item);
    }
  }

  const matches: Array<{ index: number; token: string; key: string; item?: PlaceholderItem }> = [];
  const regex = new RegExp(PLACEHOLDER_TOKEN_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawContent)) !== null) {
    const token = match[0];
    const key = match[1].trim();
    if (!key) continue;
    const item = itemMap.get(key);
    if (!item && !config.allowDynamic) continue;
    matches.push({ index: match.index, token, key, item });
  }

  if (!matches.length) {
    return { rawContent, sentContent: rawContent, placeholders: [] };
  }

  const resolvedByKey = new Map<string, PlaceholderSnapshot>();
  const orderedSnapshots: PlaceholderSnapshot[] = [];

  for (const occurrence of matches) {
    if (resolvedByKey.has(occurrence.key)) continue;
    const rawValue = await config.resolve(occurrence.key, {
      token: occurrence.token,
      key: occurrence.key,
      item: occurrence.item,
      sessionId,
      target
    });
    const resolved = typeof rawValue === 'string';
    const snapshot: PlaceholderSnapshot = {
      key: occurrence.key,
      token: occurrence.token,
      ...(occurrence.item?.label ? { label: occurrence.item.label } : {}),
      ...(occurrence.item?.group ? { group: occurrence.item.group } : {}),
      value: resolved ? rawValue : '',
      resolved,
      resolvedAt: Date.now()
    };
    resolvedByKey.set(occurrence.key, snapshot);
    orderedSnapshots.push(snapshot);
  }

  // Single-pass assembly so resolved values containing {{...}} are never re-expanded.
  let sentContent = '';
  let cursor = 0;
  for (const occurrence of matches) {
    if (occurrence.index > cursor) {
      sentContent += rawContent.slice(cursor, occurrence.index);
    }
    const snapshot = resolvedByKey.get(occurrence.key);
    sentContent += snapshot && snapshot.resolved ? snapshot.value : occurrence.token;
    cursor = occurrence.index + occurrence.token.length;
  }
  if (cursor < rawContent.length) {
    sentContent += rawContent.slice(cursor);
  }

  return { rawContent, sentContent, placeholders: orderedSnapshots };
}

/**
 * Splits display text into plain text segments and interactive placeholder tokens
 * backed by persisted send-time snapshots.
 */
export function tokenizePlaceholders(
  rawContent: string,
  snapshots?: readonly PlaceholderSnapshot[]
): PlaceholderTextSegment[] {
  if (!snapshots?.length || !rawContent.includes('{{')) {
    return rawContent ? [{ type: 'text', text: rawContent }] : [];
  }

  const byKey = new Map<string, PlaceholderSnapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.key && !byKey.has(snapshot.key)) {
      byKey.set(snapshot.key, snapshot);
    }
  }

  const segments: PlaceholderTextSegment[] = [];
  const regex = new RegExp(PLACEHOLDER_TOKEN_PATTERN.source, 'g');
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(rawContent)) !== null) {
    const token = match[0];
    const key = match[1].trim();
    const snapshot = byKey.get(key);
    if (!snapshot) continue;

    if (match.index > cursor) {
      segments.push({ type: 'text', text: rawContent.slice(cursor, match.index) });
    }
    segments.push({ type: 'placeholder', token, key, snapshot });
    cursor = match.index + token.length;
  }

  if (cursor < rawContent.length) {
    segments.push({ type: 'text', text: rawContent.slice(cursor) });
  }

  return segments.length ? segments : [{ type: 'text', text: rawContent }];
}
