import {
  ref as storageRef,
  uploadBytes,
  deleteObject,
} from "firebase/storage";
import { storage, getCurrentUserId } from "../firebase";

function getStorageOrThrow() {
  if (!storage) {
    throw new Error("Firebase Storage is not initialized — enable Storage in the Firebase console.");
  }
  return storage;
}

export async function uploadDocument(file: File, kind: "pdf" | "epub"): Promise<{ path: string; size: number }> {
  const s = getStorageOrThrow();
  const uid = getCurrentUserId();
  const ts = Date.now();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `users/${uid}/${kind}/${ts}-${safe}`;
  const ref = storageRef(s, path);
  await uploadBytes(ref, file, { contentType: file.type || (kind === "pdf" ? "application/pdf" : "application/epub+zip") });
  return { path, size: file.size };
}

// Returns a short-lived signed URL via the backend.
// Signed URLs are served from storage.googleapis.com which has permissive CORS,
// avoiding Firebase Storage's default download-endpoint CORS restrictions.
export async function getDocumentUrl(path: string): Promise<string> {
  const uid = getCurrentUserId();
  const res = await fetch("/api/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, userId: uid }),
  });
  if (!res.ok) {
    let msg = "Failed to get signed URL";
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const { url } = await res.json();
  return url;
}

export async function deleteDocument(path: string): Promise<void> {
  const s = getStorageOrThrow();
  try {
    await deleteObject(storageRef(s, path));
  } catch (err) {
    console.warn("Failed to delete storage object", err);
  }
}
