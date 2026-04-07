export type ArticleKind = "web" | "pdf" | "epub";

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
  // New optional fields for richer document support.
  // `kind` defaults to "web" when missing (legacy rows).
  kind?: ArticleKind;
  storagePath?: string | null; // Firebase Storage path for PDF/EPUB binaries
  fileSize?: number | null;
  // Reading position — interpretation depends on kind:
  //   web  -> scroll Y in pixels
  //   pdf  -> 1-based page number
  //   epub -> EPUB CFI string
  position?: string | number | null;
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
  // Optional inline note tied to this highlight (legacy free-text)
  note?: string | null;
  // EPUB Canonical Fragment Identifier — present only for highlights inside
  // an EPUB. Used to re-render the highlight and to jump to it.
  cfi?: string | null;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export interface Note {
  id: string;
  userId?: string;
  articleId: string | null; // null = standalone note (not tied to an article)
  highlightId?: string | null; // null = independent of any highlight
  body: string;
  createdAt: number;
  updatedAt: number;
}

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
