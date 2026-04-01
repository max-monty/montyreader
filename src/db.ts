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
import type { Article, Highlight, Conversation } from "./types";

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
    userId: uid(),
    savedAt: Date.now(),
  });
  return ref.id;
}

export async function getArticle(id: string): Promise<Article | null> {
  const snap = await getDoc(doc(getDb(), "articles", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Article;
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
  await deleteDoc(doc(getDb(), "articles", id));
  const hq = query(col("highlights"), where("articleId", "==", id));
  const hs = await getDocs(hq);
  for (const h of hs.docs) await deleteDoc(h.ref);
  const cq = query(col("conversations"), where("articleId", "==", id));
  const cs = await getDocs(cq);
  for (const c of cs.docs) await deleteDoc(c.ref);
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
  const q = query(
    col("highlights"),
    where("userId", "==", uid()),
    where("articleId", "==", articleId),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Highlight);
}

export async function deleteHighlight(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "highlights", id));
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
