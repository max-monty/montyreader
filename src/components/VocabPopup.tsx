import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { addVocab } from "../db";

interface Props {
  word: string;
  context?: string | null;
  articleId?: string | null;
  x: number;
  y: number;
  onClose: () => void;
  onSaved?: () => void;
}

// Floating dictionary popup. Fetches a definition from /api/define on mount,
// auto-saves it to the user's vocab collection, and shows the result.
export default function VocabPopup({ word, context, articleId, x, y, onClose, onSaved }: Props) {
  const [definition, setDefinition] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/define", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word, context: context || null }),
        });
        if (!res.ok) {
          let msg = "Failed to define word";
          try { msg = (await res.json()).error || msg; } catch {}
          throw new Error(msg);
        }
        const data = await res.json();
        if (cancelled) return;
        const def = (data?.definition || "").trim();
        setDefinition(def);
        setLoading(false);
        if (def) {
          try {
            await addVocab({
              word: data.word || word,
              definition: def,
              context: context || null,
              articleId: articleId || null,
            });
            if (!cancelled) {
              setSaved(true);
              onSaved?.();
            }
          } catch (err) {
            console.warn("Failed to save vocab:", err);
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message || "Failed to define word");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clamp x within viewport so the popup doesn't go off-screen.
  const width = 320;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, x - width / 2));
  const top = Math.max(12, y + 14);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white border border-stone-200 rounded-lg shadow-xl p-3"
        style={{ left, top, width }}
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-sans font-semibold text-stone-900 text-sm truncate">{word}</span>
            {saved && <Check size={12} className="text-green-600 shrink-0" />}
          </div>
          <button onClick={onClose} className="p-0.5 text-stone-400 hover:text-stone-700 rounded shrink-0">
            <X size={14} />
          </button>
        </div>
        {loading && <p className="text-xs font-sans text-stone-400">Looking up...</p>}
        {error && <p className="text-xs font-sans text-red-600">{error}</p>}
        {!loading && !error && (
          <p className="text-xs font-sans text-stone-700 leading-relaxed whitespace-pre-wrap">{definition}</p>
        )}
      </div>
    </>
  );
}
