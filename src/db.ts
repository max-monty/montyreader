import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { firestore, getCurrentUserId } from "./firebase";
import type { Article, Highlight, Conversation, Note, VocabEntry, Folder } from "./types";
import { deleteDocument } from "./utils/storage";

function getDb() {
  if (!firestore) throw new Error("Firebase not configured");
  return firestore;
}

function uid() {
  return getCurrentUserId();
}

function col(name: string) {
  return collection(getDb(), name);
}

// Articles
export async function saveArticle(article: Omit<Article, "id" | "userId">): Promise<string> {
  const ref = await addDoc(col("articles"), {
    ...article,
    kind: article.kind ?? "web",
    userId: uid(),
    savedAt: article.savedAt ?? Date.now(),
  });
  return ref.id;
}

export async function getArticle(id: string): Promise<Article | null> {
  const snap = await getDoc(doc(getDb(), "articles", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Article;
}

export async function updateArticlePosition(id: string, position: string | number): Promise<void> {
  try {
    await updateDoc(doc(getDb(), "articles", id), { position, lastReadAt: Date.now() });
  } catch (err) {
    console.warn("Failed to save position", err);
  }
}

export async function setArticleFolders(id: string, folderIds: string[]): Promise<void> {
  await updateDoc(doc(getDb(), "articles", id), { folderIds });
}

// Folders
export async function listFolders(): Promise<Folder[]> {
  const q = query(col("folders"), where("userId", "==", uid()));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Folder);
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createFolder(name: string): Promise<string> {
  const ref = await addDoc(col("folders"), { name: name.trim(), userId: uid(), createdAt: Date.now() });
  return ref.id;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await updateDoc(doc(getDb(), "folders", id), { name: name.trim() });
}

export async function deleteFolder(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "folders", id));
}

export async function touchArticle(id: string): Promise<void> {
  try {
    await updateDoc(doc(getDb(), "articles", id), { lastReadAt: Date.now() });
  } catch (err) {
    console.warn("Failed to touch article", err);
  }
}

export async function listArticles(): Promise<Article[]> {
  const q = query(
    col("articles"),
    where("userId", "==", uid()),
    orderBy("savedAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Article);
}

export async function findArticleByUrl(url: string): Promise<Article | null> {
  const q = query(
    col("articles"),
    where("userId", "==", uid()),
    where("url", "==", url),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as Article;
}

export async function deleteArticle(id: string): Promise<void> {
  // Look up the article first so we can also remove any associated Storage object.
  try {
    const snap = await getDoc(doc(getDb(), "articles", id));
    if (snap.exists()) {
      const data = snap.data() as Article;
      if (data.storagePath) {
        await deleteDocument(data.storagePath).catch((err) => console.warn("Storage delete failed:", err));
      }
    }
  } catch (err) {
    console.warn("Pre-delete fetch failed:", err);
  }
  await deleteDoc(doc(getDb(), "articles", id));
  const hq = query(col("highlights"), where("articleId", "==", id));
  const hs = await getDocs(hq);
  for (const h of hs.docs) await deleteDoc(h.ref);
  const cq = query(col("conversations"), where("articleId", "==", id));
  const cs = await getDocs(cq);
  for (const c of cs.docs) await deleteDoc(c.ref);
  const nq = query(col("notes"), where("articleId", "==", id));
  const ns = await getDocs(nq);
  for (const n of ns.docs) await deleteDoc(n.ref);
}

// Highlights
export async function addHighlight(highlight: Omit<Highlight, "id" | "userId">): Promise<string> {
  const ref = await addDoc(col("highlights"), {
    ...highlight,
    userId: uid(),
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function listHighlights(articleId: string): Promise<Highlight[]> {
  // Single-field query (no composite index needed) — sort/filter client-side.
  const q = query(col("highlights"), where("userId", "==", uid()));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Highlight)
    .filter((h) => h.articleId === articleId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function listAllHighlights(): Promise<Highlight[]> {
  const q = query(col("highlights"), where("userId", "==", uid()));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Highlight)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteHighlight(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "highlights", id));
  // Cascade-delete notes attached to this highlight
  const nq = query(col("notes"), where("highlightId", "==", id));
  const ns = await getDocs(nq);
  for (const n of ns.docs) await deleteDoc(n.ref);
}

// Notes
export async function addNote(note: Omit<Note, "id" | "userId" | "createdAt" | "updatedAt"> & { createdAt?: number; updatedAt?: number }): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(col("notes"), {
    ...note,
    articleId: note.articleId ?? null,
    highlightId: note.highlightId ?? null,
    userId: uid(),
    createdAt: note.createdAt ?? now,
    updatedAt: note.updatedAt ?? now,
  });
  return ref.id;
}

export async function updateNote(id: string, body: string): Promise<void> {
  await updateDoc(doc(getDb(), "notes", id), {
    body,
    updatedAt: Date.now(),
  });
}

export async function deleteNote(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "notes", id));
}

export async function listNotes(articleId: string): Promise<Note[]> {
  // Single-field query (no composite index needed) — filter/sort client-side.
  const q = query(col("notes"), where("userId", "==", uid()));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Note)
    .filter((n) => n.articleId === articleId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function listAllNotes(): Promise<Note[]> {
  const q = query(col("notes"), where("userId", "==", uid()));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Note)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// Vocab
export async function addVocab(entry: Omit<VocabEntry, "id" | "userId" | "createdAt"> & { createdAt?: number }): Promise<string> {
  const ref = await addDoc(col("vocab"), {
    ...entry,
    articleId: entry.articleId ?? null,
    context: entry.context ?? null,
    userId: uid(),
    createdAt: entry.createdAt ?? Date.now(),
  });
  return ref.id;
}

export async function listAllVocab(): Promise<VocabEntry[]> {
  const q = query(col("vocab"), where("userId", "==", uid()));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as VocabEntry)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteVocab(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "vocab", id));
}

// Conversations
export async function getConversation(articleId: string): Promise<Conversation | null> {
  const q = query(
    col("conversations"),
    where("userId", "==", uid()),
    where("articleId", "==", articleId),
    orderBy("updatedAt", "desc"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as Conversation;
}

export async function listConversations(articleId: string): Promise<Conversation[]> {
  const q = query(
    col("conversations"),
    where("userId", "==", uid()),
    where("articleId", "==", articleId),
    orderBy("updatedAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Conversation);
}

export async function saveConversation(
  conv: Omit<Conversation, "id" | "userId"> & { id?: string }
): Promise<string> {
  if (conv.id) {
    const ref = doc(getDb(), "conversations", conv.id);
    await updateDoc(ref, {
      messages: conv.messages,
      model: conv.model,
      updatedAt: Date.now(),
    });
    return conv.id;
  } else {
    const ref = await addDoc(col("conversations"), {
      articleId: conv.articleId,
      messages: conv.messages,
      model: conv.model,
      userId: uid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return ref.id;
  }
}

export async function deleteConversation(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "conversations", id));
}
