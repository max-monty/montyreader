import { Trash2, Highlighter } from "lucide-react";
import type { Highlight } from "../types";

interface Props {
  highlights: Highlight[];
  onDelete: (id: string) => void;
}

const COLOR_CLASSES: Record<string, string> = {
  yellow: "border-l-yellow-400",
  green: "border-l-green-400",
  blue: "border-l-blue-400",
  pink: "border-l-pink-400",
};

export default function HighlightsPanel({ highlights, onDelete }: Props) {
  if (highlights.length === 0) return null;

  return (
    <div className="mt-12 border-t border-stone-200 pt-8">
      <h3 className="font-sans text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Highlighter size={14} />
        Highlights ({highlights.length})
      </h3>
      <div className="space-y-3">
        {highlights.map((h) => (
          <div
            key={h.id}
            className={`group border-l-3 ${COLOR_CLASSES[h.color] || "border-l-stone-300"} pl-4 py-2`}
          >
            <p className="text-sm text-stone-700 leading-relaxed">"{h.text}"</p>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-stone-400 font-sans">
                {new Date(h.createdAt).toLocaleDateString()}
              </span>
              <button
                onClick={() => onDelete(h.id)}
                className="opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-red-500
                           transition-opacity"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
