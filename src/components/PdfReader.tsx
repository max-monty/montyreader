import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
// @ts-ignore — Vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import { getDocumentUrl } from "../utils/storage";
import { updateArticlePosition, touchArticle } from "../db";
import type { Article } from "../types";

// Configure worker once
// @ts-ignore
pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

interface Props {
  article: Article;
}

export default function PdfReader({ article }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState<number>(typeof article.position === "number" ? article.position : 1);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    touchArticle(article.id);
    if (!article.storagePath) {
      setError("This document has no file attached.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url = await getDocumentUrl(article.storagePath!);
        const loadingTask = pdfjs.getDocument(url);
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setDoc(pdf);
        setLoading(false);
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setError(e.message || "Failed to load PDF");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [article.storagePath]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const p = Math.min(Math.max(1, page), doc.numPages);
        const pdfPage = await doc.getPage(p);
        const containerWidth = containerRef.current?.clientWidth || 800;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(2, (containerWidth - 32) / baseViewport.width);
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = viewport.width + "px";
        canvas.style.height = viewport.height + "px";
        if (cancelled) return;
        await pdfPage.render({ canvas, canvasContext: ctx, viewport } as any).promise;
        // Persist position
        updateArticlePosition(article.id, p);
      } catch (e) {
        console.error("Render error", e);
      }
    })();
    return () => { cancelled = true; };
  }, [doc, page, article.id]);

  function next() { if (doc) setPage((p) => Math.min(p + 1, doc.numPages)); }
  function prev() { setPage((p) => Math.max(p - 1, 1)); }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "PageDown") next();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc]);

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-stone-500 hover:text-stone-700 font-sans text-sm">
            <ArrowLeft size={16} /> Library
          </Link>
          <div className="flex items-center gap-3 font-sans text-xs text-stone-600">
            <button onClick={prev} disabled={page <= 1} className="p-1 disabled:opacity-30 hover:text-stone-900"><ChevronLeft size={16} /></button>
            <span>Page {page}{doc ? ` of ${doc.numPages}` : ""}</span>
            <button onClick={next} disabled={!doc || page >= doc.numPages} className="p-1 disabled:opacity-30 hover:text-stone-900"><ChevronRight size={16} /></button>
          </div>
          {article.url && (
            <a href={article.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-stone-400 hover:text-stone-600 font-sans text-xs">
              source <ExternalLink size={11} />
            </a>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold font-sans text-stone-800 mb-4 text-center">{article.title}</h1>
        {loading && <div className="text-center text-stone-400 font-sans text-sm py-20">Loading PDF...</div>}
        {error && <div className="text-center text-red-600 font-sans text-sm py-20">{error}</div>}
        <div ref={containerRef} className="flex justify-center">
          <canvas ref={canvasRef} className="shadow-lg bg-white" />
        </div>
      </main>
    </div>
  );
}
