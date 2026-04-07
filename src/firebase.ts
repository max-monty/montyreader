import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import {
  getAuth,
  signInWithPopup,
  signInAnonymously,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  onAuthStateChanged,
  type Auth,
  type User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

export const isConfigured = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;

let app: FirebaseApp | null = null;
let _firestore: Firestore | null = null;
let _auth: Auth | null = null;
let _storage: FirebaseStorage | null = null;

if (isConfigured) {
  app = initializeApp(firebaseConfig);
  _firestore = getFirestore(app);
  _auth = getAuth(app);
  try { _storage = getStorage(app); } catch {}
}

export const firestore = _firestore;
export const auth = _auth;
export const storage = _storage;

const googleProvider = new GoogleAuthProvider();

export function signInWithGoogle() {
  if (!_auth) throw new Error("Firebase not configured");
  return signInWithPopup(_auth, googleProvider);
}

export function signInAsGuest() {
  if (!_auth) throw new Error("Firebase not configured");
  return signInAnonymously(_auth);
}

export function signOut() {
  if (!_auth) throw new Error("Firebase not configured");
  return firebaseSignOut(_auth);
}

export function onAuthChange(callback: (user: User | null) => void) {
  if (!_auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(_auth, callback);
}

export function getCurrentUser(): User | null {
  return _auth?.currentUser || null;
}

export function getCurrentUserId(): string {
  const user = _auth?.currentUser;
  if (!user) throw new Error("Not authenticated");
  return user.uid;
}
