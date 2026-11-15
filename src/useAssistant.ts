import { useEffect, useRef, useState } from 'react';
import type { AssistantController, AssistantSession, ChatEntry, ImageUpload, RequestUsage, ToolEvent } from './assistantTypes';
import type { SessionImage } from './sessionTypes';
import type { ImageStore } from './imageStore';
import { imageMimeType } from './imageAttachments';
import { generateId } from './id';
import { sumUsage } from './conversationUtils';

export interface AssistantSnapshot {
  sessions: AssistantSession[];
  activeSessionId: string;
}

export interface AssistantStorage {
  load: () => Promise<AssistantSnapshot | null>;
  save: (snapshot: AssistantSnapshot) => Promise<void>;
  images?: ImageStore;
}

export type AssistantRunner = (messages: ChatEntry[], events: {
  signal: AbortSignal;
  history: unknown[];
  onHistory: (items: unknown[]) => void;
  onText: (text: string) => void;
  onReasoning: (text: string) => void;
  onTool: (tool: ToolEvent) => void;
  onUsage: (request: RequestUsage) => void;
  loadImage: (imageId: string) => Promise<Blob | null>;
  saveImage: (blob: Blob, name: string) => Promise<SessionImage>;
}) => Promise<void>;

const newSession = (): AssistantSession => ({ id: crypto.randomUUID(), title: '新对话', updatedAt: Date.now(), entries: [], requests: [] });
const initialSnapshot = (): AssistantSnapshot => { const session = newSession(); return { sessions: [session], activeSessionId: session.id }; };

export function useAssistant(runner: AssistantRunner, storage: AssistantStorage): AssistantController {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const current = useRef(snapshot);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [configError, setConfigError] = useState('');
  const [executionError, setExecutionError] = useState<{ message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef(Promise.resolve());
  const mounted = useRef(false);
  const generation = useRef(0);
  const redo = useRef<{ sessionId: string; entryId: string; previousEntries: ChatEntry[]; previousHistory: unknown[] } | null>(null);
  const runnerRef = useRef(runner);
  runnerRef.current = runner;

  const save = (next: AssistantSnapshot) => {
    const data = structuredClone(next);
    const targetGeneration = generation.current;
    const operation = pendingSave.current.catch(() => {}).then(() => storage.save(data));
    pendingSave.current = operation.catch(error => {
      if (mounted.current && generation.current === targetGeneration) setConfigError(error instanceof Error ? error.message : 'Unable to save conversation.');
    });
    return operation;
  };
  const update = (next: AssistantSnapshot, immediate = false) => {
    current.current = next;
    setSnapshot(next);
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (immediate) void save(next).catch(() => {});
    else saveTimer.current = setTimeout(() => { saveTimer.current = null; void save(current.current).catch(() => {}); }, 300);
  };
  const modifySession = (id: string, change: (session: AssistantSession) => AssistantSession, immediate = false) => {
    update({ ...current.current, sessions: current.current.sessions.map(session => session.id === id ? change(session) : session) }, immediate);
  };
  const reload = async () => {
    const targetGeneration = generation.current;
    setLoading(true);
    setLoadError('');
    try {
      const loaded = await storage.load();
      if (!mounted.current || generation.current !== targetGeneration) return;
      const valid = loaded?.sessions.length && loaded.sessions.some(session => session.id === loaded.activeSessionId);
      let interrupted = false;
      const restored = valid ? loaded! : initialSnapshot();
      const next = { ...restored, sessions: restored.sessions.map(session => ({ ...session, entries: session.entries.map(entry => ({ ...entry,
        tools: entry.tools?.map(tool => {
          if (tool.status !== 'running') return tool;
          interrupted = true;
          return { ...tool, status: 'error' as const, result: 'The previous operation was interrupted.' };
        })
      })) })) };
      current.current = next;
      setSnapshot(next);
      if (interrupted) void save(next).catch(() => {});
    } catch (error) {
      if (mounted.current && generation.current === targetGeneration) setLoadError(error instanceof Error ? error.message : 'Unable to load conversations.');
    } finally { if (mounted.current && generation.current === targetGeneration) setLoading(false); }
  };

  useEffect(() => {
    generation.current++;
    mounted.current = true;
    setBusy(false);
    setSaving(false);
    savingRef.current = false;
    setExecutionError(null);
    setConfigError('');
    redo.current = null;
    void reload();
    return () => {
      mounted.current = false;
      generation.current++;
      request.current?.abort();
      request.current = null;
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; void save(current.current).catch(() => {}); }
    };
  }, [storage]);

  const run = async (prompt: string, previous: ChatEntry[], attachments: ImageUpload[] = [], historyOverride?: unknown[]) => {
    if (request.current || savingRef.current || loading || loadError) return;
    if (attachments.length && !storage.images) throw new Error('Image storage is unavailable.');
    const id = current.current.activeSessionId;
    const historyBefore = historyOverride ?? current.current.sessions.find(item => item.id === id)?.responseItems ?? [];
    redo.current = null;
    const abort = new AbortController();
    const targetGeneration = generation.current;
    const active = () => mounted.current && generation.current === targetGeneration;
    request.current = abort;
    setBusy(true);
    setExecutionError(null);
    const user: ChatEntry = { id: crypto.randomUUID(), role: 'user', content: prompt, ...(attachments.length ? { images: attachments.map(item => item.image) } : {}) };
    const response: ChatEntry = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    const updateResponse = (change: (entry: ChatEntry) => ChatEntry) => modifySession(id, session => ({ ...session, updatedAt: Date.now(), entries: session.entries.map(entry => entry.id === response.id ? change(entry) : entry) }));
    let published = false;
    const previousSnapshot = current.current;
    const savedUploads: { sessionId: string; imageId: string }[] = [];
    try {
      for (const attachment of attachments) {
        abort.signal.throwIfAborted();
        await storage.images!.saveImage(id, attachment.image.id, attachment.blob);
        savedUploads.push({ sessionId: id, imageId: attachment.image.id });
      }
      abort.signal.throwIfAborted();
      if (!active()) throw new Error('The active storage has changed.');
      const next = { ...current.current, sessions: current.current.sessions.map(session => session.id === id ? { ...session, title: previous.length ? session.title : prompt.slice(0, 30), updatedAt: Date.now(), entries: [...previous, user, response], responseItems: historyBefore } : session) };
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      current.current = next;
      setSnapshot(next);
      await save(next);
      published = true;
      abort.signal.throwIfAborted();
      if (!active()) throw new Error('The active storage has changed.');
      redo.current = { sessionId: id, entryId: response.id, previousEntries: previous, previousHistory: historyBefore };
      await runnerRef.current([...previous, user], {
        signal: abort.signal,
        history: historyBefore,
        onHistory: items => { if (active() && !abort.signal.aborted) modifySession(id, session => ({ ...session, responseItems: items })); },
        onUsage: request => { if (active()) modifySession(id, session => {
          const requests = [...session.requests.filter(item => item.id !== request.id), { ...request, entryId: response.id }];
          const turnRequests = requests.filter(item => item.entryId === response.id);
          const durationMs = turnRequests.reduce((total, item) => total + (item.durationMs || 0), 0);
          return { ...session, requests, entries: session.entries.map(entry => entry.id === response.id ? { ...entry, usage: sumUsage(turnRequests), durationMs: durationMs || undefined } : entry) };
        }); },
        loadImage: imageId => storage.images?.loadImage(id, imageId) ?? Promise.resolve(null),
        saveImage: async (blob, name) => {
          abort.signal.throwIfAborted();
          if (!storage.images) throw new Error('Image storage is unavailable.');
          if (!blob.size || blob.size > 25 * 1024 * 1024) throw new Error('Invalid image size.');
          const image: SessionImage = { id: generateId(), name, type: imageMimeType(blob.type), size: blob.size };
          await storage.images.saveImage(id, image.id, blob);
          try {
            abort.signal.throwIfAborted();
            if (!active()) throw new Error('The active storage has changed.');
          } catch (error) {
            await storage.images.deleteImages([{ sessionId: id, imageId: image.id }]).catch(() => {});
            throw error;
          }
          updateResponse(entry => ({ ...entry, images: [...(entry.images || []), image] }));
          return image;
        },
        onText: text => { if (active() && !abort.signal.aborted) updateResponse(entry => {
          const activity = [...(entry.activity || [])];
          const last = activity.at(-1);
          if (last?.type === 'text') activity[activity.length - 1] = { ...last, text: last.text + text };
          else activity.push({ id: crypto.randomUUID(), type: 'text', text });
          return { ...entry, content: entry.content + text, activity };
        }); },
        onReasoning: text => { if (active() && !abort.signal.aborted) updateResponse(entry => ({ ...entry, reasoning: (entry.reasoning || '') + text })); },
        onTool: tool => { if (active() && !abort.signal.aborted) updateResponse(entry => ({ ...entry,
          tools: [...(entry.tools || []).filter(item => item.id !== tool.id), tool],
          activity: entry.activity?.some(item => item.type === 'tool' && item.toolId === tool.id) ? entry.activity : [...(entry.activity || []), { id: tool.id, type: 'tool', toolId: tool.id }]
        })); }
      });
      abort.signal.throwIfAborted();
    } catch (error) {
      if (!published) {
        if (active()) { current.current = previousSnapshot; setSnapshot(previousSnapshot); }
        if (savedUploads.length) await storage.images?.deleteImages(savedUploads).catch(() => {});
        if (!abort.signal.aborted) throw error;
      }
      if (active() && abort.signal.aborted) updateResponse(entry => ({ ...entry, content: `${entry.content}${entry.content ? '\n\n' : ''}已停止。`, activity: [...(entry.activity || []), { id: crypto.randomUUID(), type: 'text', text: '已停止。' }], tools: entry.tools?.map(tool => tool.status === 'running' ? { ...tool, status: 'error', result: '已停止' } : tool) }));
      else if (active() && published) setExecutionError({ message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (active()) {
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
        void save(current.current).catch(() => {});
      }
      if (request.current === abort) request.current = null;
      if (active()) setBusy(false);
    }
  };
  const session = snapshot.sessions.find(item => item.id === snapshot.activeSessionId) || snapshot.sessions[0];
  const previousUserIndex = session.entries.map(entry => entry.role).lastIndexOf('user');
  const hasToolEffects = previousUserIndex >= 0 && session.entries.slice(previousUserIndex + 1).some(entry => entry.tools?.length);
  const canRedo = Boolean(redo.current && redo.current.sessionId === session.id && session.entries.at(-1)?.id === redo.current.entryId);
  const regenerate = async () => {
    const checkpoint = redo.current;
    const active = current.current.sessions.find(item => item.id === current.current.activeSessionId);
    if (!active || !checkpoint || checkpoint.sessionId !== active.id || active.entries.at(-1)?.id !== checkpoint.entryId) return;
    const index = active.entries.map(entry => entry.role).lastIndexOf('user');
    if (index >= 0 && !active.entries[index].images?.length && !active.entries.slice(index + 1).some(entry => entry.tools?.length)) await run(active.entries[index].content, checkpoint.previousEntries, [], checkpoint.previousHistory);
  };

  return {
    entries: session.entries, sessions: snapshot.sessions, activeSessionId: snapshot.activeSessionId,
    busy, loading, saving, loadError, keyError: false, configError, executionError, confirmation: null,
    canRegenerate: !busy && canRedo && previousUserIndex >= 0 && !hasToolEffects && !session.entries[previousUserIndex]?.images?.length,
    send: async (prompt, attachments = []) => {
      const active = current.current.sessions.find(item => item.id === current.current.activeSessionId);
      if (active) await run(prompt, active.entries, attachments);
    },
    stop: () => request.current?.abort(),
    newSession: async () => { if (!request.current && !savingRef.current) { redo.current = null; const next = newSession(); update({ sessions: [next, ...current.current.sessions], activeSessionId: next.id }, true); setExecutionError(null); } },
    selectSession: async id => { if (!request.current && !savingRef.current && current.current.sessions.some(item => item.id === id)) { redo.current = null; update({ ...current.current, activeSessionId: id }, true); setExecutionError(null); } },
    renameSession: async (id, title) => modifySession(id, item => ({ ...item, title, updatedAt: Date.now() }), true),
    deleteSession: async id => {
      if (request.current || savingRef.current) return;
      const targetGeneration = generation.current;
      const remaining = current.current.sessions.filter(item => item.id !== id);
      if (!remaining.length) remaining.push(newSession());
      const next = { sessions: remaining, activeSessionId: current.current.activeSessionId === id ? remaining[0].id : current.current.activeSessionId };
      savingRef.current = true; setSaving(true);
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      try {
        await save(next);
        if (!mounted.current || generation.current !== targetGeneration) return;
        current.current = next; setSnapshot(next);
        await storage.images?.deleteSessionImages(id);
      } catch (error) { if (mounted.current && generation.current === targetGeneration) setConfigError(error instanceof Error ? error.message : 'Unable to delete session.'); }
      finally { if (mounted.current && generation.current === targetGeneration) { savingRef.current = false; setSaving(false); } }
    },
    ...(storage.images ? { deleteImages: async (images: { sessionId: string; imageId: string }[]) => {
      if (request.current || savingRef.current) return false;
      const targetGeneration = generation.current;
      const keys = new Set(images.map(image => `${image.sessionId}:${image.imageId}`));
      const next = { ...current.current, sessions: current.current.sessions.map(item => {
        const cleanParts = (parts: unknown[]) => parts.map(part => {
          if (!part || typeof part !== 'object') return part;
          const image = part as { type?: string; image_url?: string };
          return image.type === 'input_image' && image.image_url?.startsWith('attachment://') && keys.has(`${item.id}:${image.image_url.slice('attachment://'.length)}`)
            ? { type: 'input_text', text: '[Chat image deleted by user]' } : part;
        });
        return { ...item, entries: item.entries.map(entry => ({ ...entry,
          images: entry.images?.filter(image => !keys.has(`${item.id}:${image.id}`)),
          tools: entry.tools?.map(tool => tool.image && keys.has(`${item.id}:${tool.image.id}`) ? { ...tool, image: undefined } : tool)
        })), responseItems: item.responseItems?.map(value => {
          if (!value || typeof value !== 'object') return value;
          const record = value as Record<string, unknown>;
          return { ...record, ...(Array.isArray(record.content) ? { content: cleanParts(record.content) } : {}),
            ...(record.type === 'function_call_output' && Array.isArray(record.output) ? { output: cleanParts(record.output) } : {}) };
        }) };
      }) };
      savingRef.current = true; setSaving(true);
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      try {
        await save(next);
        if (!mounted.current || generation.current !== targetGeneration) return false;
        current.current = next; setSnapshot(next);
        await storage.images!.deleteImages(images);
        return true;
      } catch (error) { if (mounted.current && generation.current === targetGeneration) setConfigError(error instanceof Error ? error.message : 'Unable to delete images.'); return false; }
      finally { if (mounted.current && generation.current === targetGeneration) { savingRef.current = false; setSaving(false); } }
    } } : {}),
    reloadConfig: reload,
    clearExecutionError: () => setExecutionError(null),
    retry: async () => {
      if (hasToolEffects) { setExecutionError({ message: '本轮包含工具操作，请检查已完成的操作后重新发起请求。' }); return; }
      if (!redo.current || session.entries[previousUserIndex]?.images?.length) { setExecutionError({ message: '无法安全重试本轮，请检查会话后重新发起请求。' }); return; }
      await regenerate();
    },
    regenerate
  };
}