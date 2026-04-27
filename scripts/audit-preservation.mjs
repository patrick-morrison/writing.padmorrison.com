import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const publicDir = path.resolve("public");
const textFilePattern = /\.(html|xml|xsl|txt)$/i;

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

function originalPathForStoragePath(storagePath) {
  return storagePath.replace("/content/images/size/", "/content/images/").replace(/\/w\d+\//, "/");
}

async function exists(publicPath) {
  try {
    await access(path.join(publicDir, publicPath.replace(/^\//, "")));
    return true;
  } catch {
    return false;
  }
}

const textFiles = (await walk(publicDir)).filter((file) => textFilePattern.test(file));
const localStorageRefs = new Set();
const remoteStorageRefs = [];
const sizedRefs = new Set();
const originalRefs = new Set();
let storageImageTags = 0;
let linkedOriginalImageTags = 0;

for (const file of textFiles) {
  const content = await readFile(file, "utf8");
  const remoteMatches = content.matchAll(/https:\/\/storage\.ghost\.io[^"' <>)]+/g);

  for (const match of remoteMatches) {
    remoteStorageRefs.push(`${path.relative(publicDir, file)}: ${match[0]}`);
  }

  const localMatches = content.matchAll(/\/storage\.ghost\.io[^"' <>)]+/g);

  for (const match of localMatches) {
    localStorageRefs.add(match[0]);

    if (match[0].includes("/content/images/size/")) {
      sizedRefs.add(match[0]);
    } else if (match[0].includes("/content/images/")) {
      originalRefs.add(match[0]);
    }
  }

  const imgMatches = content.matchAll(/<img\b[^>]*\ssrc=(["']?)\/storage\.ghost\.io[^>]*>/g);

  for (const match of imgMatches) {
    storageImageTags += 1;
  }

  const linkedMatches = content.matchAll(/<a\b[^>]*\bclass="[^"]*\bpreservation-original-image\b[^"]*"[^>]*>\s*<img\b[^>]*\ssrc=(["']?)\/storage\.ghost\.io[^>]*>/g);

  for (const match of linkedMatches) {
    linkedOriginalImageTags += 1;
  }
}

const missingLocalRefs = [];
const missingOriginals = [];

for (const ref of localStorageRefs) {
  if (!await exists(ref)) {
    missingLocalRefs.push(ref);
  }

  if (ref.includes("/content/images/size/")) {
    const originalPath = originalPathForStoragePath(ref);

    if (!await exists(originalPath)) {
      missingOriginals.push(`${ref} -> ${originalPath}`);
    }
  }
}

console.log(JSON.stringify({
  textFiles: textFiles.length,
  localStorageRefs: localStorageRefs.size,
  sizedRefs: sizedRefs.size,
  originalRefs: originalRefs.size,
  remoteStorageRefs: remoteStorageRefs.length,
  missingLocalRefs: missingLocalRefs.length,
  missingOriginalsForSizedRefs: missingOriginals.length,
  storageImageTags,
  linkedOriginalImageTags,
}, null, 2));

if (remoteStorageRefs.length || missingLocalRefs.length || missingOriginals.length) {
  console.error("Preservation audit failed.");

  for (const item of remoteStorageRefs.slice(0, 20)) {
    console.error(`remote: ${item}`);
  }

  for (const item of missingLocalRefs.slice(0, 20)) {
    console.error(`missing local: ${item}`);
  }

  for (const item of missingOriginals.slice(0, 20)) {
    console.error(`missing original: ${item}`);
  }

  process.exit(1);
}
