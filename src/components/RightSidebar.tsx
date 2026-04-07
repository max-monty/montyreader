import { useState, useRef, useEffect } from "react";
import {
  MessageSquare,
  Send,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Plus,
  Clock,
  ChevronDown,
  Highlighter,
  StickyNote,
  Trash2,
  Edit3,
  Check,
  X,
  CornerDownLeft,
  BookOpen,
} from "lucide-react";
import {
  getConversation,
  listConversations,
  saveConversation,
  deleteConversation,
  addNote,
  updateNote,
  deleteNote,
} from "../db";
import type { Article, ChatMessage, Conversation, ModelId, Highlight, Note } from "../types";
import { MODELS } from "../types";

type TabId = "chat" | "highlights" | "notes";

export interface BookSection {
  id: string;
  label: string;
  text: string;
}

interface Props {
  article: Article;
  open: boolean;
  onToggle: (open: boolean) => void;
  highlights: Highlight[];
  notes: Note[];
  onJumpToHighlight: (h: Highlight) => void;
  onDeleteHighlight: (id: string) => void;
  onNotesChanged: () => void;
  // EPUB-only: per-section book text + the section currently visible.
  sections?: BookSection[];
  currentSectionId?: string | null;
}

export default function RightSidebar({
  article,
  open,
  onToggle,
  highlights,
  notes,
  onJumpToHighlight,
  onDeleteHighlight,
  onNotesChanged,
  sections,
  currentSectionId,
}: Props) {
  const [tab, setTab] = useState<TabId>("chat");

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => onToggle(!open)}
        className={`fixed z-50 p-2 rounded-lg transition-all duration-300
                    font-sans text-xs font-medium flex items-center gap-1.5
                    ${open
                      ? "top-[52px] right-[408px] bg-white text-stone-500 hover:text-stone-700 border border-stone-200 shadow-sm"
                      : "top-[52px] right-3 bg-stone-900 text-white hover:bg-stone-800 shadow-lg"
                    }`}
      >
        {open ? <PanelRightClose size={16} /> : <><PanelRightOpen size={16} /> Sidebar</>}
      </button>

      {/* Sidebar panel */}
      <div
        className={`fixed right-0 top-0 h-full bg-white border-l border-stone-200 shadow-xl
                     flex flex-col z-40 transition-transform duration-300 ease-in-out w-[400px]
                     ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Tabs */}
        <div className="flex items-center border-b border-stone-200 shrink-0 px-2 pt-2">
          <TabButton id="chat" active={tab} onClick={setTab} icon={<MessageSquare size={14} />} label="Chat" />
          <TabButton id="highlights" active={tab} onClick={setTab} icon={<Highlighter size={14} />} label={`Highlights${highlights.length ? ` (${highlights.length})` : ""}`} />
          <TabButton id="notes" active={tab} onClick={setTab} icon={<StickyNote size={14} />} label={`Notes${notes.length ? ` (${notes.length})` : ""}`} />
        </div>

        {tab === "chat" && <ChatTab article={article} sections={sections} currentSectionId={currentSectionId} />}
        {tab === "highlights" && (
          <HighlightsTab
            highlights={highlights}
            notes={notes}
            articleId={article.id}
            onJump={onJumpToHighlight}
            onDelete={onDeleteHighlight}
            onNotesChanged={onNotesChanged}
          />
        )}
        {tab === "notes" && (
          <NotesTab
            notes={notes}
            highlights={highlights}
            articleId={article.id}
            onChanged={onNotesChanged}
          />
        )}
      </div>
    </>
  );
}

function TabButton({
  id, active, onClick, icon, label,
}: {
  id: TabId; active: TabId; onClick: (id: TabId) => void; icon: React.ReactNode; label: string;
}) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-sans font-medium rounded-t transition-colors
                  ${isActive ? "text-stone-900 border-b-2 border-stone-900 -mb-px" : "text-stone-400 hover:text-stone-700"}`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ---------- CHAT TAB ---------- */

function ChatTab({
  article,
  sections,
  currentSectionId,
}: {
  article: Article;
  sections?: BookSection[];
  currentSectionId?: string | null;
}) {
  const isBook = article.kind === "epub";
  const sectionsReady = !!sections && sections.length > 0;
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(new Set());
  const [userTouchedSections, setUserTouchedSections] = useState(false);
  const [showSectionPicker, setShowSectionPicker] = useState(false);

  // Default selection follows the current section unless the user manually
  // edited the picker.
  useEffect(() => {
    if (!sectionsReady || userTouchedSections) return;
    if (currentSectionId) {
      setSelectedSectionIds(new Set([currentSectionId]));
    }
  }, [sectionsReady, currentSectionId, userTouchedSections]);

  function toggleSection(id: string) {
    setUserTouchedSections(true);
    setSelectedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllSections() {
    setUserTouchedSections(true);
    setSelectedSectionIds(new Set((sections || []).map((s) => s.id)));
  }
  function clearSections() {
    setUserTouchedSections(true);
    setSelectedSectionIds(new Set());
  }
  function resetToCurrent() {
    setUserTouchedSections(false);
    if (currentSectionId) setSelectedSectionIds(new Set([currentSectionId]));
    else setSelectedSectionIds(new Set());
  }

  function buildContextText(): string {
    if (!isBook) return article.textContent || "";
    if (!sections || selectedSectionIds.size === 0) return "";
    const ordered = sections.filter((s) => selectedSectionIds.has(s.id));
    return ordered
      .map((s) => `## ${s.label}\n\n${s.text}`)
      .join("\n\n---\n\n");
  }

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [model, setModel] = useState<ModelId>("claude-sonnet-4-6");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!article.id || loaded) return;
    getConversation(article.id)
      .then((conv) => {
        if (conv) {
          setMessages(conv.messages);
          setModel(conv.model as ModelId);
          setConversationId(conv.id || null);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [article.id, loaded]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadHistory() {
    if (!article.id) return;
    try {
      const convs = await listConversations(article.id);
      setConversations(convs);
      setShowHistory(true);
    } catch {}
  }

  function selectConversation(conv: Conversation) {
    setMessages(conv.messages);
    setModel(conv.model as ModelId);
    setConversationId(conv.id || null);
    setShowHistory(false);
  }

  function startNewChat() {
    setMessages([]);
    setConversationId(null);
    setShowHistory(false);
  }

  async function persistConversation(msgs: ChatMessage[]) {
    if (!article.id) return;
    try {
      const now = Date.now();
      const id = await saveConversation({
        id: conversationId || undefined,
        articleId: article.id,
        messages: msgs,
        model,
        createdAt: now,
        updatedAt: now,
      });
      if (!conversationId) setConversationId(id);
    } catch (err) {
      console.error("Failed to save conversation:", err);
    }
  }

  async function sendMessage() {
    if (!input.trim() || streaming) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          model,
          articleContent: buildContextText(),
          articleTitle: article.title,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Chat request failed");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                assistantText += parsed.text;
                setMessages([...newMessages, { role: "assistant", content: assistantText }]);
              }
            } catch {}
          }
        }
      }

      const finalMessages: ChatMessage[] = [
        ...newMessages,
        { role: "assistant", content: assistantText },
      ];
      setMessages(finalMessages);
      await persistConversation(finalMessages);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error("Chat error:", err);
      setMessages([
        ...newMessages,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function clearChat() {
    if (streaming) abortRef.current?.abort();
    setMessages([]);
    if (conversationId) {
      await deleteConversation(conversationId).catch(() => {});
      setConversationId(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function renderMessage(content: string) {
    const lines = content.split("\n");
    let inCodeBlock = false;
    let codeLines: string[] = [];
    const elements: React.ReactElement[] = [];
    let key = 0;
    for (const line of lines) {
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          elements.push(<pre key={key++}><code>{codeLines.join("\n")}</code></pre>);
          codeLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) { codeLines.push(line); continue; }
      if (line.trim() === "") {
        elements.push(<br key={key++} />);
      } else {
        const formatted = line
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/`(.*?)`/g, '<code>$1</code>');
        elements.push(<p key={key++} dangerouslySetInnerHTML={{ __html: formatted }} />);
      }
    }
    if (inCodeBlock && codeLines.length) {
      elements.push(<pre key={key++}><code>{codeLines.join("\n")}</code></pre>);
    }
    return elements;
  }

  function formatTime(ts: number) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function getPreview(conv: Conversation): string {
    const first = conv.messages.find(m => m.role === "user");
    if (!first) return "Empty conversation";
    return first.content.length > 60 ? first.content.substring(0, 60) + "..." : first.content;
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 border-b border-stone-100 shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={loadHistory}
            className="p-1 text-stone-400 hover:text-stone-600 rounded"
            title="Chat history"
          >
            <Clock size={14} />
          </button>
          <button
            onClick={startNewChat}
            className="p-1 text-stone-400 hover:text-stone-600 rounded"
            title="New chat"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelId)}
            className="text-xs font-sans bg-stone-100 border-0 rounded px-2 py-1.5
                       text-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-300"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="p-1 text-stone-400 hover:text-red-500 rounded"
              title="Delete chat"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      {isBook && (
        <div className="px-4 py-2 border-b border-stone-100 shrink-0">
          <button
            onClick={() => setShowSectionPicker((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-xs font-sans text-stone-600 hover:text-stone-900 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg px-3 py-1.5"
            title="Choose which book sections to send as context"
          >
            <span className="flex items-center gap-1.5">
              <BookOpen size={12} />
              Context: {selectedSectionIds.size === 0 ? "none" : `${selectedSectionIds.size} section${selectedSectionIds.size === 1 ? "" : "s"}`}
            </span>
            <ChevronDown size={12} className={`transition-transform ${showSectionPicker ? "rotate-180" : ""}`} />
          </button>
          {showSectionPicker && (
            <div className="mt-2 border border-stone-200 rounded-lg bg-white max-h-72 overflow-y-auto">
              {!sectionsReady ? (
                <div className="px-3 py-3 text-center text-[11px] font-sans text-stone-400">Loading book sections…</div>
              ) : (
              <>
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-stone-100 sticky top-0 bg-white">
                <button onClick={resetToCurrent} className="text-[11px] font-sans text-stone-500 hover:text-stone-900">Current only</button>
                <div className="flex items-center gap-2">
                  <button onClick={selectAllSections} className="text-[11px] font-sans text-stone-500 hover:text-stone-900">All</button>
                  <button onClick={clearSections} className="text-[11px] font-sans text-stone-500 hover:text-stone-900">None</button>
                </div>
              </div>
              {(sections || []).map((s) => {
                const isCurrent = s.id === currentSectionId;
                const checked = selectedSectionIds.has(s.id);
                return (
                  <label
                    key={s.id}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-sans cursor-pointer hover:bg-stone-50 ${isCurrent ? "bg-stone-50" : ""}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleSection(s.id)} className="accent-stone-900" />
                    <span className="flex-1 truncate text-stone-700">{s.label}</span>
                    {isCurrent && <span className="text-[10px] text-stone-400 shrink-0">current</span>}
                  </label>
                );
              })}
              </>
              )}
            </div>
          )}
        </div>
      )}

      {showHistory && (
        <div className="border-b border-stone-200 bg-stone-50 max-h-64 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="px-4 py-6 text-center text-stone-400 text-xs font-sans">
              No previous chats
            </div>
          ) : (
            <div className="py-1">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => selectConversation(conv)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-stone-100 transition-colors
                             ${conv.id === conversationId ? "bg-stone-100" : ""}`}
                >
                  <p className="text-xs font-sans text-stone-700 truncate">{getPreview(conv)}</p>
                  <p className="text-[10px] font-sans text-stone-400 mt-0.5">
                    {formatTime(conv.updatedAt)} · {conv.messages.length} messages
                  </p>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowHistory(false)}
            className="w-full py-1.5 text-center text-stone-400 hover:text-stone-600 border-t border-stone-200"
          >
            <ChevronDown size={14} className="mx-auto rotate-180" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12 text-stone-400 font-sans text-sm">
            <MessageSquare size={32} className="mx-auto mb-3 opacity-40" />
            <p>{isBook ? "Ask anything about the selected sections" : "Ask anything about this article"}</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={msg.role === "user" ? "ml-8" : "mr-4"}>
            <div
              className={`chat-message rounded-lg px-3.5 py-2.5 text-sm font-sans leading-relaxed ${
                msg.role === "user"
                  ? "bg-stone-900 text-white"
                  : "bg-stone-100 text-stone-800"
              }`}
            >
              {renderMessage(msg.content)}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="flex items-center gap-2 text-stone-400 text-sm font-sans pl-1">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-stone-200 px-4 py-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this article..."
            rows={1}
            className="flex-1 resize-none px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg
                       font-sans text-sm focus:outline-none focus:ring-1 focus:ring-stone-300
                       placeholder:text-stone-400 max-h-32"
            disabled={streaming}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 128) + "px";
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="p-2 bg-stone-900 text-white rounded-lg
                       hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------- HIGHLIGHTS TAB ---------- */

function HighlightsTab({
  highlights, notes, articleId, onJump, onDelete, onNotesChanged,
}: {
  highlights: Highlight[];
  notes: Note[];
  articleId: string;
  onJump: (h: Highlight) => void;
  onDelete: (id: string) => void;
  onNotesChanged: () => void;
}) {
  const [composingFor, setComposingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function notesFor(hId: string) {
    return notes.filter((n) => n.highlightId === hId);
  }

  async function saveNote(highlightId: string) {
    if (!draft.trim()) { setComposingFor(null); return; }
    await addNote({ articleId, highlightId, body: draft.trim() });
    setDraft("");
    setComposingFor(null);
    onNotesChanged();
  }

  if (highlights.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-6">
        <div className="text-stone-400 font-sans text-sm">
          <Highlighter size={32} className="mx-auto mb-3 opacity-40" />
          <p>No highlights yet</p>
          <p className="text-xs mt-1">Select text in the article to highlight it</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      {highlights.map((h) => {
        const linked = notesFor(h.id);
        return (
          <div
            key={h.id}
            className="group border-l-2 border-yellow-400 pl-3 py-1"
          >
            <button
              onClick={() => onJump(h)}
              className="text-left w-full text-sm text-stone-700 leading-snug hover:text-stone-900"
              title="Jump to highlight"
            >
              "{h.text}"
            </button>
            {linked.map((n) => (
              <div key={n.id} className="mt-1.5 text-xs text-stone-500 italic bg-stone-50 px-2 py-1 rounded">
                {n.body}
              </div>
            ))}
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-stone-400 font-sans">
                {new Date(h.createdAt).toLocaleDateString()}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onJump(h)}
                  className="p-1 text-stone-400 hover:text-stone-700 rounded"
                  title="Jump to highlight"
                >
                  <CornerDownLeft size={12} />
                </button>
                <button
                  onClick={() => { setComposingFor(h.id); setDraft(""); }}
                  className="p-1 text-stone-400 hover:text-stone-700 rounded"
                  title="Add note"
                >
                  <StickyNote size={12} />
                </button>
                <button
                  onClick={() => onDelete(h.id)}
                  className="p-1 text-stone-400 hover:text-red-500 rounded"
                  title="Delete highlight"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            {composingFor === h.id && (
              <div className="mt-2 space-y-2">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  placeholder="Add a note..."
                  className="w-full px-2 py-1.5 bg-stone-50 border border-stone-200 rounded text-xs font-sans focus:outline-none focus:ring-1 focus:ring-stone-300 resize-none"
                />
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => { setComposingFor(null); setDraft(""); }}
                    className="p-1 text-stone-400 hover:text-stone-600 rounded"
                  >
                    <X size={12} />
                  </button>
                  <button
                    onClick={() => saveNote(h.id)}
                    className="p-1 text-stone-400 hover:text-green-600 rounded"
                  >
                    <Check size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- NOTES TAB ---------- */

function NotesTab({
  notes, highlights, articleId, onChanged,
}: {
  notes: Note[];
  highlights: Highlight[];
  articleId: string;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  async function add() {
    if (!draft.trim()) return;
    await addNote({ articleId, highlightId: null, body: draft.trim() });
    setDraft("");
    onChanged();
  }

  async function saveEdit(id: string) {
    if (!editDraft.trim()) { setEditingId(null); return; }
    await updateNote(id, editDraft.trim());
    setEditingId(null);
    onChanged();
  }

  async function remove(id: string) {
    await deleteNote(id);
    onChanged();
  }

  function highlightText(hId: string | null | undefined): string | null {
    if (!hId) return null;
    return highlights.find((h) => h.id === hId)?.text || null;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {notes.length === 0 ? (
          <div className="text-center pt-12 text-stone-400 font-sans text-sm">
            <StickyNote size={32} className="mx-auto mb-3 opacity-40" />
            <p>No notes yet</p>
            <p className="text-xs mt-1">Add a note below or attach one to a highlight</p>
          </div>
        ) : (
          notes.map((n) => {
            const linkedText = highlightText(n.highlightId);
            const isEditing = editingId === n.id;
            return (
              <div key={n.id} className="group bg-white border border-stone-200 rounded-lg p-3 hover:border-stone-300 transition-colors">
                {linkedText && (
                  <div className="mb-2 text-[11px] text-stone-500 italic border-l-2 border-yellow-400 pl-2 line-clamp-2">
                    "{linkedText}"
                  </div>
                )}
                {isEditing ? (
                  <>
                    <textarea
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={3}
                      className="w-full px-2 py-1.5 bg-stone-50 border border-stone-200 rounded text-sm font-sans focus:outline-none focus:ring-1 focus:ring-stone-300 resize-none"
                    />
                    <div className="flex justify-end gap-1 mt-1">
                      <button onClick={() => setEditingId(null)} className="p-1 text-stone-400 hover:text-stone-600 rounded"><X size={12} /></button>
                      <button onClick={() => saveEdit(n.id)} className="p-1 text-stone-400 hover:text-green-600 rounded"><Check size={12} /></button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-stone-700 font-sans whitespace-pre-wrap leading-relaxed">{n.body}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-stone-400 font-sans">
                        {new Date(n.updatedAt).toLocaleDateString()}
                      </span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditingId(n.id); setEditDraft(n.body); }}
                          className="p-1 text-stone-400 hover:text-stone-700 rounded"
                          title="Edit"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          onClick={() => remove(n.id)}
                          className="p-1 text-stone-400 hover:text-red-500 rounded"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-stone-200 px-4 py-3 shrink-0">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); }
          }}
          rows={2}
          placeholder="Add a note... (Cmd+Enter to save)"
          className="w-full resize-none px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg
                     font-sans text-sm focus:outline-none focus:ring-1 focus:ring-stone-300
                     placeholder:text-stone-400"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={add}
            disabled={!draft.trim()}
            className="px-3 py-1.5 bg-stone-900 text-white rounded-lg text-xs font-medium
                       hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}
