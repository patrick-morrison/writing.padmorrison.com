import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const publicDir = path.resolve("public");
const outputPath = path.resolve("llms-complete.md");
const site = "https://writing.padmorrison.com";

const postPaths = [
  "/about/",
  "/day-at-the-beach/",
  "/rottnest-limestone/",
  "/club-dives/",
  "/diving-way-down-south/",
  "/diving-down-south/",
  "/swan-river-wrecks/",
  "/wrecks-you-havent-dived-yet/",
  "/creatures/",
  "/beasts/",
  "/intro-to-shipwrecks/",
];

function decodeHtml(value) {
  const named = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["quot", "\""],
    ["lt", "<"],
    ["gt", ">"],
    ["nbsp", " "],
    ["ndash", "-"],
    ["mdash", "-"],
    ["rsquo", "'"],
    ["lsquo", "'"],
    ["rdquo", "\""],
    ["ldquo", "\""],
    ["hellip", "..."],
  ]);

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }

    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }

    return named.get(entity.toLowerCase()) ?? match;
  });
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function attributeValue(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}=(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? "";
}

function absoluteUrlForHref(href) {
  const decoded = decodeHtml(href);

  if (/^https?:\/\//i.test(decoded)) {
    return decoded;
  }

  if (decoded.startsWith("/")) {
    return `${site}${decoded}`;
  }

  return decoded;
}

function extractBalancedDiv(html, startIndex) {
  const firstTagEnd = html.indexOf(">", startIndex);
  let depth = 1;
  let cursor = firstTagEnd + 1;

  while (depth > 0) {
    const nextOpen = html.indexOf("<div", cursor);
    const nextClose = html.indexOf("</div>", cursor);

    if (nextClose === -1) {
      throw new Error("Could not find closing gh-content div");
    }

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + 4;
    } else {
      depth -= 1;
      cursor = nextClose + "</div>".length;
    }
  }

  return html.slice(firstTagEnd + 1, cursor - "</div>".length);
}

function extractGhContent(html) {
  const startIndex = html.search(/<div class="gh-content gh-canvas">/);

  if (startIndex === -1) {
    return "";
  }

  return extractBalancedDiv(html, startIndex);
}

function normalizeWhitespace(value) {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function convertInline(html) {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href, text) => {
        const label = stripTags(text);
        return label ? `[${label}](${decodeHtml(href)})` : decodeHtml(href);
      })
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function convertFigures(html) {
  return html.replace(/<figure\b[\s\S]*?<\/figure>/gi, (figure) => {
    const caption = figure.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1];
    const images = [...figure.matchAll(/<img\b[^>]*>/gi)]
      .map((match) => {
        const beforeImage = figure.slice(0, match.index);
        const lastAnchorOpen = beforeImage.lastIndexOf("<a");
        const lastAnchorClose = beforeImage.lastIndexOf("</a>");
        const wrappingAnchor = lastAnchorOpen > lastAnchorClose ? beforeImage.slice(lastAnchorOpen) : "";
        const href = attributeValue(wrappingAnchor, "href");
        const alt = attributeValue(match[0], "alt");
        const src = attributeValue(match[0], "src");
        const label = stripTags(alt) || path.basename(src.split("?")[0]);
        const imageUrl = absoluteUrlForHref(href || src);

        return label && imageUrl ? `Image: [${label}](${imageUrl})` : "";
      })
      .filter(Boolean);
    const captionText = caption ? convertInline(caption) : "";
    const parts = [...images, captionText].filter(Boolean);

    return parts.length ? `\n\n> ${parts.join(" - ")}\n\n` : "\n\n";
  });
}

function htmlToMarkdown(html) {
  let markdown = convertFigures(html)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_match, text) => `\n\n## ${convertInline(text)}\n\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_match, text) => `\n\n### ${convertInline(text)}\n\n`)
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_match, text) => `\n\n#### ${convertInline(text)}\n\n`)
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_match, text) => `\n\n${convertInline(text)}\n\n`)
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_match, list) => {
      const items = [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((item) => `- ${convertInline(item[1])}`)
        .join("\n");
      return `\n\n${items}\n\n`;
    })
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_match, list) => {
      const items = [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((item, index) => `${index + 1}. ${convertInline(item[1])}`)
        .join("\n");
      return `\n\n${items}\n\n`;
    });

  markdown = convertInline(markdown);
  return normalizeWhitespace(markdown);
}

function pageFileForUrl(urlPath) {
  return path.join(publicDir, urlPath.replace(/^\//, ""), "index.html");
}

async function exportMarkdown() {
  const sections = [
    "# Patrick Morrison Writing Archive",
    "",
    "A Markdown export of the main written content from the static `writing.padmorrison.com` archive. Navigation, footer content, analytics, and related-post cards are omitted.",
  ];

  for (const urlPath of postPaths) {
    const file = pageFileForUrl(urlPath);
    const html = await readFile(file, "utf8");
    const title = stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] ?? `https://writing.padmorrison.com${urlPath}`;
    const published = html.match(/<meta property="article:published_time" content="([^"]+)"/i)?.[1];
    const updated = html.match(/<meta property="article:modified_time" content="([^"]+)"/i)?.[1];
    const content = htmlToMarkdown(extractGhContent(html));

    sections.push("", "---", "", `# ${title}`, "", `Source: ${canonical}`);

    if (published) {
      sections.push(`Published: ${published}`);
    }

    if (updated) {
      sections.push(`Updated: ${updated}`);
    }

    sections.push("", content);
  }

  await writeFile(outputPath, `${sections.join("\n")}\n`);
}

await exportMarkdown();
