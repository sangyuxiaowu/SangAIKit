export interface SessionImage {
  id: string;
  name: string;
  type: 'image/png' | 'image/jpeg' | 'image/webp';
  size: number;
}

export interface SessionTool {
  name: string;
  arguments: string;
  image?: SessionImage;
}

export interface SessionEntry {
  content: string;
  images?: SessionImage[];
  tools?: SessionTool[];
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  entries: SessionEntry[];
  galleryEntries?: SessionEntry[];
}