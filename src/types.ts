export interface Article {
  id: string;
  userId?: string;
  url: string;
  title: string;
  byline: string | null;
  content: string;
  textContent: string;
  excerpt: string | null;
  siteName: string | null;
  publishedTime: string | null;
  savedAt: number;
}

export interface Highlight {
  id: string;
  userId?: string;
  articleId: string;
  text: string;
  color: HighlightColor;
  startOffset: number;
  endOffset: number;
  contextBefore: string;
  contextAfter: string;
  createdAt: number;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Conversation {
  id?: string;
  userId?: string;
  articleId: string;
  messages: ChatMessage[];
  model: string;
  createdAt: number;
  updatedAt: number;
}

export type ModelId = "claude-opus-4-6" | "claude-sonnet-4-6" | "claude-haiku-4-5";

export const MODELS: { id: ModelId; name: string }[] = [
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6" },
  { id: "claude-opus-4-6", name: "Opus 4.6" },
  { id: "claude-haiku-4-5", name: "Haiku 4.5" },
];
