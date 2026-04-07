import express from "express";
import cors from "cors";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

dotenv.config();

// Init Firebase Admin (uses GOOGLE_APPLICATION_CREDENTIALS or default credentials)
try {
  initializeApp();
} catch {}
const db = getFirestore();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Fetch and parse an article
app.post("/api/fetch-article", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      res.status(400).json({ error: "URL is required" });
      return;
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Failed to fetch: ${response.statusText}` });
      return;
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      res.status(422).json({ error: "Could not parse article content" });
      return;
    }

    // Resolve relative image URLs to absolute
    const contentDom = new JSDOM(article.content);
    const images = contentDom.window.document.querySelectorAll("img");
    images.forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !src.startsWith("http") && !src.startsWith("data:")) {
        try {
          img.setAttribute("src", new URL(src, url).href);
        } catch {}
      }
    });
    // Also resolve srcset
    const srcsetImgs = contentDom.window.document.querySelectorAll("[srcset]");
    srcsetImgs.forEach((img) => {
      const srcset = img.getAttribute("srcset");
      if (srcset) {
        const resolved = srcset.replace(/(\S+)(\s+\S+)/g, (_, src, descriptor) => {
          if (!src.startsWith("http") && !src.startsWith("data:")) {
            try {
              return new URL(src, url).href + descriptor;
            } catch {}
          }
          return src + descriptor;
        });
        img.setAttribute("srcset", resolved);
      }
    });

    // Resolve relative links
    const links = contentDom.window.document.querySelectorAll("a[href]");
    links.forEach((a) => {
      const href = a.getAttribute("href");
      if (href && !href.startsWith("http") && !href.startsWith("#") && !href.startsWith("mailto:")) {
        try {
          a.setAttribute("href", new URL(href, url).href);
        } catch {}
      }
    });

    res.json({
      title: article.title,
      byline: article.byline,
      content: contentDom.window.document.body.innerHTML,
      textContent: article.textContent,
      excerpt: article.excerpt,
      siteName: article.siteName,
      publishedTime: article.publishedTime,
    });
  } catch (error: any) {
    console.error("Fetch error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch article" });
  }
});

// Parse raw pasted text into article shape (no fetching, no DB write)
app.post("/api/parse-text", async (req, res) => {
  try {
    const { url, text, title } = req.body;
    if (!url || !text) {
      res.status(400).json({ error: "url and text are required" });
      return;
    }
    const paragraphs = String(text)
      .split(/\n\s*\n+/)
      .map((p: string) => p.trim())
      .filter(Boolean)
      .map((p: string) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`)
      .join("\n");
    let siteName: string | null = null;
    try { siteName = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    const finalTitle = title || (text.split("\n").find((l: string) => l.trim())?.slice(0, 120) || "Untitled");
    res.json({
      title: finalTitle,
      byline: null,
      content: paragraphs,
      textContent: text,
      excerpt: text.slice(0, 200).replace(/\s+/g, " ").trim(),
      siteName,
      publishedTime: null,
    });
  } catch (error: any) {
    console.error("Parse-text error:", error);
    res.status(500).json({ error: error.message || "Failed to parse text" });
  }
});

// Clip: accept raw HTML from bookmarklet, parse, save to Firestore
app.post("/api/clip", async (req, res) => {
  try {
    const { html, url, userId } = req.body;
    if (!html || !url || !userId) {
      res.status(400).json({ error: "html, url, and userId are required" });
      return;
    }

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      res.status(422).json({ error: "Could not parse article content" });
      return;
    }

    // Resolve relative URLs
    const contentDom = new JSDOM(article.content);
    contentDom.window.document.querySelectorAll("img[src]").forEach((img: Element) => {
      const src = img.getAttribute("src");
      if (src && !src.startsWith("http") && !src.startsWith("data:")) {
        try { img.setAttribute("src", new URL(src, url).href); } catch {}
      }
    });
    contentDom.window.document.querySelectorAll("a[href]").forEach((a: Element) => {
      const href = a.getAttribute("href");
      if (href && !href.startsWith("http") && !href.startsWith("#") && !href.startsWith("mailto:")) {
        try { a.setAttribute("href", new URL(href, url).href); } catch {}
      }
    });

    const docRef = await db.collection("articles").add({
      url,
      title: article.title || "Untitled",
      byline: article.byline || null,
      content: contentDom.window.document.body.innerHTML,
      textContent: article.textContent,
      excerpt: article.excerpt || null,
      siteName: article.siteName || null,
      publishedTime: article.publishedTime || null,
      userId,
      savedAt: Date.now(),
    });

    res.json({ id: docRef.id });
  } catch (error: any) {
    console.error("Clip error:", error);
    res.status(500).json({ error: error.message || "Failed to clip article" });
  }
});

// Sign a Cloud Storage path → proxy to the deployed Cloud Function, which has
// service-account credentials available for signing. Avoids requiring a local
// service-account JSON during development.
const SIGN_PROXY_URL =
  process.env.SIGN_PROXY_URL ||
  "https://monty-reader.web.app/api/sign";
app.post("/api/sign", async (req, res) => {
  try {
    const upstream = await fetch(SIGN_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const text = await upstream.text();
    res.status(upstream.status).type("application/json").send(text);
  } catch (error: any) {
    console.error("Sign proxy error:", error);
    res.status(500).json({ error: error.message || "Failed to sign URL" });
  }
});

// Chat with Claude (streaming)
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, model, articleContent, articleTitle } = req.body;

    const systemPrompt = `You are a helpful reading assistant. The user is reading an article and may ask questions about it. Be concise and direct in your responses.

Article Title: ${articleTitle}

Article Content:
${articleContent}`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = anthropic.messages.stream({
      model: model || "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error: any) {
    console.error("Chat error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Chat failed" });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/define", async (req, res) => {
  try {
    const { word, context } = req.body;
    if (!word || typeof word !== "string") {
      res.status(400).json({ error: "word is required" });
      return;
    }
    const cleaned = word.trim().slice(0, 64);
    if (!cleaned) { res.status(400).json({ error: "word is required" }); return; }

    const userMsg = context
      ? `Define the word "${cleaned}" as it is used in this sentence:\n\n"${String(context).slice(0, 500)}"\n\nGive a concise dictionary-style definition (1-2 short sentences). If the word has multiple meanings, only give the meaning that fits the context. No preamble.`
      : `Define the word "${cleaned}" with a concise dictionary-style definition (1-2 short sentences). No preamble.`;

    const result = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [{ role: "user", content: userMsg }],
    });

    const text = ((result?.content || []) as any[])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    res.json({ word: cleaned, definition: text });
  } catch (error: any) {
    console.error("Define error:", error);
    res.status(500).json({ error: error.message || "Failed to define word" });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
