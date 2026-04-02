import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import express from "express";
import cors from "cors";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import Anthropic from "@anthropic-ai/sdk";

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

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
  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch article" });
  }
});

// Chat with Claude (streaming)
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, model, articleContent, articleTitle } = req.body;

    const anthropic = new Anthropic({
      apiKey: anthropicApiKey.value(),
    });

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
      messages: messages.map((m) => ({
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
  } catch (error) {
    console.error("Chat error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Chat failed" });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

export const api = onRequest(
  {
    secrets: [anthropicApiKey],
    timeoutSeconds: 120,
    memory: "512MiB",
    region: "us-central1",
    invoker: "public",
  },
  app
);
