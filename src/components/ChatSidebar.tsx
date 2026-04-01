import { useState, useRef, useEffect } from "react";
import {
  MessageSquare,
  Send,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
} from "lucide-react";
import { getConversation, saveConversation, deleteConversation } from "../db";
import type { Article, ChatMessage, ModelId } from "../types";
import { MODELS } from "../types";

interface Props {
  article: Article;
  open: boolean;
  onToggle: (open: boolean) => void;
}

export default function ChatSidebar({ article, open, onToggle }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [model, setModel] = useState<ModelId>("claude-sonnet-4-6");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load existing conversation once
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

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

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
          articleContent: article.textContent,
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
                setMessages([
                  ...newMessages,
                  { role: "assistant", content: assistantText },
                ]);
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
    if (streaming) {
      abortRef.current?.abort();
    }
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
    const elements: JSX.Element[] = [];
    let key = 0;

    for (const line of lines) {
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          elements.push(
            <pre key={key++}><code>{codeLines.join("\n")}</code></pre>
          );
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
        elements.push(
          <p key={key++} dangerouslySetInnerHTML={{ __html: formatted }} />
        );
      }
    }
    if (inCodeBlock && codeLines.length) {
      elements.push(<pre key={key++}><code>{codeLines.join("\n")}</code></pre>);
    }
    return elements;
  }

  return (
    <>
      {/* Toggle tab — always visible on right edge */}
      <button
        onClick={() => onToggle(!open)}
        className={`fixed top-3 z-50 p-2 rounded-lg transition-all duration-300
                    font-sans text-xs font-medium flex items-center gap-1.5
                    ${open
                      ? "right-[408px] bg-white text-stone-500 hover:text-stone-700 border border-stone-200 shadow-sm"
                      : "right-4 bg-stone-900 text-white hover:bg-stone-800 shadow-lg"
                    }`}
      >
        {open ? <PanelRightClose size={16} /> : <><PanelRightOpen size={16} /> Chat</>}
      </button>

      {/* Sidebar panel */}
      <div
        className={`fixed right-0 top-0 h-full bg-white border-l border-stone-200 shadow-xl
                     flex flex-col z-40 transition-transform duration-300 ease-in-out w-[400px]
                     ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 shrink-0">
          <span className="font-sans text-sm font-medium text-stone-700">Chat</span>
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
                className="p-1 text-stone-400 hover:text-stone-600 rounded"
                title="Clear chat"
              >
                <RotateCcw size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12 text-stone-400 font-sans text-sm">
              <MessageSquare size={32} className="mx-auto mb-3 opacity-40" />
              <p>Ask anything about this article</p>
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

        {/* Input */}
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
      </div>
    </>
  );
}
