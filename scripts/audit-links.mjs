import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const siteHost = "writing.padmorrison.com";
const publicDir = path.resolve("public");
const textFilePattern = /\.(html|xml|xsl|txt|css)$/i;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function existsFromPublic(urlPath) {
  const cleanPath = decodeURI(urlPath.split("#")[0].split("?")[0]);
  const candidates = [];

  if (cleanPath === "" || cleanPath === "/") {
    candidates.push("index.html");
  } else {
    const withoutSlash = cleanPath.replace(/^\//, "");
    candidates.push(withoutSlash);

    if (cleanPath.endsWith("/")) {
      candidates.push(path.join(withoutSlash, "index.html"));
    }
  }

  for (const candidate of candidates) {
    try {
      await access(path.join(publicDir, candidate));
      return true;
    } catch {
      // Try the next candidate.
    }
  }

  return false;
}

async function existsRelativeToFile(file, urlPath) {
  const cleanPath = decodeURI(urlPath.split("#")[0].split("?")[0]);
  const target = path.resolve(path.dirname(file), cleanPath);

  if (!target.startsWith(publicDir)) {
    return false;
  }

  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function normalizeXmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function localPathForAbsoluteUrl(rawValue) {
  const value = rawValue.startsWith("//") ? `https:${rawValue}` : rawValue;
  const parsed = new URL(value);

  if (parsed.hostname !== siteHost) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function classifyRef(rawValue) {
  const value = normalizeXmlText(rawValue.trim());

  if (
    value === ""
    || value.startsWith("#")
    || value.startsWith("data:")
    || value.startsWith("mailto:")
    || value.startsWith("tel:")
    || value.startsWith("javascript:")
    || value.startsWith("urn:")
  ) {
    return { kind: "ignored", value };
  }

  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("//")) {
    const localPath = localPathForAbsoluteUrl(value);

    if (localPath) {
      return { kind: "local", value: localPath };
    }

    return { kind: "external", value };
  }

  if (value.startsWith("/")) {
    return { kind: "local", value };
  }

  return { kind: "relative", value };
}

function refsFromContent(content, file) {
  const refs = [];
  const relativeFile = path.relative(publicDir, file);

  for (const match of content.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    refs.push({ file: relativeFile, value: match[1] });
  }

  for (const match of content.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
    for (const candidate of match[1].split(",")) {
      const value = candidate.trim().split(/\s+/)[0];

      if (value) {
        refs.push({ file: relativeFile, value });
      }
    }
  }

  for (const match of content.matchAll(/url\(([^)]+)\)/gi)) {
    refs.push({ file: relativeFile, value: match[1].trim().replace(/^["']|["']$/g, "") });
  }

  for (const match of content.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    refs.push({ file: relativeFile, value: match[1] });
  }

  return refs;
}

const textFiles = (await walk(publicDir)).filter((file) => textFilePattern.test(file));
const externalRefs = new Map();
const localRefs = new Map();
const relativeRefs = [];
const missingRelativeRefs = [];
const missingLocalRefs = [];

for (const file of textFiles) {
  const content = await readFile(file, "utf8");

  for (const ref of refsFromContent(content, file)) {
    const classified = classifyRef(ref.value);

    if (classified.kind === "external") {
      const refs = externalRefs.get(classified.value) ?? [];
      refs.push(ref.file);
      externalRefs.set(classified.value, refs);
    } else if (classified.kind === "local") {
      const refs = localRefs.get(classified.value) ?? [];
      refs.push(ref.file);
      localRefs.set(classified.value, refs);
    } else if (classified.kind === "relative" && !classified.value.includes("{$")) {
      relativeRefs.push(ref);
    }
  }
}

for (const [ref, files] of localRefs) {
  if (!await existsFromPublic(ref)) {
    missingLocalRefs.push({ ref, files: [...new Set(files)] });
  }
}

for (const ref of relativeRefs) {
  if (!await existsRelativeToFile(path.join(publicDir, ref.file), ref.value)) {
    missingRelativeRefs.push(ref);
  }
}

if (!process.argv.includes("--list-external")) {
  console.log(JSON.stringify({
    textFiles: textFiles.length,
    localLinks: localRefs.size,
    externalLinks: externalRefs.size,
    relativeLinks: relativeRefs.length,
    missingRelativeLinks: missingRelativeRefs.length,
    missingLocalLinks: missingLocalRefs.length,
  }, null, 2));
}

if (missingRelativeRefs.length) {
  console.error("Missing relative links:");

  for (const ref of missingRelativeRefs.slice(0, 30)) {
    console.error(`${ref.file}: ${ref.value}`);
  }
}

if (missingLocalRefs.length) {
  console.error("Missing local links:");

  for (const ref of missingLocalRefs.slice(0, 30)) {
    console.error(`${ref.ref} from ${ref.files.slice(0, 3).join(", ")}`);
  }
}

if (process.argv.includes("--list-external")) {
  for (const ref of [...externalRefs.keys()].sort()) {
    console.log(ref);
  }
}

if (missingRelativeRefs.length || missingLocalRefs.length) {
  process.exit(1);
}
