import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Trash2, CornerDownLeft, StickyNote, X, Check } from "lucide-react";
import {
  getArticle,
  listHighlights,
  addHighlight,
  deleteHighlight as dbDeleteHighlight,
  listNotes,
  addNote,
  updateArticlePosition,
  touchArticle,
} from "../db";
import type { Article, Highlight, Note } from "../types";
import RightSidebar from "./RightSidebar";
import PdfReader from "./PdfReader";
import EpubReader from "./EpubReader";
import VocabPopup from "./VocabPopup";
import { wordAtPoint } from "../utils/wordAtPoint";

// Inject highlight marks into article HTML by matching text in the text-only content
function applyHighlightsToHtml(html: string, highlights: Highlight[]): string {
  if (!highlights.length) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const container = doc.body.firstElementChild!;
  const fullText = container.textContent || "";

  const sorted = [...highlights].sort((a, b) => b.startOffset - a.startOffset);

  for (const h of sorted) {
    let idx = fullText.indexOf(h.text, Math.max(0, h.startOffset - 20));
    if (idx === -1) idx = fullText.indexOf(h.text);
    if (idx === -1) continue;

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

    for (const tn of textNodes) {
      if (tn.end <= hlStart || tn.start >= hlEnd) continue;

      const nodeStart = Math.max(0, hlStart - tn.start);
      const nodeEnd = Math.min(tn.node.textContent!.length, hlEnd - tn.start);

      if (nodeStart === 0 && nodeEnd === tn.node.textContent!.length) {
        const mark = doc.createElement("mark");
        mark.className = "highlight-yellow cursor-pointer";
        mark.dataset.highlightId = h.id;
        tn.node.parentNode!.replaceChild(mark, tn.node);
        mark.appendChild(tn.node);
      } else {
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
  const [notes, setNotes] = useState<Note[]>([]);
  const [menuTarget, setMenuTarget] = useState<{ id: string; x: number; y: number } | null>(null);
  const [noteComposer, setNoteComposer] = useState<{ highlightId: string; x: number; y: number } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [vocab, setVocab] = useState<{ word: string; context: string; x: number; y: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    touchArticle(id);
    getArticle(id).then((a) => {
      if (a) setArticle(a);
      else navigate("/");
    }).catch(() => navigate("/"));
    loadHighlights(id);
    loadNotes(id);
  }, [id, navigate]);

  // Restore scroll position for web articles
  useEffect(() => {
    if (article && (article.kind || "web") === "web" && typeof article.position === "number") {
      window.scrollTo({ top: article.position });
    }
  }, [article]);

  // Save scroll position (debounced) for web articles
  useEffect(() => {
    if (!article || (article.kind || "web") !== "web") return;
    let t: number | undefined;
    const onScroll = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => {
        updateArticlePosition(article.id, window.scrollY);
      }, 800);
    };
    window.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (t) window.clearTimeout(t);
    };
  }, [article]);

  async function loadHighlights(articleId: string) {
    try {
      const h = await listHighlights(articleId);
      setHighlights(h);
    } catch (err) {
      console.error("Failed to load highlights:", err);
    }
  }

  async function loadNotes(articleId: string) {
    try {
      const n = await listNotes(articleId);
      setNotes(n);
    } catch (err) {
      console.error("Failed to load notes:", err);
    }
  }

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

    const ancestor = range.commonAncestorContainer;
    const parentEl = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor as Element;
    if (parentEl?.closest("[data-highlight-id]")) return;

    doHighlight(text);
    selection.removeAllRanges();
  }, [article]);

  async function doHighlight(text: string) {
    if (!article?.id) return;

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
    // Cmd/Ctrl-click → vocab lookup for the word under the cursor.
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      const hit = wordAtPoint(document, e.clientX, e.clientY);
      if (hit) {
        setVocab({ word: hit.word, context: hit.context, x: e.clientX, y: e.clientY });
      }
      return;
    }
    const target = (e.target as HTMLElement).closest("[data-highlight-id]") as HTMLElement | null;
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      const hId = target.dataset.highlightId!;
      const rect = target.getBoundingClientRect();
      setMenuTarget({
        id: hId,
        x: rect.left + rect.width / 2,
        y: rect.top + window.scrollY,
      });
      return;
    }
    if (menuTarget) setMenuTarget(null);
    if (noteComposer) setNoteComposer(null);
  }

  async function deleteHighlight(hId: string) {
    if (!article?.id) return;
    await dbDeleteHighlight(hId);
    setMenuTarget(null);
    setNoteComposer(null);
    loadHighlights(article.id);
    loadNotes(article.id);
  }

  function jumpToHighlight(h: Highlight) {
    const el = document.querySelector(`[data-highlight-id="${h.id}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("highlight-pulse");
    setTimeout(() => el.classList.remove("highlight-pulse"), 1500);
  }

  function openNoteComposer(target: { id: string; x: number; y: number }) {
    setNoteComposer({ highlightId: target.id, x: target.x, y: target.y });
    setNoteDraft("");
    setMenuTarget(null);
  }

  async function saveNoteFromComposer() {
    if (!article?.id || !noteComposer || !noteDraft.trim()) {
      setNoteComposer(null);
      return;
    }
    await addNote({
      articleId: article.id,
      highlightId: noteComposer.highlightId,
      body: noteDraft.trim(),
    });
    setNoteComposer(null);
    setNoteDraft("");
    loadNotes(article.id);
  }

  if (!article) {
    return (
      <div className="min-h-screen flex items-center justify-center text-stone-400 font-sans">
        Loading...
      </div>
    );
  }

  // Dispatch by kind: PDF and EPUB get their own viewers
  const kind = article.kind || "web";
  if (kind === "pdf") {
    return <PdfReader article={article} />;
  }
  if (kind === "epub") {
    return <EpubReader article={article} />;
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
        </div>
      </main>

      {/* Highlight action menu (Jump / Note / Delete) */}
      {menuTarget && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuTarget(null)} />
          <div
            className="absolute z-50 flex items-center gap-1 bg-stone-900 text-white rounded-lg shadow-lg p-1"
            style={{
              left: menuTarget.x,
              top: menuTarget.y - 42,
              transform: "translateX(-50%)",
            }}
          >
            <button
              onClick={() => openNoteComposer(menuTarget)}
              className="flex items-center gap-1 px-2 py-1 text-xs font-sans hover:bg-stone-700 rounded"
              title="Add a note"
            >
              <StickyNote size={12} /> Note
            </button>
            <button
              onClick={() => deleteHighlight(menuTarget.id)}
              className="flex items-center gap-1 px-2 py-1 text-xs font-sans hover:bg-red-600 rounded"
              title="Delete highlight"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </>
      )}

      {/* Inline note composer */}
      {noteComposer && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setNoteComposer(null)} />
          <div
            className="absolute z-50 bg-white border border-stone-200 rounded-lg shadow-xl p-3 w-72"
            style={{
              left: noteComposer.x,
              top: noteComposer.y + 10,
              transform: "translateX(-50%)",
            }}
          >
            <textarea
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNoteFromComposer();
                if (e.key === "Escape") setNoteComposer(null);
              }}
              rows={3}
              placeholder="Add a note... (Cmd+Enter to save)"
              className="w-full px-2 py-1.5 bg-stone-50 border border-stone-200 rounded text-sm font-sans focus:outline-none focus:ring-1 focus:ring-stone-300 resize-none"
            />
            <div className="flex justify-end gap-1 mt-2">
              <button
                onClick={() => setNoteComposer(null)}
                className="p-1 text-stone-400 hover:text-stone-600 rounded"
                title="Cancel"
              >
                <X size={14} />
              </button>
              <button
                onClick={saveNoteFromComposer}
                className="p-1 text-stone-400 hover:text-green-600 rounded"
                title="Save"
              >
                <Check size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      {vocab && (
        <VocabPopup
          word={vocab.word}
          context={vocab.context}
          articleId={article.id}
          x={vocab.x}
          y={vocab.y}
          onClose={() => setVocab(null)}
        />
      )}

      <RightSidebar
        article={article}
        open={chatOpen}
        onToggle={setChatOpen}
        highlights={highlights}
        notes={notes}
        onJumpToHighlight={(h) => jumpToHighlight(h)}
        onDeleteHighlight={deleteHighlight}
        onNotesChanged={() => loadNotes(article.id)}
      />
    </div>
  );
}
