import { access, readFile } from "node:fs/promises";
import path from "node:path";

const exportPath = process.argv[2];
const publicDir = path.resolve("public");

if (!exportPath) {
  console.error("Usage: node scripts/audit-ghost-export.mjs <ghost-export.json>");
  process.exit(2);
}

function firstDb(data) {
  return Array.isArray(data?.db) ? data.db[0]?.data : null;
}

function collectImagePaths(value, paths = new Set()) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/(?:__GHOST_URL__|https:\/\/[^"'\\\s]+)\/content\/images\/[^"'\\\s)]+/g)) {
      const imagePath = match[0]
        .replace(/^__GHOST_URL__/, "")
        .replace(/^https:\/\/[^/]+/, "");
      paths.add(imagePath);
    }
    return paths;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectImagePaths(item, paths);
    }
    return paths;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectImagePaths(item, paths);
    }
  }

  return paths;
}

async function existsPublic(publicPath) {
  try {
    await access(path.join(publicDir, publicPath.replace(/^\//, "")));
    return true;
  } catch {
    return false;
  }
}

const exportJson = JSON.parse(await readFile(exportPath, "utf8"));
const data = firstDb(exportJson);

if (!data) {
  console.error("Could not find db[0].data in Ghost export.");
  process.exit(1);
}

const publicPublished = (data.posts || [])
  .filter((post) => post.status === "published" && post.visibility === "public");

const missingPages = [];

for (const post of publicPublished) {
  const expectedPath = post.slug === "home" ? "/index.html" : `/${post.slug}/index.html`;

  if (!await existsPublic(expectedPath)) {
    missingPages.push({
      slug: post.slug,
      type: post.type,
      expectedPath,
    });
  }
}

const imagePaths = collectImagePaths({
  posts: publicPublished,
  tags: data.tags || [],
  users: data.users || [],
});

const missingOriginalImages = [];

for (const imagePath of [...imagePaths].sort()) {
  const publicPath = `/storage.ghost.io/c/ad/04/ad049ba7-9562-48cd-88a5-75b0ec92e783${imagePath}`;

  if (!await existsPublic(publicPath)) {
    missingOriginalImages.push(publicPath);
  }
}

const summary = {
  publicPublishedPostsAndPages: publicPublished.length,
  staticPagesMissingFromExportedPublicContent: missingPages.length,
  exportedOriginalImageReferences: imagePaths.size,
  missingOriginalImages: missingOriginalImages.length,
  newslettersInExport: (data.newsletters || []).length,
  usersInExport: (data.users || []).length,
  membersInExport: (data.members || []).length,
};

console.log(JSON.stringify(summary, null, 2));

if (missingPages.length || missingOriginalImages.length) {
  console.error("Ghost export completeness audit failed.");

  for (const page of missingPages.slice(0, 20)) {
    console.error(`missing page: ${page.expectedPath}`);
  }

  for (const image of missingOriginalImages.slice(0, 20)) {
    console.error(`missing image: ${image}`);
  }

  process.exit(1);
}
