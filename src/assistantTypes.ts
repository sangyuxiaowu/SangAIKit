import type { CSSProperties, Dispatch, PointerEventHandler, ReactNode, RefObject, SetStateAction } from 'react';
import type { ChatSession as SessionSummary, SessionImage, SessionTool } from './sessionTypes';
import type { GalleryImageClassifier, GalleryInsertAction, InsertGalleryImageInput } from './SessionList';
import type { AssistantTheme } from './useResolvedTheme';
import type { AiFeatures } from './features';
import type { PlaceholderSnapshot } from './placeholders';
import type { ToolDescriptor } from './toolRegistry';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface RequestUsage {
  id: string;
  entryId?: string;
  endpoint: string;
  model: string;
  createdAt: number;
  completedAt?: number;
  durationMs?: number;
  status: 'completed' | 'incomplete' | 'failed' | 'aborted';
  inputEstimate?: number;
  responseId?: string;
  usage?: TokenUsage;
}

export interface ToolEvent extends SessionTool {
  id: string;
  status: 'running' | 'success' | 'error';
  startedAt?: number;
  durationMs?: number;
  result?: string;
}

export type AssistantActivityEvent =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'reasoning'; text: string }
  | { id: string; type: 'tool'; toolId: string };

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Original raw user text before placeholder replacement */
  rawContent?: string;
  /** Resolved text actually sent to the model API after placeholder replacement */
  sentContent?: string;
  /** Send-time placeholder snapshots for interactive UI inspection */
  placeholders?: PlaceholderSnapshot[];
  responseItemCount?: number;
  activity?: AssistantActivityEvent[];
  tools?: ToolEvent[];
  continuable?: boolean;
  images?: SessionImage[];
  usage?: TokenUsage;
  durationMs?: number;
}

export interface AssistantSession extends SessionSummary {
  entries: ChatEntry[];
  requests: RequestUsage[];
  responseItems?: unknown[];
  /** Optional session-specific raw system prompt supplied by the host */
  systemPrompt?: string;
  /** Resolved system prompt actually sent to the model API after placeholder replacement */
  sentSystemPrompt?: string;
  /** Captured placeholder snapshots for the session system prompt */
  systemPromptPlaceholders?: PlaceholderSnapshot[];
  /** Whether to display the session system prompt to the user in the chat UI */
  showSystemPrompt?: boolean;
  /** Session-level enabled tool names (both host business tools and SangAIKit built-in tools); undefined means default all */
  enabledTools?: string[];
}

export interface StartSessionOptions {
  /** Optional custom session title */
  title?: string;
  /** Optional session-level system prompt */
  systemPrompt?: string;
  /** Whether to show the system prompt card to the user */
  showSystemPrompt?: boolean;
  /** Optional initial user prompt for this session */
  initialPrompt?: string;
  /** Whether to send initialPrompt immediately (defaults to true when initialPrompt is provided) */
  autoSend?: boolean;
  /** Optional allowlist of tool names enabled for this session (can be adjusted anytime via setSessionTools) */
  enabledTools?: string[];
}

export interface ComposerController {
  /** Current draft text in the input box */
  value: string;
  /** Replace the entire input text */
  setValue: (next: string) => void;
  /** Insert text at the current cursor/selection position */
  insertText: (text: string, options?: { focus?: boolean }) => void;
  /** Insert a {{placeholder}} token at the current cursor/selection position */
  insertPlaceholder: (key: string, options?: { focus?: boolean }) => void;
  /** Append text to the end of the input box */
  appendText: (text: string, options?: { separator?: string; focus?: boolean }) => void;
  /** Clear the input box */
  clear: () => void;
  /** Focus the input textarea */
  focus: () => void;
  /** Read current selection range */
  getSelection: () => { start: number; end: number };
  /** Update selection range in the input textarea */
  setSelection: (start: number, end?: number) => void;
  /** Trigger sending the current input (or an override prompt) */
  submit: (overridePrompt?: string) => void;
  /** Whether input controls are currently disabled */
  disabled: boolean;
  /** Active UI language */
  language: 'zh' | 'en';
  /** Active session snapshot, if available */
  session?: AssistantSession;
}

export interface ImageUpload {
  image: SessionImage & { type: 'image/png' | 'image/jpeg' | 'image/webp' };
  blob: Blob;
}

export interface AssistantController {
  entries: ChatEntry[];
  sessions: AssistantSession[];
  activeSessionId: string | null;
  busy: boolean;
  loading: boolean;
  saving: boolean;
  loadError: string;
  keyError: boolean;
  configError: string;
  executionError: { message: string } | null;
  confirmation: { message: string; resolve: (accepted: boolean) => void } | null;
  canRegenerate?: boolean;
  send: (prompt: string, attachments?: ImageUpload[]) => Promise<void>;
  stop: (source?: 'user_stop' | 'panel_closed') => void;
  newSession: (options?: StartSessionOptions) => Promise<string | void>;
  startSession?: (options?: StartSessionOptions) => Promise<string | void>;
  setSessionTools?: (toolNames: string[] | undefined, sessionId?: string) => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  deleteImages?: (images: { sessionId: string; imageId: string }[]) => Promise<boolean>;
  insertImage?: (image: InsertGalleryImageInput) => Promise<unknown>;
  reloadConfig: () => Promise<void>;
  clearExecutionError: () => void;
  retry: () => Promise<void>;
  regenerate: () => Promise<void>;
}

export interface AssistantForkEvent {
  sessionId: string;
  entryId: string;
  responseItemCount?: number;
}

type PointerEvents = {
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onPointerMove?: PointerEventHandler<HTMLElement>;
  onPointerUp?: PointerEventHandler<HTMLElement>;
  onPointerCancel?: PointerEventHandler<HTMLElement>;
  onLostPointerCapture?: PointerEventHandler<HTMLElement>;
};

export interface FloatingControls {
  minimized: boolean;
  setMinimized: Dispatch<SetStateAction<boolean>>;
  style?: CSSProperties;
  headerEvents?: PointerEvents;
  resizeEvents?: PointerEvents;
  resizeByKeyboard: (key: string, large: boolean) => void;
}

export interface AssistantViewProps {
  assistant: AssistantController;
  floating: FloatingControls;
  language: 'zh' | 'en';
  theme?: AssistantTheme;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  contextTitle?: string;
  contextMeta?: string;
  imageInsertAction?: GalleryInsertAction;
  classifyGalleryImage?: GalleryImageClassifier;
  quickSnippets: string[];
  features?: Partial<AiFeatures>;
  onFork?: (event: AssistantForkEvent) => void;
  active: { endpoint?: unknown; model: { label?: string; supportsVision: boolean } };
  imageToolsEnabled?: boolean;
  maxImageAttachments?: number;
  toolLabels?: Record<string, [string, string]>;
  /** Unified catalog of host business tools + SangAIKit built-in tools for per-session selection */
  availableTools?: ToolDescriptor[];
  /** Whether to show the built-in tool picker button in the top-right header (defaults to features.sessionToolPicker) */
  showHeaderToolPicker?: boolean;
  /** Custom toolbar slot rendered above the composer input box with full input control */
  renderComposerToolbar?: (composer: ComposerController) => ReactNode;
  /** Optional ref or callback exposing ComposerController to host controls outside the panel */
  composerRef?: RefObject<ComposerController | null> | ((controller: ComposerController | null) => void);
  loadImage: (sessionId: string, imageId: string, type?: string) => Promise<Blob | null>;
  createImageUpload: (file: File, imageToolsEnabled?: boolean) => Promise<ImageUpload>;
  imageModelForTool: (tool: ToolEvent) => { modelId: string; label: string } | undefined;
  sumUsage: (requests: RequestUsage[]) => TokenUsage | undefined;
  renderMarkdown: (content: string) => ReactNode;
  renderUsage: (prompt: string, english: boolean) => ReactNode;
  renderModelControls: (disabled: boolean, english: boolean) => ReactNode;
  renderSettings: (close: () => void, initialSecurity: boolean) => ReactNode;
}