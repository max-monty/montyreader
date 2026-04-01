import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { type User } from "firebase/auth";
import { isConfigured, onAuthChange, signInWithGoogle, signInAsGuest } from "./firebase";
import Library from "./components/Library";
import Reader from "./components/Reader";

function SetupScreen() {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="max-w-lg mx-auto px-6 text-center font-sans">
        <h1 className="text-2xl font-semibold text-stone-900 mb-4">Reader</h1>
        <div className="bg-white border border-stone-200 rounded-xl p-6 text-left">
          <h2 className="font-semibold text-stone-800 mb-3">Firebase setup required</h2>
          <p className="text-sm text-stone-600">
            Add your Firebase config to <code className="bg-stone-100 px-1.5 py-0.5 rounded text-xs">.env</code> and restart the dev server.
          </p>
        </div>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGoogle() {
    setLoading(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || "Sign-in failed");
      setLoading(false);
    }
  }

  async function handleGuest() {
    setLoading(true);
    setError("");
    try {
      await signInAsGuest();
    } catch (err: any) {
      setError(err.message || "Sign-in failed");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="text-center font-sans">
        <h1 className="text-3xl font-semibold text-stone-900 mb-2">Reader</h1>
        <p className="text-stone-500 text-sm mb-8">Save and read articles with AI assistance</p>
        <div className="flex flex-col gap-3">
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="inline-flex items-center justify-center gap-3 px-6 py-3 bg-white border border-stone-300 rounded-lg
                       shadow-sm hover:bg-stone-50 hover:shadow transition-all disabled:opacity-50
                       text-sm font-medium text-stone-700 min-w-[260px]"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            {loading ? "Signing in..." : "Sign in with Google"}
          </button>
          <button
            onClick={handleGuest}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-stone-100 border border-stone-200 rounded-lg
                       hover:bg-stone-200 transition-all disabled:opacity-50
                       text-sm text-stone-500 min-w-[260px]"
          >
            Continue as guest
          </button>
        </div>
        {error && (
          <p className="mt-4 text-sm text-red-600 max-w-xs mx-auto">{error}</p>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured) {
      setAuthLoading(false);
      return;
    }
    const unsub = onAuthChange((u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  if (!isConfigured) return <SetupScreen />;
  if (authLoading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-stone-400 font-sans text-sm">Loading...</div>
      </div>
    );
  }
  if (!user) return <LoginScreen />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/read/:id" element={<Reader />} />
      </Routes>
    </BrowserRouter>
  );
}
