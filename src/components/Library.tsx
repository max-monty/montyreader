import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, BookOpen, ExternalLink, LogOut, Bookmark } from "lucide-react";
import { listArticles, saveArticle, findArticleByUrl, deleteArticle } from "../db";
import { signOut, getCurrentUser, getCurrentUserId } from "../firebase";
import type { Article } from "../types";

export default function Library() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    loadArticles();
  }, []);

  async function loadArticles() {
    try {
      const all = await listArticles();
      setArticles(all);
    } catch (err) {
      console.error("Failed to load articles:", err);
    } finally {
      setInitialLoading(false);
    }
  }

  async function handleSave() {
    if (!url.trim()) return;
    setLoading(true);
    setError("");

    try {
      // Check for duplicates (may fail if indexes are still building — that's OK)
      try {
        const existing = await findArticleByUrl(url.trim());
        if (existing) {
          navigate(`/read/${existing.id}`);
          return;
        }
      } catch {}


      const res = await fetch("/api/fetch-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch article");
      }

      const data = await res.json();
      const id = await saveArticle({
        url: url.trim(),
        title: data.title,
        byline: data.byline,
        content: data.content,
        textContent: data.textContent,
        excerpt: data.excerpt,
        siteName: data.siteName,
        publishedTime: data.publishedTime,
        savedAt: Date.now(),
      });

      setUrl("");
      navigate(`/read/${id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteArticle(id);
    loadArticles();
  }

  function getDomain(url: string) {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return url;
    }
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  const bookmarkletRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!bookmarkletRef.current) return;
    const origin = window.location.origin;
    let uid = "";
    try { uid = getCurrentUserId(); } catch {}
    // Bookmarklet: grab page HTML, POST to /api/clip, navigate to reader
    const code = [
      `javascript:void(function(){`,
      `var b=document.createElement('div');`,
      `b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999999;background:#1c1917;color:white;padding:12px 16px;font:14px system-ui;text-align:center';`,
      `b.textContent='Saving to Reader...';`,
      `document.body.appendChild(b);`,
      `fetch('${origin}/api/clip',{`,
      `method:'POST',`,
      `headers:{'Content-Type':'application/json'},`,
      `body:JSON.stringify({html:document.documentElement.outerHTML,url:location.href,userId:'${uid}'})`,
      `}).then(function(r){return r.json()}).then(function(d){`,
      `if(d.id){window.open('${origin}/read/'+d.id,'_blank')}`,
      `else{b.textContent='Error: '+(d.error||'Unknown');setTimeout(function(){b.remove()},3000)}`,
      `}).catch(function(e){`,
      `b.textContent='Error: '+e.message;setTimeout(function(){b.remove()},3000)`,
      `})`,
      `}())`,
    ].join("");
    bookmarkletRef.current.setAttribute("href", code);
  }, []);

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-stone-400 font-sans text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <h1 className="text-xl font-semibold font-sans tracking-tight text-stone-900">
            Reader
          </h1>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-1.5 text-stone-400 hover:text-stone-600 font-sans text-xs transition-colors"
            title="Sign out"
          >
            {getCurrentUser()?.displayName && (
              <span className="text-stone-500 mr-1">{getCurrentUser()?.displayName}</span>
            )}
            <LogOut size={14} />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Bookmarklet */}
        <div className="mb-6 flex items-center justify-between px-4 py-3 bg-white border border-stone-200 rounded-lg">
          <div className="flex items-center gap-3">
            <Bookmark size={14} className="text-stone-400" />
            <span className="font-sans text-xs text-stone-500">
              Drag this to your bookmarks bar to save articles from any site (including paywalled):
            </span>
          </div>
          <a
            ref={bookmarkletRef}
            href="#"
            className="px-3 py-1.5 bg-stone-900 text-white rounded font-sans text-xs font-medium
                       hover:bg-stone-800 shrink-0 cursor-grab active:cursor-grabbing"
            onClick={(e) => { e.preventDefault(); alert("Drag this button to your bookmarks bar — don't click it here."); }}
          >
            + Save to Reader
          </a>
        </div>

        <div className="flex gap-3 mb-8">
          <input
            type="url"
            placeholder="Paste article URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="flex-1 px-4 py-2.5 bg-white border border-stone-300 rounded-lg font-sans text-sm
                       focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent
                       placeholder:text-stone-400"
            disabled={loading}
          />
          <button
            onClick={handleSave}
            disabled={loading || !url.trim()}
            className="px-4 py-2.5 bg-stone-900 text-white rounded-lg font-sans text-sm font-medium
                       hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed
                       flex items-center gap-2 shrink-0"
          >
            <Plus size={16} />
            {loading ? "Saving..." : "Save"}
          </button>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 text-red-700 rounded-lg font-sans text-sm">
            {error}
          </div>
        )}

        {articles.length === 0 ? (
          <div className="text-center py-20 text-stone-400 font-sans">
            <BookOpen size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-lg">No articles saved yet</p>
            <p className="text-sm mt-1">Paste a URL above to get started</p>
          </div>
        ) : (
          <div className="space-y-1">
            {articles.map((article) => (
              <div
                key={article.id}
                onClick={() => navigate(`/read/${article.id}`)}
                className="group flex items-start gap-4 px-4 py-4 -mx-4 rounded-lg cursor-pointer
                           hover:bg-stone-100 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h2 className="font-sans font-medium text-stone-900 leading-snug mb-1 group-hover:text-stone-700">
                    {article.title}
                  </h2>
                  <div className="flex items-center gap-2 text-xs font-sans text-stone-400">
                    <span>{getDomain(article.url)}</span>
                    {article.byline && (
                      <>
                        <span>-</span>
                        <span className="truncate">{article.byline}</span>
                      </>
                    )}
                    <span>-</span>
                    <span>{formatDate(article.savedAt)}</span>
                  </div>
                  {article.excerpt && (
                    <p className="mt-1.5 text-sm text-stone-500 line-clamp-2 leading-relaxed">
                      {article.excerpt}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 text-stone-400 hover:text-stone-600 rounded"
                    title="Open original"
                  >
                    <ExternalLink size={15} />
                  </a>
                  <button
                    onClick={(e) => handleDelete(e, article.id)}
                    className="p-1.5 text-stone-400 hover:text-red-500 rounded"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
