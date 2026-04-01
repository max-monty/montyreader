import type { HighlightColor } from "../types";

const COLORS: { color: HighlightColor; bg: string }[] = [
  { color: "yellow", bg: "bg-yellow-300" },
  { color: "green", bg: "bg-green-300" },
  { color: "blue", bg: "bg-blue-300" },
  { color: "pink", bg: "bg-pink-300" },
];

interface Props {
  position: { x: number; y: number };
  onHighlight: (color: HighlightColor) => void;
  onClose: () => void;
}

export default function HighlightMenu({ position, onHighlight, onClose }: Props) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 flex items-center gap-1.5 bg-white rounded-lg shadow-lg border border-stone-200 px-2 py-1.5"
        style={{
          left: position.x,
          top: position.y - 45,
          transform: "translateX(-50%)",
        }}
      >
        {COLORS.map(({ color, bg }) => (
          <button
            key={color}
            onClick={() => onHighlight(color)}
            className={`w-6 h-6 rounded-full ${bg} hover:scale-110 transition-transform
                       ring-1 ring-black/10`}
            title={color}
          />
        ))}
      </div>
    </>
  );
}
