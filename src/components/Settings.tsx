import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FolderOpen, Trash2, RefreshCw, FileDown, Folder } from "lucide-react";
import {
  isFileSystemAccessSupported,
  pickVault,
  getVaultInfo,
  clearVault,
  setSubfolder,
  syncManyToVault,
} from "../utils/obsidian";
import { listArticles } from "../db";

export default function Settings() {
  const [vault, setVault] = useState<{ name: string; subfolder: string | null } | null>(null);
  const [supported, setSupported] = useState(true);
  const [subfolderDraft, setSubfolderDraft] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setSupported(isFileSystemAccessSupported());
    refresh();
  }, []);

  async function refresh() {
    try {
      const info = await getVaultInfo();
      setVault(info);
      setSubfolderDraft(info?.subfolder || "");
    } catch {}
  }

  async function pick() {
    setError("");
    try {
      await pickVault();
      await refresh();
      setStatus("Vault folder linked.");
    } catch (e: any) {
      setError(e.message || "Could not pick folder");
    }
  }

  async function unlink() {
    await clearVault();
    setVault(null);
    setStatus("Vault unlinked.");
  }

  async function saveSubfolder() {
    await setSubfolder(subfolderDraft.trim() || null);
    await refresh();
    setStatus("Subfolder saved.");
  }

  async function syncAll() {
    setSyncing(true);
    setError("");
    setStatus("");
    try {
      const articles = await listArticles();
      const result = await syncManyToVault(articles);
      setStatus(`Synced ${result.written} articles${result.failed ? ` (${result.failed} failed)` : ""}.`);
    } catch (e: any) {
      setError(e.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-stone-500 hover:text-stone-700 font-sans text-sm">
            <ArrowLeft size={16} /> Library
          </Link>
          <h1 className="text-base font-semibold font-sans text-stone-900">Settings</h1>
          <div className="w-12" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8 font-sans">
        {/* Obsidian sync */}
        <section className="bg-white border border-stone-200 rounded-xl p-6">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Obsidian vault sync</h2>
              <p className="text-xs text-stone-500 mt-1">
                Pick your local Obsidian vault folder. Reader will write one Markdown file per article (with frontmatter, highlights, and notes) on demand.
              </p>
            </div>
            <FolderOpen size={18} className="text-stone-400 shrink-0" />
          </div>

          {!supported && (
            <div className="mt-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
              The File System Access API isn't available in this context. It requires a Chromium-based browser (Chrome, Edge, Brave, Arc, Opera) on a secure origin (https or localhost). If you're on Brave and seeing this, make sure you're on the deployed https site (not http) and that Brave Shields isn't blocking it for this site.
            </div>
          )}

          {supported && (
            <div className="mt-4 space-y-3">
              {vault ? (
                <>
                  <div className="flex items-center gap-2 text-xs">
                    <Folder size={14} className="text-stone-500" />
                    <span className="font-medium text-stone-800">{vault.name}</span>
                    {vault.subfolder && <span className="text-stone-400">/ {vault.subfolder}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Subfolder (optional, e.g. Reader/Articles)"
                      value={subfolderDraft}
                      onChange={(e) => setSubfolderDraft(e.target.value)}
                      className="flex-1 px-3 py-1.5 bg-stone-50 border border-stone-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-stone-300"
                    />
                    <button onClick={saveSubfolder} className="px-3 py-1.5 bg-stone-100 text-stone-700 rounded text-xs hover:bg-stone-200">Save</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={syncAll}
                      disabled={syncing}
                      className="flex items-center gap-1.5 px-3 py-2 bg-stone-900 text-white rounded text-xs font-medium hover:bg-stone-800 disabled:opacity-40"
                    >
                      <RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing..." : "Sync all articles now"}
                    </button>
                    <button onClick={pick} className="flex items-center gap-1.5 px-3 py-2 bg-stone-100 text-stone-700 rounded text-xs hover:bg-stone-200">
                      <FolderOpen size={12} /> Change folder
                    </button>
                    <button onClick={unlink} className="flex items-center gap-1.5 px-3 py-2 text-stone-400 hover:text-red-600 rounded text-xs">
                      <Trash2 size={12} /> Unlink
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={pick}
                  className="flex items-center gap-1.5 px-3 py-2 bg-stone-900 text-white rounded text-xs font-medium hover:bg-stone-800"
                >
                  <FolderOpen size={12} /> Pick vault folder
                </button>
              )}
            </div>
          )}

          {status && <p className="mt-3 text-xs text-green-700">{status}</p>}
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

          <div className="mt-5 pt-4 border-t border-stone-100 text-[11px] text-stone-400 leading-relaxed">
            Heads up: browsers can only write to folders you grant per session — there's no background sync. Click "Sync all" whenever you want a fresh export. For background sync you'd need a desktop wrapper.
          </div>
        </section>

        {/* Export */}
        <section className="bg-white border border-stone-200 rounded-xl p-6">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Export</h2>
              <p className="text-xs text-stone-500 mt-1">
                Per-article Markdown export is available from each article's reader view. Bulk export coming soon.
              </p>
            </div>
            <FileDown size={18} className="text-stone-400 shrink-0" />
          </div>
        </section>
      </main>
    </div>
  );
}
