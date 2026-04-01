import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getArticle, listHighlights, addHighlight, deleteHighlight as dbDeleteHighlight } from "../db";
import type { Article, Highlight, HighlightColor } from "../types";
import ChatSidebar from "./ChatSidebar";
import HighlightMenu from "./HighlightMenu";
import HighlightsPanel from "./HighlightsPanel";

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [article, setArticle] = useState<Article | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [selectionRange, setSelectionRange] = useState<Range | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    getArticle(id).then((a) => {
      if (a) setArticle(a);
      else navigate("/");
    });
    loadHighlights(id);
  }, [id, navigate]);

  async function loadHighlights(articleId: string) {
    const h = await listHighlights(articleId);
    setHighlights(h);
  }

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 2) return;

    const range = selection.getRangeAt(0);
    if (!contentRef.current?.contains(range.commonAncestorContainer)) {
      return;
    }

    const rect = range.getBoundingClientRect();
    setMenuPos({
      x: rect.left + rect.width / 2,
      y: rect.top + window.scrollY,
    });
    setSelectedText(text);
    setSelectionRange(range.cloneRange());
  }, []);

  async function handleHighlight(color: HighlightColor) {
    if (!article?.id || !selectedText || !selectionRange) return;

    const container = contentRef.current;
    if (!container) return;

    const textContent = container.textContent || "";
    const startOffset = textContent.indexOf(selectedText);

    const contextBefore = textContent.substring(Math.max(0, startOffset - 50), startOffset);
    const contextAfter = textContent.substring(
      startOffset + selectedText.length,
      startOffset + selectedText.length + 50
    );

    await addHighlight({
      articleId: article.id,
      text: selectedText,
      color,
      startOffset,
      endOffset: startOffset + selectedText.length,
      contextBefore,
      contextAfter,
      createdAt: Date.now(),
    });

    try {
      const span = document.createElement("span");
      span.className = `highlight-${color}`;
      selectionRange.surroundContents(span);
    } catch {}

    window.getSelection()?.removeAllRanges();
    setMenuPos(null);
    setSelectedText("");
    setSelectionRange(null);
    loadHighlights(article.id);
  }

  async function handleDeleteHighlight(highlightId: string) {
    await dbDeleteHighlight(highlightId);
    if (article?.id) loadHighlights(article.id);
  }

  // Re-apply saved highlights when content loads
  useEffect(() => {
    if (!contentRef.current || !highlights.length) return;

    const container = contentRef.current;
    const textContent = container.textContent || "";

    highlights.forEach((h) => {
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
          if (parent?.classList?.contains(`highlight-${h.color}`)) return;
          const span = document.createElement("span");
          span.className = `highlight-${h.color}`;
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
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return url;
    }
  }

  return (
    <div className="min-h-screen bg-stone-50" onMouseUp={handleMouseUp}>
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

      <main className="max-w-3xl mx-auto px-6 py-10">
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
          />
        </article>

        <HighlightsPanel highlights={highlights} onDelete={handleDeleteHighlight} />
      </main>

      {menuPos && (
        <HighlightMenu
          position={menuPos}
          onHighlight={handleHighlight}
          onClose={() => setMenuPos(null)}
        />
      )}

      <ChatSidebar article={article} />
    </div>
  );
}
