import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, List, X, StickyNote, Trash2, Check, CornerDownLeft } from "lucide-react";
// @ts-ignore — epubjs has no types in many setups
import ePub from "epubjs";
import { getDocumentUrl } from "../utils/storage";
import {
  updateArticlePosition,
  addHighlight,
  listHighlights,
  deleteHighlight as dbDeleteHighlight,
  listNotes,
  addNote,
} from "../db";
import type { Article, Highlight, Note } from "../types";
import RightSidebar, { type BookSection } from "./RightSidebar";
import VocabPopup from "./VocabPopup";
import { wordAtPoint } from "../utils/wordAtPoint";

interface Props {
  article: Article;
}

export default function EpubReader({ article }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<any>(null);
  const annotatedRef = useRef<Set<string>>(new Set());
  const highlightsRef = useRef<Highlight[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [toc, setToc] = useState<{ href: string; label: string }[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sections, setSections] = useState<BookSection[]>([]);
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<{ id: string; x: number; y: number } | null>(null);
  const [noteComposer, setNoteComposer] = useState<{ highlightId: string; x: number; y: number } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [vocab, setVocab] = useState<{ word: string; context: string; x: number; y: number } | null>(null);

  const reloadHighlights = useCallback(async () => {
    if (!article.id) return;
    try {
      const hs = await listHighlights(article.id);
      setHighlights(hs);
    } catch (err) {
      console.error("Failed to load highlights:", err);
    }
  }, [article.id]);

  const reloadNotes = useCallback(async () => {
    if (!article.id) return;
    try {
      const ns = await listNotes(article.id);
      setNotes(ns);
    } catch (err) {
      console.error("Failed to load notes:", err);
    }
  }, [article.id]);

  useEffect(() => {
    reloadHighlights();
    reloadNotes();
  }, [reloadHighlights, reloadNotes]);

  useEffect(() => {
    if (!article.storagePath) {
      setError("This document has no file attached.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    let book: any = null;
    (async () => {
      try {
        const url = await getDocumentUrl(article.storagePath!);
        // Fetch as arrayBuffer to bypass CORS streaming issues with Firebase Storage
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        book = ePub(buf);
        bookRef.current = book;
        const rendition = book.renderTo(viewerRef.current!, {
          width: "100%",
          height: "100%",
          spread: "none",
          flow: "paginated",
          allowScriptedContent: true,
        });
        renditionRef.current = rendition;
        // Constrain media so it doesn't overflow paginated columns.
        rendition.themes.default({
          "img, svg, image, video": {
            "max-width": "100% !important",
            "max-height": "90vh !important",
            "object-fit": "contain",
            "page-break-inside": "avoid",
          },
          body: { "margin": "0 !important" },
          p: { "orphans": "2", "widows": "2" },
          "::selection": { "background": "rgba(253, 224, 71, 0.6)" },
        });
        const startCfi = typeof article.position === "string" ? article.position : undefined;
        await rendition.display(startCfi);
        // Force an explicit resize so paginated layout doesn't overflow.
        const resize = () => {
          const el = viewerRef.current;
          if (!el) return;
          try { rendition.resize(el.clientWidth, el.clientHeight); } catch {}
        };
        resize();
        const ro = new ResizeObserver(resize);
        if (viewerRef.current) ro.observe(viewerRef.current);
        (rendition as any).__ro = ro;
        const navigation = await book.loaded.navigation;
        if (!cancelled) {
          setToc(navigation.toc.map((item: any) => ({ href: item.href, label: item.label.trim() })));
        }

        rendition.on("relocated", (location: any) => {
          if (location?.start?.cfi) {
            updateArticlePosition(article.id, location.start.cfi);
            setProgress(`${Math.round((location.start.percentage || 0) * 100)}%`);
          }
          const href = location?.start?.href;
          if (href) setCurrentSectionId(href);
        });

        // Cmd/Ctrl-click inside the iframe → vocab lookup for the word.
        // Plain click on a highlight rect → open the highlight menu (epubjs's
        // own annotation click cb is unreliable across sections, so we route
        // it ourselves by walking up to the wrapping <g class="epub-hl">).
        rendition.hooks.content.register((contents: any) => {
          const doc: Document = contents.document;
          doc.addEventListener("click", (e: MouseEvent) => {
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              e.stopPropagation();
              const hit = wordAtPoint(doc, e.clientX, e.clientY);
              if (!hit) return;
              const iframe = viewerRef.current?.querySelector("iframe") as HTMLIFrameElement | null;
              const r = iframe?.getBoundingClientRect();
              const x = (r?.left || 0) + e.clientX;
              const y = (r?.top || 0) + e.clientY;
              setVocab({ word: hit.word, context: hit.context, x, y });
              return;
            }
            const target = e.target as Element | null;
            const g = target?.closest?.("g.epub-hl") as SVGGElement | null;
            if (!g) return;
            const hid = g.getAttribute("data-hl-id") || "";
            const h = highlightsRef.current.find((x) => x.id === hid);
            if (!h) return;
            e.preventDefault();
            e.stopPropagation();
            const iframe = viewerRef.current?.querySelector("iframe") as HTMLIFrameElement | null;
            const iframeRect = iframe?.getBoundingClientRect();
            const rect = (g.querySelector("rect") || g).getBoundingClientRect();
            const x = (iframeRect?.left || 0) + rect.left + rect.width / 2;
            const y = (iframeRect?.top || 0) + rect.top;
            setMenuTarget({ id: h.id, x, y });
          });
        });

        // Capture text selections inside the EPUB iframe → save as highlight.
        rendition.on("selected", async (cfiRange: string, contents: any) => {
          try {
            const range = await book.getRange(cfiRange);
            const text = (range?.toString() || "").trim();
            if (text.length < 2) return;
            await addHighlight({
              articleId: article.id,
              text,
              color: "yellow",
              startOffset: 0,
              endOffset: 0,
              contextBefore: "",
              contextAfter: "",
              createdAt: Date.now(),
              cfi: cfiRange,
            });
            try { contents?.window?.getSelection?.()?.removeAllRanges?.(); } catch {}
            reloadHighlights();
          } catch (err) {
            console.warn("Failed to save highlight:", err);
          }
        });

        // Lazily extract per-section text so the chat tab can let the user
        // pick which sections to send as context. Don't block UI.
        (async () => {
          try {
            await book.opened;
            const items: any[] = book.spine?.spineItems || [];
            // Build a label index from the TOC (href → label).
            const tocLabels = new Map<string, string>();
            try {
              const nav = await book.loaded.navigation;
              const walk = (nodes: any[]) => {
                for (const n of nodes || []) {
                  if (n?.href) {
                    const path = String(n.href).split("#")[0];
                    if (!tocLabels.has(path)) tocLabels.set(path, (n.label || "").trim());
                  }
                  if (n?.subitems) walk(n.subitems);
                }
              };
              walk(nav?.toc || []);
            } catch {}

            const collected: BookSection[] = [];
            let i = 0;
            for (const item of items) {
              i++;
              try {
                let text = "";
                // 1) Most reliable for buffer-backed books: read raw xhtml
                //    from the in-memory archive and parse it.
                try {
                  const url = item.url || item.href;
                  if (book.archive && url && typeof book.archive.getText === "function") {
                    const xhtml = await book.archive.getText(url);
                    if (xhtml) {
                      const parsed = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
                      text = (parsed?.documentElement?.textContent || "").trim();
                      // Some EPUBs are not strict xhtml; fall back to text/html.
                      if (!text) {
                        const parsed2 = new DOMParser().parseFromString(xhtml, "text/html");
                        text = (parsed2?.body?.textContent || parsed2?.documentElement?.textContent || "").trim();
                      }
                    }
                  }
                } catch (err) {
                  console.warn("archive.getText failed:", err);
                }
                // 2) Fallback to spineItem.load
                if (!text) {
                  try {
                    const doc: any = await item.load(book.load.bind(book));
                    text = (doc?.body?.textContent || doc?.documentElement?.textContent || "").trim();
                  } catch (err) {
                    console.warn("item.load failed:", err);
                  } finally {
                    try { item.unload(); } catch {}
                  }
                }
                if (!text) continue;
                const href = String(item.href || "");
                const path = href.split("#")[0];
                let label = "";
                // Direct match, then suffix-match (TOC hrefs may include subdirs).
                label = tocLabels.get(path) || "";
                if (!label) {
                  for (const [k, v] of tocLabels.entries()) {
                    if (k.endsWith("/" + path) || path.endsWith("/" + k)) { label = v; break; }
                  }
                }
                if (!label) label = `Section ${i}`;
                collected.push({ id: href, label, text });
              } catch (err) {
                console.warn("Failed to extract section:", err);
              }
            }
            console.log(`[EpubReader] extracted ${collected.length} sections`);
            if (!cancelled) setSections(collected);
          } catch (err) {
            console.warn("Failed to extract book sections:", err);
          }
        })();

        if (!cancelled) setLoading(false);
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setError(e.message || "Failed to load EPUB");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      try { (renditionRef.current as any)?.__ro?.disconnect?.(); } catch {}
      try { renditionRef.current?.destroy?.(); } catch {}
      try { book?.destroy?.(); } catch {}
      annotatedRef.current.clear();
    };
  }, [article.storagePath, article.id, reloadHighlights]);

  // Re-apply annotations whenever highlights change.
  useEffect(() => {
    highlightsRef.current = highlights;
    const rendition = renditionRef.current;
    if (!rendition) return;
    const seen = annotatedRef.current;
    // Add any new ones
    for (const h of highlights) {
      if (!h.cfi || seen.has(h.id)) continue;
      try {
        const cb = (e: any) => {
          // Position the menu centered above the actual highlight rect, in
          // outer-viewport coordinates. The annotation SVG lives inside the
          // EPUB iframe, so we add the iframe's offset to the rect's local
          // position.
          const iframe = viewerRef.current?.querySelector("iframe") as HTMLIFrameElement | null;
          const iframeRect = iframe?.getBoundingClientRect();
          const target = e?.target as Element | undefined;
          let x = 0;
          let y = 0;
          if (target?.getBoundingClientRect && iframeRect) {
            const r = target.getBoundingClientRect();
            x = iframeRect.left + r.left + r.width / 2;
            y = iframeRect.top + r.top;
          } else if (iframeRect) {
            x = iframeRect.left + (e?.clientX || 0);
            y = iframeRect.top + (e?.clientY || 0);
          }
          setMenuTarget({ id: h.id, x, y });
        };
        rendition.annotations.add(
          "highlight",
          h.cfi,
          { id: h.id },
          cb,
          "epub-hl",
          { fill: "#fde047", "fill-opacity": "0.4", "mix-blend-mode": "multiply", "pointer-events": "fill", cursor: "pointer" }
        );
        seen.add(h.id);
        // Tag the rendered <g> element so our iframe click router can map
        // a click back to this highlight id. Run on next frames to wait for
        // epubjs to actually attach the SVG.
        const tag = () => {
          const iframe = viewerRef.current?.querySelector("iframe") as HTMLIFrameElement | null;
          const doc = iframe?.contentDocument;
          if (!doc) return;
          const groups = doc.querySelectorAll("g.epub-hl:not([data-hl-id])");
          groups.forEach((g) => g.setAttribute("data-hl-id", h.id));
        };
        requestAnimationFrame(() => requestAnimationFrame(tag));
      } catch (err) {
        console.warn("Failed to add annotation:", err);
      }
    }
    // Remove ones that no longer exist
    const liveIds = new Set(highlights.map((h) => h.id));
    for (const id of Array.from(seen)) {
      if (!liveIds.has(id)) {
        const removed = highlights.find((h) => h.id === id);
        const cfi = removed?.cfi;
        if (cfi) {
          try { rendition.annotations.remove(cfi, "highlight"); } catch {}
        }
        seen.delete(id);
      }
    }
  }, [highlights, loading]);

  function next() { renditionRef.current?.next?.(); }
  function prev() { renditionRef.current?.prev?.(); }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "PageDown") next();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function jumpTo(href: string) {
    const rendition = renditionRef.current;
    const book = bookRef.current;
    if (!rendition) return;
    const [path, hash] = href.split("#");
    const candidates: string[] = [];
    try {
      const direct = book?.spine?.get?.(path);
      if (direct?.href) candidates.push(hash ? `${direct.href}#${hash}` : direct.href);
      const items: any[] = book?.spine?.spineItems || [];
      const match = items.find(
        (it) => it?.href && (it.href === path || it.href.endsWith("/" + path) || path.endsWith("/" + it.href))
      );
      if (match?.href) candidates.push(hash ? `${match.href}#${hash}` : match.href);
    } catch {}
    candidates.push(href);

    const tryNext = (i: number): any => {
      if (i >= candidates.length) {
        console.warn("TOC jump failed for all candidates:", { href, candidates });
        return;
      }
      return rendition.display(candidates[i]).catch(() => tryNext(i + 1));
    };
    tryNext(0);
    setShowToc(false);
  }

  function jumpToHighlight(h: Highlight) {
    if (!h.cfi) return;
    renditionRef.current?.display(h.cfi).catch((err: any) => {
      console.warn("Failed to jump to highlight:", err);
    });
  }

  async function handleDeleteHighlight(id: string) {
    const target = highlights.find((h) => h.id === id);
    // Optimistic UI update so the sidebar list reflects the change immediately.
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    if (target?.cfi) {
      try { renditionRef.current?.annotations.remove(target.cfi, "highlight"); } catch {}
      annotatedRef.current.delete(id);
    }
    try {
      await dbDeleteHighlight(id);
    } catch (err) {
      console.error("Failed to delete highlight:", err);
    }
    reloadHighlights();
    reloadNotes();
  }

  // Article object passed to the sidebar. textContent is left empty for
  // EPUBs — the chat tab uses the per-section picker instead.
  const articleForSidebar: Article = { ...article, textContent: "" };

  return (
    <div className="h-screen flex flex-col bg-stone-50">
      <header className="bg-white/95 backdrop-blur border-b border-stone-200 shrink-0">
        <div className={`max-w-5xl mx-auto px-6 py-3 flex items-center justify-between transition-all duration-300 ${sidebarOpen ? "mr-[400px]" : ""}`}>
          <Link to="/" className="flex items-center gap-2 text-stone-500 hover:text-stone-700 font-sans text-sm">
            <ArrowLeft size={16} /> Library
          </Link>
          <div className="font-sans text-xs text-stone-500 truncate px-4 max-w-md">{article.title}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-sans text-stone-400">{progress}</span>
            <button onClick={() => setShowToc(true)} className="p-1.5 text-stone-400 hover:text-stone-700" title="Table of contents">
              <List size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className={`flex-1 relative overflow-hidden transition-all duration-300 ${sidebarOpen ? "mr-[400px]" : ""}`}>
        {loading && <div className="absolute inset-0 flex items-center justify-center text-stone-400 font-sans text-sm">Loading EPUB...</div>}
        {error && <div className="absolute inset-0 flex items-center justify-center text-red-600 font-sans text-sm">{error}</div>}
        <button onClick={prev} aria-label="Previous page" className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white border border-stone-200 shadow-sm flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-50">
          <ChevronLeft size={20} />
        </button>
        <button onClick={next} aria-label="Next page" className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white border border-stone-200 shadow-sm flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-50">
          <ChevronRight size={20} />
        </button>
        <div className="max-w-3xl mx-auto h-full px-16">
          <div ref={viewerRef} className="h-full" />
        </div>
      </main>

      {showToc && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowToc(false)} />
          <div className="fixed top-0 right-0 bottom-0 w-80 bg-white border-l border-stone-200 z-50 flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-200">
              <button onClick={() => setShowToc(false)} className="p-1 text-stone-400 hover:text-stone-700" title="Hide contents"><X size={14} /></button>
              <span className="font-sans text-sm font-medium">Contents</span>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {toc.map((item) => (
                <button
                  key={item.href}
                  onClick={() => jumpTo(item.href)}
                  className="w-full text-left px-4 py-2 text-xs font-sans text-stone-700 hover:bg-stone-100"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {menuTarget && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuTarget(null)} />
          <div
            className="fixed z-50 flex items-center gap-1 bg-stone-900 text-white rounded-lg shadow-lg p-1"
            style={{ left: menuTarget.x, top: menuTarget.y - 42, transform: "translateX(-50%)" }}
          >
            <button
              onClick={() => {
                setNoteComposer({ highlightId: menuTarget.id, x: menuTarget.x, y: menuTarget.y });
                setNoteDraft("");
                setMenuTarget(null);
              }}
              className="flex items-center gap-1 px-2 py-1 text-xs font-sans hover:bg-stone-700 rounded"
            >
              <StickyNote size={12} /> Note
            </button>
            <button
              onClick={() => {
                handleDeleteHighlight(menuTarget.id);
                setMenuTarget(null);
              }}
              className="flex items-center gap-1 px-2 py-1 text-xs font-sans hover:bg-red-600 rounded"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </>
      )}

      {noteComposer && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setNoteComposer(null)} />
          <div
            className="fixed z-50 bg-white border border-stone-200 rounded-lg shadow-xl p-3 w-72"
            style={{ left: noteComposer.x, top: noteComposer.y + 10, transform: "translateX(-50%)" }}
          >
            <textarea
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  if (!noteDraft.trim()) { setNoteComposer(null); return; }
                  await addNote({ articleId: article.id, highlightId: noteComposer.highlightId, body: noteDraft.trim() });
                  setNoteComposer(null);
                  setNoteDraft("");
                  reloadNotes();
                }
                if (e.key === "Escape") setNoteComposer(null);
              }}
              rows={3}
              placeholder="Add a note... (Cmd+Enter to save)"
              className="w-full px-2 py-1.5 bg-stone-50 border border-stone-200 rounded text-sm font-sans focus:outline-none focus:ring-1 focus:ring-stone-300 resize-none"
            />
            <div className="flex justify-end gap-1 mt-2">
              <button onClick={() => setNoteComposer(null)} className="p-1 text-stone-400 hover:text-stone-600 rounded"><X size={14} /></button>
              <button
                onClick={async () => {
                  if (!noteDraft.trim()) { setNoteComposer(null); return; }
                  await addNote({ articleId: article.id, highlightId: noteComposer.highlightId, body: noteDraft.trim() });
                  setNoteComposer(null);
                  setNoteDraft("");
                  reloadNotes();
                }}
                className="p-1 text-stone-400 hover:text-green-600 rounded"
              ><Check size={14} /></button>
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
        article={articleForSidebar}
        open={sidebarOpen}
        onToggle={setSidebarOpen}
        highlights={highlights}
        notes={notes}
        onJumpToHighlight={jumpToHighlight}
        onDeleteHighlight={handleDeleteHighlight}
        onNotesChanged={reloadNotes}
        sections={sections}
        currentSectionId={currentSectionId}
      />
    </div>
  );
}
