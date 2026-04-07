import type { Article, Highlight, Note } from "../types";

// Slugify a title for filenames. Lowercase, ascii, dashes, max 80 chars.
export function slugify(title: string): string {
  return (title || "untitled")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function escapeYaml(s: string): string {
  if (s == null) return "";
  // Quote and escape double quotes for YAML strings
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString();
}

// Convert basic HTML article content to plain markdown.
// Best-effort: handles paragraphs, headings, links, lists, blockquotes, code, images.
export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  return nodeToMd(root).trim();
}

function nodeToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || "").replace(/\s+/g, " ");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const childMd = () => Array.from(el.childNodes).map(nodeToMd).join("");

  switch (tag) {
    case "h1": return `\n\n# ${childMd().trim()}\n\n`;
    case "h2": return `\n\n## ${childMd().trim()}\n\n`;
    case "h3": return `\n\n### ${childMd().trim()}\n\n`;
    case "h4": return `\n\n#### ${childMd().trim()}\n\n`;
    case "h5": return `\n\n##### ${childMd().trim()}\n\n`;
    case "h6": return `\n\n###### ${childMd().trim()}\n\n`;
    case "p":  return `\n\n${childMd().trim()}\n\n`;
    case "br": return "\n";
    case "hr": return "\n\n---\n\n";
    case "strong":
    case "b":
      return `**${childMd()}**`;
    case "em":
    case "i":
      return `*${childMd()}*`;
    case "code": {
      // Inline if not inside <pre>
      if (el.parentElement?.tagName.toLowerCase() === "pre") return childMd();
      return `\`${childMd()}\``;
    }
    case "pre": {
      const code = el.textContent || "";
      return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
    }
    case "blockquote":
      return "\n\n" + childMd().trim().split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
    case "a": {
      const href = el.getAttribute("href") || "";
      const text = childMd();
      if (!href) return text;
      return `[${text}](${href})`;
    }
    case "img": {
      const src = el.getAttribute("src") || "";
      const alt = el.getAttribute("alt") || "";
      return src ? `![${alt}](${src})` : "";
    }
    case "ul":
      return "\n\n" + Array.from(el.children).map((li) => `- ${nodeToMd(li).trim()}`).join("\n") + "\n\n";
    case "ol":
      return "\n\n" + Array.from(el.children).map((li, i) => `${i + 1}. ${nodeToMd(li).trim()}`).join("\n") + "\n\n";
    case "li":
      return childMd().trim();
    case "figure":
    case "figcaption":
    case "div":
    case "span":
    case "section":
    case "article":
    default:
      return childMd();
  }
}

export interface ExportBundle {
  article: Article;
  highlights: Highlight[];
  notes: Note[];
}

// Build the full markdown for an article + its highlights + notes.
// Format:
//   YAML frontmatter, body, ## Highlights, ## Notes
export function articleToMarkdown(bundle: ExportBundle): string {
  const { article, highlights, notes } = bundle;
  const fm: string[] = ["---"];
  fm.push(`title: ${escapeYaml(article.title || "Untitled")}`);
  if (article.url) fm.push(`url: ${escapeYaml(article.url)}`);
  if (article.byline) fm.push(`author: ${escapeYaml(article.byline)}`);
  if (article.siteName) fm.push(`site: ${escapeYaml(article.siteName)}`);
  if (article.publishedTime) fm.push(`published: ${escapeYaml(article.publishedTime)}`);
  fm.push(`saved: ${escapeYaml(isoDate(article.savedAt))}`);
  fm.push(`kind: ${article.kind || "web"}`);
  fm.push(`source: reader`);
  fm.push("---");

  const parts: string[] = [fm.join("\n"), "", `# ${article.title || "Untitled"}`, ""];

  if (article.byline) parts.push(`*by ${article.byline}*`, "");
  if (article.url) parts.push(`[Original article](${article.url})`, "");

  parts.push("");
  parts.push(htmlToMarkdown(article.content || ""));
  parts.push("");

  if (highlights.length) {
    parts.push("---", "", "## Highlights", "");
    for (const h of highlights) {
      parts.push(`> ${h.text.replace(/\n/g, "\n> ")}`);
      const note = notes.find((n) => n.highlightId === h.id);
      if (h.note) parts.push("", `*${h.note}*`);
      if (note) parts.push("", note.body);
      parts.push("");
    }
  }

  // Independent notes (not tied to any highlight)
  const orphanNotes = notes.filter((n) => !n.highlightId);
  if (orphanNotes.length) {
    parts.push("---", "", "## Notes", "");
    for (const n of orphanNotes) {
      parts.push(n.body, "");
    }
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
