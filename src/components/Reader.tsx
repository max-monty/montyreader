import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import { getArticle, listHighlights, addHighlight, deleteHighlight as dbDeleteHighlight } from "../db";
import type { Article, Highlight } from "../types";
import ChatSidebar from "./ChatSidebar";
import HighlightsPanel from "./HighlightsPanel";

// Inject highlight marks into article HTML by matching text in the text-only content
function applyHighlightsToHtml(html: string, highlights: Highlight[]): string {
  if (!highlights.length) return html;

  // Parse to a temp DOM to work with text nodes
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const container = doc.body.firstElementChild!;
  const fullText = container.textContent || "";

  // Sort highlights by startOffset descending so we can apply from end to start
  // without shifting earlier offsets
  const sorted = [...highlights].sort((a, b) => b.startOffset - a.startOffset);

  for (const h of sorted) {
    // Find the text in the full content
    let idx = fullText.indexOf(h.text, Math.max(0, h.startOffset - 20));
    if (idx === -1) idx = fullText.indexOf(h.text);
    if (idx === -1) continue;

    // Walk text nodes to find start and end positions
    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    const textNodes: { node: Text; start: number; end: number }[] = [];

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const len = node.textContent?.length || 0;
      textNodes.push({ node, start: charCount, end: charCount + len });
      charCount += len;
    }

    const hlStart = idx;
    const hlEnd = idx + h.text.length;

    // Find all text nodes that overlap with the highlight range
    for (const tn of textNodes) {
      if (tn.end <= hlStart || tn.start >= hlEnd) continue;

      const nodeStart = Math.max(0, hlStart - tn.start);
      const nodeEnd = Math.min(tn.node.textContent!.length, hlEnd - tn.start);

      if (nodeStart === 0 && nodeEnd === tn.node.textContent!.length) {
        // Whole node is highlighted
        const mark = doc.createElement("mark");
        mark.className = "highlight-yellow cursor-pointer";
        mark.dataset.highlightId = h.id;
        tn.node.parentNode!.replaceChild(mark, tn.node);
        mark.appendChild(tn.node);
      } else {
        // Partial node — split and wrap
        const text = tn.node.textContent!;
        const before = text.substring(0, nodeStart);
        const middle = text.substring(nodeStart, nodeEnd);
        const after = text.substring(nodeEnd);

        const frag = doc.createDocumentFragment();
        if (before) frag.appendChild(doc.createTextNode(before));
        const mark = doc.createElement("mark");
        mark.className = "highlight-yellow cursor-pointer";
        mark.dataset.highlightId = h.id;
        mark.textContent = middle;
        frag.appendChild(mark);
        if (after) frag.appendChild(doc.createTextNode(after));

        tn.node.parentNode!.replaceChild(frag, tn.node);
      }
    }
  }

  return container.innerHTML;
}

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [article, setArticle] = useState<Article | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; x: number; y: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    getArticle(id).then((a) => {
      if (a) setArticle(a);
      else navigate("/");
    }).catch(() => navigate("/"));
    loadHighlights(id);
  }, [id, navigate]);

  async function loadHighlights(articleId: string) {
    try {
      const h = await listHighlights(articleId);
      setHighlights(h);
    } catch (err) {
      console.error("Failed to load highlights:", err);
    }
  }

  // Compute highlighted HTML
  const highlightedHtml = useMemo(() => {
    if (!article?.content) return "";
    return applyHighlightsToHtml(article.content, highlights);
  }, [article?.content, highlights]);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

    const text = selection.toString().trim();
    if (text.length < 2) return;

    const range = selection.getRangeAt(0);
    if (!contentRef.current?.contains(range.commonAncestorContainer)) return;

    // Don't re-highlight already highlighted text
    const ancestor = range.commonAncestorContainer;
    const parentEl = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor as Element;
    if (parentEl?.closest("[data-highlight-id]")) return;

    doHighlight(text);
    selection.removeAllRanges();
  }, [article]);

  async function doHighlight(text: string) {
    if (!article?.id) return;

    // Get offset from the raw text content
    const container = contentRef.current;
    if (!container) return;
    const fullText = container.textContent || "";
    const startOffset = fullText.indexOf(text);
    if (startOffset === -1) return;

    const contextBefore = fullText.substring(Math.max(0, startOffset - 50), startOffset);
    const contextAfter = fullText.substring(
      startOffset + text.length,
      startOffset + text.length + 50
    );

    await addHighlight({
      articleId: article.id,
      text,
      color: "yellow",
      startOffset,
      endOffset: startOffset + text.length,
      contextBefore,
      contextAfter,
      createdAt: Date.now(),
    });

    loadHighlights(article.id);
  }

  function handleContentClick(e: React.MouseEvent) {
    const target = (e.target as HTMLElement).closest("[data-highlight-id]") as HTMLElement | null;
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      const hId = target.dataset.highlightId!;
      const rect = target.getBoundingClientRect();
      setDeleteTarget({
        id: hId,
        x: rect.left + rect.width / 2,
        y: rect.top + window.scrollY,
      });
      return;
    }
    if (deleteTarget) setDeleteTarget(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || !article?.id) return;
    await dbDeleteHighlight(deleteTarget.id);
    setDeleteTarget(null);
    loadHighlights(article.id);
  }

  async function handleDeleteFromPanel(hId: string) {
    if (!article?.id) return;
    await dbDeleteHighlight(hId);
    loadHighlights(article.id);
  }

  if (!article) {
    return (
      <div className="min-h-screen flex items-center justify-center text-stone-400 font-sans">
        Loading...
      </div>
    );
  }

  function getDomain(url: string) {
    try { return new URL(url).hostname.replace("www.", ""); }
    catch { return url; }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-stone-200">
        <div className={`max-w-3xl mx-auto px-6 py-3 flex items-center justify-between transition-all duration-300 ${chatOpen ? "mr-[400px]" : ""}`}>
          <Link
            to="/"
            className="flex items-center gap-2 text-stone-500 hover:text-stone-700 font-sans text-sm"
          >
            <ArrowLeft size={16} />
            Library
          </Link>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-stone-400 hover:text-stone-600 font-sans text-xs"
          >
            {getDomain(article.url)}
            <ExternalLink size={12} />
          </a>
        </div>
      </header>

      <main className={`transition-all duration-300 ${chatOpen ? "mr-[400px]" : "mr-0"}`}>
        <div className="max-w-3xl mx-auto px-6 py-10">
          <article>
            <header className="mb-10">
              <h1 className="text-3xl font-bold leading-tight mb-3 font-sans text-stone-900">
                {article.title}
              </h1>
              {(article.byline || article.siteName) && (
                <p className="text-sm font-sans text-stone-500">
                  {article.byline}
                  {article.byline && article.siteName && " - "}
                  {article.siteName}
                </p>
              )}
            </header>

            <div
              ref={contentRef}
              className="article-content"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              onMouseUp={handleMouseUp}
              onClick={handleContentClick}
            />
          </article>

          <HighlightsPanel highlights={highlights} onDelete={handleDeleteFromPanel} />
        </div>
      </main>

      {/* Delete highlight tooltip */}
      {deleteTarget && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDeleteTarget(null)} />
          <button
            className="fixed z-50 flex items-center gap-1.5 bg-stone-900 text-white rounded-lg shadow-lg
                       px-3 py-2 text-xs font-sans hover:bg-red-600 transition-colors"
            style={{
              left: deleteTarget.x,
              top: deleteTarget.y - 42,
              transform: "translateX(-50%)",
            }}
            onClick={confirmDelete}
          >
            <Trash2 size={12} />
            Remove highlight
          </button>
        </>
      )}

      <ChatSidebar article={article} open={chatOpen} onToggle={setChatOpen} />
    </div>
  );
}
