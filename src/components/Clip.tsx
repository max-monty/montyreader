import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { saveArticle, findArticleByUrl } from "../db";

export default function Clip() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Saving article...");
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    // Listen for postMessage from bookmarklet (it retries every second)
    function onMessage(e: MessageEvent) {
      if (handled.current) return;
      if (e.data?.type !== "reader-clip") return;
      if (!e.data.html || !e.data.url) return;
      handled.current = true;
      handleClip(e.data);
    }
    window.addEventListener("message", onMessage);

    // After 12 seconds with no postMessage, fall back to server-side fetch
    const url = searchParams.get("url");
    const fallbackTimeout = setTimeout(() => {
      if (handled.current) return;
      handled.current = true;
      if (url) {
        handleUrlFetch(url);
      } else {
        setStatus("No article data received. Try again.");
      }
    }, 12000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(fallbackTimeout);
    };
  }, []);

  async function handleUrlFetch(url: string) {
    setStatus("Fetching article...");
    try {
      // Check if already saved
      try {
        const existing = await findArticleByUrl(url);
        if (existing) {
          navigate(`/read/${existing.id}`, { replace: true });
          return;
        }
      } catch {}

      const res = await fetch("/api/fetch-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch article");
      }

      const data = await res.json();
      const id = await saveArticle({
        url,
        title: data.title,
        byline: data.byline,
        content: data.content,
        textContent: data.textContent,
        excerpt: data.excerpt,
        siteName: data.siteName,
        publishedTime: data.publishedTime,
        savedAt: Date.now(),
      });

      navigate(`/read/${id}`, { replace: true });
    } catch (err: any) {
      console.error("Fetch error:", err);
      setStatus(`Could not fetch article: ${err.message}`);
    }
  }

  async function handleClip(data: { url: string; html: string; title?: string }) {
    setStatus("Parsing article...");

    try {
      // Check if already saved
      try {
        const existing = await findArticleByUrl(data.url);
        if (existing) {
          navigate(`/read/${existing.id}`, { replace: true });
          return;
        }
      } catch {}

      // Parse with Readability client-side
      const { Readability } = await import("@mozilla/readability");
      const parser = new DOMParser();
      const doc = parser.parseFromString(data.html, "text/html");

      // Fix relative URLs before parsing
      const base = doc.createElement("base");
      base.href = data.url;
      doc.head.prepend(base);

      const reader = new Readability(doc);
      const article = reader.parse();

      if (!article) {
        setStatus("Could not parse article. Try a different page.");
        return;
      }

      setStatus("Saving...");

      // Resolve relative image/link URLs in parsed content
      const contentDoc = parser.parseFromString(
        `<div>${article.content}</div>`,
        "text/html"
      );
      contentDoc.querySelectorAll("img[src]").forEach((img) => {
        const src = img.getAttribute("src");
        if (src && !src.startsWith("http") && !src.startsWith("data:")) {
          try { img.setAttribute("src", new URL(src, data.url).href); } catch {}
        }
      });
      contentDoc.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href");
        if (href && !href.startsWith("http") && !href.startsWith("#") && !href.startsWith("mailto:")) {
          try { a.setAttribute("href", new URL(href, data.url).href); } catch {}
        }
      });

      const id = await saveArticle({
        url: data.url,
        title: article.title || data.title || "Untitled",
        byline: article.byline,
        content: contentDoc.body.firstElementChild!.innerHTML,
        textContent: article.textContent,
        excerpt: article.excerpt,
        siteName: article.siteName,
        publishedTime: article.publishedTime,
        savedAt: Date.now(),
      });

      navigate(`/read/${id}`, { replace: true });
    } catch (err: any) {
      console.error("Clip error:", err);
      setStatus(`Error: ${err.message}`);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="text-center font-sans">
        <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-900 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-stone-500">{status}</p>
      </div>
    </div>
  );
}
