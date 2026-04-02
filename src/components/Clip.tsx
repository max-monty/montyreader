import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { saveArticle, findArticleByUrl } from "../db";

export default function Clip() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Waiting for article content...");
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    function onMessage(e: MessageEvent) {
      if (handled.current) return;
      if (e.data?.type !== "reader-clip") return;
      handled.current = true;
      handleClip(e.data);
    }

    window.addEventListener("message", onMessage);

    // Signal opener that we're ready to receive
    if (window.opener) {
      try {
        window.opener.postMessage({ type: "reader-clip-ready" }, "*");
      } catch {}
    }

    // If no message received after 10s, show fallback
    const timeout = setTimeout(() => {
      if (!handled.current) {
        setStatus("Could not receive article content. Try using the URL input on the Library page instead.");
      }
    }, 10000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timeout);
    };
  }, []);

  async function handleClip(data: {
    url: string;
    html: string;
    title?: string;
  }) {
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
