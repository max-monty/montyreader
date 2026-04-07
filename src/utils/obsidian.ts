// Obsidian vault sync via the File System Access API.
//
// Limitations:
//   - Chromium-only (Chrome, Edge, Brave, Arc, Opera). Safari/Firefox: not supported.
//   - The directory handle is persisted in IndexedDB; on each new tab, the user must
//     re-grant permission via verifyPermission(). The browser remembers the choice
//     for the session.
//   - Only writes — this is one-way sync (Reader → vault).
//   - Each article becomes one .md file at the vault root (or in a subfolder if set).

import type { Article, Highlight, Note } from "../types";
import { articleToMarkdown, slugify } from "./markdown";
import { listHighlights, listNotes } from "../db";

const DB_NAME = "reader-fs";
const STORE = "handles";
const VAULT_KEY = "vault";
const SUBFOLDER_KEY = "vault-subfolder";

export function isFileSystemAccessSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "showDirectoryPicker" in window;
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: any): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function pickVault(): Promise<{ name: string } | null> {
  if (!isFileSystemAccessSupported()) throw new Error("File System Access API not supported in this browser. Use Chrome, Edge, Brave, or Arc.");
  // @ts-ignore
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  await idbSet(VAULT_KEY, handle);
  return { name: handle.name };
}

export async function getVaultInfo(): Promise<{ name: string; subfolder: string | null } | null> {
  const handle = await idbGet<any>(VAULT_KEY);
  if (!handle) return null;
  const subfolder = (await idbGet<string>(SUBFOLDER_KEY)) || null;
  return { name: handle.name, subfolder };
}

export async function setSubfolder(folder: string | null): Promise<void> {
  if (folder) await idbSet(SUBFOLDER_KEY, folder);
  else await idbDel(SUBFOLDER_KEY);
}

export async function clearVault(): Promise<void> {
  await idbDel(VAULT_KEY);
}

async function verifyPermission(handle: any, write: boolean): Promise<boolean> {
  const opts = { mode: write ? "readwrite" : "read" };
  // @ts-ignore
  if ((await handle.queryPermission(opts)) === "granted") return true;
  // @ts-ignore
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

async function getTargetDir(): Promise<any> {
  const handle = await idbGet<any>(VAULT_KEY);
  if (!handle) throw new Error("No vault folder set. Pick one in Settings first.");
  const ok = await verifyPermission(handle, true);
  if (!ok) throw new Error("Permission to write to vault was denied.");
  const subfolder = await idbGet<string>(SUBFOLDER_KEY);
  if (!subfolder) return handle;
  // Walk/create nested subfolders separated by /
  let dir = handle;
  for (const part of subfolder.split("/").map((p) => p.trim()).filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

export async function syncArticleToVault(article: Article): Promise<string> {
  const dir = await getTargetDir();
  const [highlights, notes] = await Promise.all([
    listHighlights(article.id).catch(() => [] as Highlight[]),
    listNotes(article.id).catch(() => [] as Note[]),
  ]);
  const md = articleToMarkdown({ article, highlights, notes });
  const filename = `${slugify(article.title)}.md`;
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(md);
  await writable.close();
  return filename;
}

export async function syncManyToVault(articles: Article[]): Promise<{ written: number; failed: number }> {
  let written = 0, failed = 0;
  for (const a of articles) {
    try {
      await syncArticleToVault(a);
      written++;
    } catch (e) {
      console.error("Sync failed for", a.title, e);
      failed++;
    }
  }
  return { written, failed };
}
