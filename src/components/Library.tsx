import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Trash2,
  BookOpen,
  ExternalLink,
  LogOut,
  ClipboardPaste,
  Settings as SettingsIcon,
  Highlighter,
  StickyNote,
  FileText,
  BookMarked,
  Upload,
  Download,
  Copy,
  Check,
} from "lucide-react";
import {
  listArticles,
  saveArticle,
  findArticleByUrl,
  deleteArticle,
  listAllHighlights,
  listAllNotes,
  listHighlights,
  listNotes,
} from "../db";
import { signOut, getCurrentUser } from "../firebase";
import type { Article, Highlight, Note } from "../types";
import { uploadDocument } from "../utils/storage";
import { articleToMarkdown, downloadText, slugify } from "../utils/markdown";

type LibTab = "all" | "highlights" | "notes";

export default function Library() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [allHighlights, setAllHighlights] = useState<Highlight[]>([]);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [tab, setTab] = useState<LibTab>("all");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showPasteForm, setShowPasteForm] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const navigate = useNavigate();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const epubInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      const [a, h, n] = await Promise.all([
        listArticles(),
        listAllHighlights().catch(() => [] as Highlight[]),
        listAllNotes().catch(() => [] as Note[]),
      ]);
      setArticles(a);
      setAllHighlights(h);
      setAllNotes(n);
    } catch (err) {
      console.error("Failed to load library:", err);
    } finally {
      setInitialLoading(false);
    }
  }

  async function handleSave() {
    if (!url.trim()) return;
    setLoading(true);
    setError("");

    try {
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
        let serverMsg = "";
        try { serverMsg = (await res.json()).error || ""; } catch {}
        let friendly = serverMsg;
        if (res.status === 403 || /403|forbidden/i.test(serverMsg)) {
          friendly = "This site blocks automated fetching (often paywalled — NYT, WSJ, etc.). Try the 'Paste raw text' option below.";
        } else if (res.status === 422 || /could not parse/i.test(serverMsg)) {
          friendly = "We fetched the page but couldn't extract readable article content. Try pasting the raw text instead.";
        } else if (res.status === 404) {
          friendly = "Page not found (404). Double-check the URL.";
        } else if (!friendly) {
          friendly = `Failed to fetch article (status ${res.status}).`;
        }
        throw new Error(friendly);
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
        kind: "web",
      });

      setUrl("");
      navigate(`/read/${id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePasteSave() {
    if (!pasteText.trim() || !pasteUrl.trim()) {
      setError("Both URL and text are required for manual paste.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/parse-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: pasteUrl.trim(), text: pasteText, title: pasteTitle.trim() || undefined }),
      });
      if (!res.ok) {
        let msg = "";
        try { msg = (await res.json()).error || ""; } catch {}
        throw new Error(msg || "Failed to parse pasted text.");
      }
      const data = await res.json();
      const id = await saveArticle({
        url: pasteUrl.trim(),
        title: data.title,
        byline: data.byline,
        content: data.content,
        textContent: data.textContent,
        excerpt: data.excerpt,
        siteName: data.siteName,
        publishedTime: data.publishedTime,
        savedAt: Date.now(),
        kind: "web",
      });
      setPasteUrl(""); setPasteText(""); setPasteTitle(""); setShowPasteForm(false);
      navigate(`/read/${id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File, kind: "pdf" | "epub") {
    setLoading(true);
    setError("");
    try {
      const { path, size } = await uploadDocument(file, kind);
      const cleanTitle = file.name.replace(/\.(pdf|epub)$/i, "");
      const id = await saveArticle({
        url: path, // pseudo-url for non-web docs
        title: cleanTitle,
        byline: null,
        content: "",
        textContent: "",
        excerpt: null,
        siteName: kind.toUpperCase(),
        publishedTime: null,
        savedAt: Date.now(),
        kind,
        storagePath: path,
        fileSize: size,
      });
      navigate(`/read/${id}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || `Failed to upload ${kind.toUpperCase()}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteArticle(id);
    loadAll();
  }

  async function handleCopyUrl(e: React.MouseEvent, article: Article) {
    e.stopPropagation();
    if (!article.url || !article.url.startsWith("http")) return;
    try {
      await navigator.clipboard.writeText(article.url);
      setCopiedId(article.id);
      setTimeout(() => setCopiedId((c) => (c === article.id ? null : c)), 1500);
    } catch (err) {
      console.warn("Copy failed", err);
    }
  }

  async function handleExport(e: React.MouseEvent, article: Article) {
    e.stopPropagation();
    try {
      const [hs, ns] = await Promise.all([
        listHighlights(article.id).catch(() => [] as Highlight[]),
        listNotes(article.id).catch(() => [] as Note[]),
      ]);
      const md = articleToMarkdown({ article, highlights: hs, notes: ns });
      downloadText(`${slugify(article.title)}.md`, md);
    } catch (err) {
      console.error("Export failed", err);
    }
  }

  function getDomain(url: string) {
    try { return new URL(url).hostname.replace("www.", ""); }
    catch { return url; }
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function articleById(id: string | null) {
    return articles.find((a) => a.id === id);
  }

  function kindIcon(kind: Article["kind"]) {
    if (kind === "pdf") return <FileText size={12} className="text-stone-400" />;
    if (kind === "epub") return <BookMarked size={12} className="text-stone-400" />;
    return null;
  }

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
          <h1 className="text-xl font-semibold font-sans tracking-tight text-stone-900">Reader</h1>
          <div className="flex items-center gap-1">
            <Link
              to="/settings"
              className="flex items-center gap-1.5 text-stone-400 hover:text-stone-600 font-sans text-xs px-2 py-1"
              title="Settings"
            >
              <SettingsIcon size={14} />
            </Link>
            <button
              onClick={() => signOut()}
              className="flex items-center gap-1.5 text-stone-400 hover:text-stone-600 font-sans text-xs transition-colors px-2 py-1"
              title="Sign out"
            >
              {getCurrentUser()?.displayName && (
                <span className="text-stone-500 mr-1">{getCurrentUser()?.displayName}</span>
              )}
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex gap-3 mb-3">
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

        <div className="flex flex-wrap items-center gap-4 mb-6">
          <button
            onClick={() => setShowPasteForm(v => !v)}
            className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 font-sans text-xs transition-colors"
          >
            <ClipboardPaste size={13} />
            {showPasteForm ? "Cancel paste" : "Paste raw text"}
          </button>
          <button
            onClick={() => pdfInputRef.current?.click()}
            className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 font-sans text-xs transition-colors"
            disabled={loading}
          >
            <Upload size={13} /> Upload PDF
          </button>
          <button
            onClick={() => epubInputRef.current?.click()}
            className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 font-sans text-xs transition-colors"
            disabled={loading}
          >
            <Upload size={13} /> Upload EPUB
          </button>
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f, "pdf"); e.target.value = ""; }}
          />
          <input
            ref={epubInputRef}
            type="file"
            accept="application/epub+zip,.epub"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f, "epub"); e.target.value = ""; }}
          />
        </div>

        {showPasteForm && (
          <div className="mb-6 p-4 bg-white border border-stone-200 rounded-lg space-y-3">
            <input
              type="url"
              placeholder="Original article URL (required)"
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded font-sans text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
              disabled={loading}
            />
            <input
              type="text"
              placeholder="Title (optional)"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded font-sans text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
              disabled={loading}
            />
            <textarea
              placeholder="Paste the full article text here..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded font-sans text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 resize-y"
              disabled={loading}
            />
            <div className="flex justify-end">
              <button
                onClick={handlePasteSave}
                disabled={loading || !pasteText.trim() || !pasteUrl.trim()}
                className="px-4 py-2 bg-stone-900 text-white rounded font-sans text-sm font-medium hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? "Saving..." : "Save article"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 text-red-700 rounded-lg font-sans text-sm">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-4 border-b border-stone-200">
          <LibTabBtn id="all"        active={tab} onClick={setTab} icon={<BookOpen size={13} />}    label={`Library${articles.length ? ` (${articles.length})` : ""}`} />
          <LibTabBtn id="highlights" active={tab} onClick={setTab} icon={<Highlighter size={13} />} label={`Highlights${allHighlights.length ? ` (${allHighlights.length})` : ""}`} />
          <LibTabBtn id="notes"      active={tab} onClick={setTab} icon={<StickyNote size={13} />}  label={`Notes${allNotes.length ? ` (${allNotes.length})` : ""}`} />
        </div>

        {tab === "all" && (
          articles.length === 0 ? (
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
                    <h2 className="font-sans font-medium text-stone-900 leading-snug mb-1 group-hover:text-stone-700 flex items-center gap-2">
                      {kindIcon(article.kind)}
                      {article.title}
                    </h2>
                    <div className="flex items-center gap-2 text-xs font-sans text-stone-400">
                      <span>{article.kind === "pdf" || article.kind === "epub" ? (article.kind?.toUpperCase()) : getDomain(article.url)}</span>
                      {article.byline && (<><span>-</span><span className="truncate">{article.byline}</span></>)}
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
                    <button
                      onClick={(e) => handleExport(e, article)}
                      className="p-1.5 text-stone-400 hover:text-stone-700 rounded"
                      title="Export markdown"
                    >
                      <Download size={15} />
                    </button>
                    {article.kind !== "pdf" && article.kind !== "epub" && article.url?.startsWith("http") && (
                      <>
                        <button
                          onClick={(e) => handleCopyUrl(e, article)}
                          className="p-1.5 text-stone-400 hover:text-stone-700 rounded"
                          title={copiedId === article.id ? "Copied!" : "Copy URL"}
                        >
                          {copiedId === article.id ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
                        </button>
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
                      </>
                    )}
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
          )
        )}

        {tab === "highlights" && (
          allHighlights.length === 0 ? (
            <EmptyState icon={<Highlighter size={42} />} title="No highlights yet" hint="Highlight text inside any article to see it here." />
          ) : (
            <div className="space-y-3">
              {allHighlights.map((h) => {
                const a = articleById(h.articleId);
                return (
                  <button
                    key={h.id}
                    onClick={() => a && navigate(`/read/${a.id}`)}
                    className="block w-full text-left bg-white border border-stone-200 rounded-lg p-4 hover:border-stone-300 hover:shadow-sm transition-all"
                  >
                    <p className="text-sm text-stone-700 leading-relaxed border-l-2 border-yellow-400 pl-3">"{h.text}"</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-stone-400 font-sans">
                      {a && <span className="truncate">{a.title}</span>}
                      <span>·</span>
                      <span>{formatDate(h.createdAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        )}

        {tab === "notes" && (
          allNotes.length === 0 ? (
            <EmptyState icon={<StickyNote size={42} />} title="No notes yet" hint="Add notes to highlights or directly inside articles to see them here." />
          ) : (
            <div className="space-y-3">
              {allNotes.map((n) => {
                const a = articleById(n.articleId);
                return (
                  <button
                    key={n.id}
                    onClick={() => a && navigate(`/read/${a.id}`)}
                    className="block w-full text-left bg-white border border-stone-200 rounded-lg p-4 hover:border-stone-300 hover:shadow-sm transition-all"
                  >
                    <p className="text-sm text-stone-700 whitespace-pre-wrap font-sans leading-relaxed">{n.body}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-stone-400 font-sans">
                      {a && <span className="truncate">{a.title}</span>}
                      <span>·</span>
                      <span>{formatDate(n.updatedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        )}
      </main>
    </div>
  );
}

function LibTabBtn({ id, active, onClick, icon, label }: { id: LibTab; active: LibTab; onClick: (id: LibTab) => void; icon: React.ReactNode; label: string }) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-sans font-medium transition-colors
                  ${isActive ? "text-stone-900 border-b-2 border-stone-900 -mb-px" : "text-stone-400 hover:text-stone-700"}`}
    >
      {icon}{label}
    </button>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="text-center py-16 text-stone-400 font-sans">
      <div className="mx-auto mb-3 opacity-50 flex justify-center">{icon}</div>
      <p className="text-base">{title}</p>
      <p className="text-xs mt-1">{hint}</p>
    </div>
  );
}
