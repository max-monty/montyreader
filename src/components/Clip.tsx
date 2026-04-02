import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function Clip() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Redirecting...");

  useEffect(() => {
    const id = searchParams.get("id");
    if (id) {
      navigate(`/read/${id}`, { replace: true });
    } else {
      setStatus("No article ID. Something went wrong with the bookmarklet.");
    }
  }, []);

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="text-center font-sans">
        <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-900 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-stone-500">{status}</p>
      </div>
    </div>
  );
}
