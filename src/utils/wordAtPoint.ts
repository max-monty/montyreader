// Given a click event, return the word under the cursor and a short
// surrounding sentence for context. Works in both the main document and
// inside an iframe document (e.g. epubjs).

export interface WordHit {
  word: string;
  context: string;
}

export function wordAtPoint(doc: Document, clientX: number, clientY: number): WordHit | null {
  let range: Range | null = null;
  // caretRangeFromPoint is widely supported; caretPositionFromPoint is the
  // standardized version used by Firefox.
  const anyDoc = doc as any;
  if (typeof anyDoc.caretRangeFromPoint === "function") {
    range = anyDoc.caretRangeFromPoint(clientX, clientY);
  } else if (typeof anyDoc.caretPositionFromPoint === "function") {
    const pos = anyDoc.caretPositionFromPoint(clientX, clientY);
    if (pos?.offsetNode) {
      range = doc.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.setEnd(pos.offsetNode, pos.offset);
    }
  }
  if (!range) return null;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = (node.textContent || "");
  const offset = range.startOffset;
  const isWordChar = (c: string) => /[\p{L}\p{N}'’-]/u.test(c);
  let start = offset;
  let end = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  const word = text.slice(start, end).replace(/^['’-]+|['’-]+$/g, "");
  if (!word || word.length < 2) return null;

  // Build a short context window: prefer the parent block element's text.
  let contextSource = text;
  let parent: Element | null = node.parentElement;
  while (parent) {
    const tag = parent.tagName?.toLowerCase();
    if (tag && /^(p|li|blockquote|h[1-6]|div|article|section)$/.test(tag)) {
      contextSource = parent.textContent || text;
      break;
    }
    parent = parent.parentElement;
  }
  const trimmed = contextSource.replace(/\s+/g, " ").trim();
  const idx = trimmed.toLowerCase().indexOf(word.toLowerCase());
  let context = trimmed;
  if (idx !== -1) {
    const before = Math.max(0, idx - 120);
    const after = Math.min(trimmed.length, idx + word.length + 120);
    context = (before > 0 ? "…" : "") + trimmed.slice(before, after) + (after < trimmed.length ? "…" : "");
  } else if (context.length > 280) {
    context = context.slice(0, 280) + "…";
  }
  return { word, context };
}
