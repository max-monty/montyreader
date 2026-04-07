import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { storage, getCurrentUserId } from "../firebase";

function getStorageOrThrow() {
  if (!storage) {
    throw new Error("Firebase Storage is not initialized — enable Storage in the Firebase console.");
  }
  return storage;
}

export async function uploadDocument(file: File, kind: "pdf" | "epub"): Promise<{ path: string; url: string; size: number }> {
  const s = getStorageOrThrow();
  const uid = getCurrentUserId();
  const ts = Date.now();
  // Sanitize filename: keep extension, strip path/special chars
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `users/${uid}/${kind}/${ts}-${safe}`;
  const ref = storageRef(s, path);
  await uploadBytes(ref, file, { contentType: file.type || (kind === "pdf" ? "application/pdf" : "application/epub+zip") });
  const url = await getDownloadURL(ref);
  return { path, url, size: file.size };
}

export async function getDocumentUrl(path: string): Promise<string> {
  const s = getStorageOrThrow();
  return getDownloadURL(storageRef(s, path));
}

export async function deleteDocument(path: string): Promise<void> {
  const s = getStorageOrThrow();
  try {
    await deleteObject(storageRef(s, path));
  } catch (err) {
    console.warn("Failed to delete storage object", err);
  }
}
