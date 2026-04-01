import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import { getArticle, listHighlights, addHighlight, deleteHighlight as dbDeleteHighlight } from "../db";
import type { Article, Highlight } from "../types";
import ChatSidebar from "./ChatSidebar";
import HighlightsPanel from "./HighlightsPanel";

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [article, setArticle] = useState<Article | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; x: number; y: number } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const highlightsApplied = useRef(false);

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

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

    const text = selection.toString().trim();
    if (text.length < 2) return;

    const range = selection.getRangeAt(0);
    if (!contentRef.current?.contains(range.commonAncestorContainer)) return;

    // Check if clicking on existing highlight
    const ancestor = range.commonAncestorContainer;
    const parentEl = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor as Element;
    if (parentEl?.closest("[data-highlight-id]")) return;

    // Auto-highlight yellow
    doHighlight(text, range.cloneRange());
    selection.removeAllRanges();
  }, [article]);

  async function doHighlight(text: string, range: Range) {
    if (!article?.id) return;
    const container = contentRef.current;
    if (!container) return;

    const textContent = container.textContent || "";
    const startOffset = textContent.indexOf(text);
    if (startOffset === -1) return;

    const contextBefore = textContent.substring(Math.max(0, startOffset - 50), startOffset);
    const contextAfter = textContent.substring(
      startOffset + text.length,
      startOffset + text.length + 50
    );

    const newId = await addHighlight({
      articleId: article.id,
      text,
      color: "yellow",
      startOffset,
      endOffset: startOffset + text.length,
      contextBefore,
      contextAfter,
      createdAt: Date.now(),
    });

    // Apply visually
    try {
      const span = document.createElement("span");
      span.className = "highlight-yellow cursor-pointer";
      span.dataset.highlightId = newId;
      range.surroundContents(span);
    } catch {}

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
    // Click anywhere else closes delete tooltip
    if (deleteTarget) setDeleteTarget(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || !article?.id) return;
    // Remove visual highlight
    const span = contentRef.current?.querySelector(`[data-highlight-id="${deleteTarget.id}"]`);
    if (span) {
      const parent = span.parentNode;
      while (span.firstChild) parent?.insertBefore(span.firstChild, span);
      parent?.removeChild(span);
    }
    await dbDeleteHighlight(deleteTarget.id);
    setDeleteTarget(null);
    loadHighlights(article.id);
  }

  // Apply saved highlights to DOM
  useEffect(() => {
    if (!contentRef.current || !highlights.length || !article?.content) return;
    // Avoid re-applying on every render
    if (highlightsApplied.current) return;
    highlightsApplied.current = true;

    const container = contentRef.current;
    const textContent = container.textContent || "";

    highlights.forEach((h) => {
      // Check if already applied
      if (container.querySelector(`[data-highlight-id="${h.id}"]`)) return;

      const idx = textContent.indexOf(h.text, Math.max(0, h.startOffset - 10));
      if (idx === -1) return;

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      let startNode: Text | null = null;
      let startNodeOffset = 0;
      let endNode: Text | null = null;
      let endNodeOffset = 0;

      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const nodeLen = node.textContent?.length || 0;
        if (!startNode && charCount + nodeLen > idx) {
          startNode = node;
          startNodeOffset = idx - charCount;
        }
        if (startNode && charCount + nodeLen >= idx + h.text.length) {
          endNode = node;
          endNodeOffset = idx + h.text.length - charCount;
          break;
        }
        charCount += nodeLen;
      }

      if (startNode && endNode && startNode === endNode) {
        try {
          const range = document.createRange();
          range.setStart(startNode, startNodeOffset);
          range.setEnd(endNode, endNodeOffset);
          const parent = startNode.parentElement;
          if (parent?.dataset?.highlightId) return;
          const span = document.createElement("span");
          span.className = `highlight-${h.color} cursor-pointer`;
          span.dataset.highlightId = h.id;
          range.surroundContents(span);
        } catch {}
      }
    });
  }, [article?.content, highlights]);

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
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
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

      <main
        className={`transition-all duration-300 ${chatOpen ? "mr-[400px]" : "mr-0"}`}
      >
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
              dangerouslySetInnerHTML={{ __html: article.content }}
              onMouseUp={handleMouseUp}
              onClick={handleContentClick}
            />
          </article>

          <HighlightsPanel highlights={highlights} onDelete={(hId) => {
            dbDeleteHighlight(hId).then(() => {
              if (article?.id) {
                highlightsApplied.current = false;
                loadHighlights(article.id);
              }
            });
            // Remove from DOM
            const span = contentRef.current?.querySelector(`[data-highlight-id="${hId}"]`);
            if (span) {
              const parent = span.parentNode;
              while (span.firstChild) parent?.insertBefore(span.firstChild, span);
              parent?.removeChild(span);
            }
          }} />
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
