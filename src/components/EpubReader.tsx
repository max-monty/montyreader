import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, List, X } from "lucide-react";
// @ts-ignore — epubjs has no types in many setups
import ePub from "epubjs";
import { getDocumentUrl } from "../utils/storage";
import { updateArticlePosition } from "../db";
import type { Article } from "../types";

interface Props {
  article: Article;
}

export default function EpubReader({ article }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [toc, setToc] = useState<{ href: string; label: string }[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [progress, setProgress] = useState<string>("");

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
        });

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
    };
  }, [article.storagePath, article.id]);

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
      // 1) Direct spine lookup
      const direct = book?.spine?.get?.(path);
      if (direct?.href) candidates.push(hash ? `${direct.href}#${hash}` : direct.href);
      // 2) Suffix match across spine items (handles OPF subdirectory mismatches)
      const items: any[] = book?.spine?.spineItems || [];
      const match = items.find(
        (it) => it?.href && (it.href === path || it.href.endsWith("/" + path) || path.endsWith("/" + it.href))
      );
      if (match?.href) candidates.push(hash ? `${match.href}#${hash}` : match.href);
    } catch {}
    // 3) Original href as last resort
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

  return (
    <div className="h-screen flex flex-col bg-stone-50">
      <header className="bg-white/95 backdrop-blur border-b border-stone-200 shrink-0">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
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

      <main className="flex-1 relative overflow-hidden">
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
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
              <span className="font-sans text-sm font-medium">Contents</span>
              <button onClick={() => setShowToc(false)} className="p-1 text-stone-400 hover:text-stone-700"><X size={14} /></button>
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
    </div>
  );
}
