import type { CSSProperties, Dispatch, PointerEventHandler, ReactNode, SetStateAction } from 'react';
import type { ChatSession as SessionSummary, SessionImage, SessionTool } from './sessionTypes';
import type { GalleryImageClassifier, GalleryInsertAction, InsertGalleryImageInput } from './SessionList';
import type { AssistantTheme } from './useResolvedTheme';
import type { AiFeatures } from './features';

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

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  responseItemCount?: number;
  activity?: ({ id: string; type: 'text'; text: string } | { id: string; type: 'reasoning'; text: string } | { id: string; type: 'tool'; toolId: string })[];
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
  canRegenerate: boolean;
  send: (prompt: string, attachments?: ImageUpload[]) => Promise<void>;
  stop: (source?: 'user_stop' | 'panel_closed') => void;
  newSession: () => Promise<void>;
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
  active: { endpoint: { apiKey: string }; model: { label: string; supportsVision: boolean } };
  imageToolsEnabled?: boolean;
  toolLabels?: Record<string, [string, string]>;
  loadImage: (sessionId: string, imageId: string) => Promise<Blob | null>;
  createImageUpload: (file: File, imageToolsEnabled?: boolean) => Promise<ImageUpload>;
  imageModelForTool: (tool: ToolEvent) => { modelId: string; label: string } | undefined;
  sumUsage: (requests: RequestUsage[]) => TokenUsage | undefined;
  renderMarkdown: (content: string) => ReactNode;
  renderUsage: (prompt: string, english: boolean) => ReactNode;
  renderModelControls: (disabled: boolean, english: boolean) => ReactNode;
  renderSettings: (close: () => void, initialSecurity: boolean) => ReactNode;
}