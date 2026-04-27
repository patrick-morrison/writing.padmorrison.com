import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const site = "https://writing.padmorrison.com";
const ghostStorage = "https://storage.ghost.io";
const publicDir = path.resolve("public");
const textFilePattern = /\.(html|xml|xsl|txt)$/i;
const lightboxCssPath = "/assets/preservation-lightbox.css";
const lightboxJsPath = "/assets/preservation-lightbox.js";

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

async function normalizeQueryFiles() {
  const files = await walk(publicDir);

  for (const file of files) {
    if (!file.includes("?")) {
      continue;
    }

    const cleanPath = file.split("?")[0];
    await copyFile(file, cleanPath);
  }
}

async function fetchToPublic(urlPath, outputPath = urlPath) {
  const response = await fetch(`${site}${urlPath}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${urlPath}: ${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  const target = path.join(publicDir, outputPath.replace(/^\//, ""));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

async function fetchExternalToPublic(url, outputPath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  const target = path.join(publicDir, outputPath.replace(/^\//, ""));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

function storagePathForUrl(url) {
  const parsed = new URL(url);
  return `/storage.ghost.io${parsed.pathname}`;
}

function originalStorageUrlFor(url) {
  return url.replace("/content/images/size/", "/content/images/").replace(/\/w\d+\//, "/");
}

async function downloadStorageUrl(url) {
  const localPath = storagePathForUrl(url);
  const target = path.join(publicDir, localPath.replace(/^\//, ""));
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function localizeGhostStorageImages() {
  const textFiles = (await walk(publicDir)).filter((file) => textFilePattern.test(file));
  const storageUrls = new Set();

  for (const file of textFiles) {
    const content = await readFile(file, "utf8");
    const matches = content.matchAll(/https:\/\/storage\.ghost\.io[^"' <>)]+/g);

    for (const match of matches) {
      storageUrls.add(match[0]);
      storageUrls.add(originalStorageUrlFor(match[0]));
    }
  }

  const urls = [...storageUrls].sort();
  const concurrency = 8;

  for (let index = 0; index < urls.length; index += concurrency) {
    await Promise.all(urls.slice(index, index + concurrency).map(downloadStorageUrl));
  }

  for (const file of textFiles) {
    let content = await readFile(file, "utf8");

    const matches = [...content.matchAll(/https:\/\/storage\.ghost\.io[^"' <>)]+/g)];

    for (const match of matches) {
      content = content.split(match[0]).join(storagePathForUrl(match[0]));
    }

    await writeFile(file, content);
  }
}

function originalPathForStoragePath(storagePath) {
  return storagePath.replace("/content/images/size/", "/content/images/").replace(/\/w\d+\//, "/");
}

function imageSrcFromTag(imgTag) {
  const match = imgTag.match(/\ssrc=(["']?)(\/storage\.ghost\.io[^"'\s>]+)\1/);
  return match?.[2];
}

function linkImagesInFigure(figureHtml) {
  if (!/\bkg-(?:image|gallery)-card\b/.test(figureHtml)) {
    return figureHtml;
  }

  return figureHtml.replace(/<img\b[^>]*\ssrc=(["']?)\/storage\.ghost\.io[^>]*>/g, (imgTag, _quote, offset, fullHtml) => {
    const previousMarkup = fullHtml.slice(Math.max(0, offset - 220), offset);

    if (previousMarkup.includes("preservation-original-image")) {
      return imgTag;
    }

    const imageSrc = imageSrcFromTag(imgTag);

    if (!imageSrc) {
      return imgTag;
    }

    return `<a class="preservation-original-image" href="${originalPathForStoragePath(imageSrc)}">${imgTag}</a>`;
  });
}

async function linkContentImagesToOriginals() {
  const htmlFiles = (await walk(publicDir)).filter((file) => file.endsWith(".html"));

  for (const file of htmlFiles) {
    const content = await readFile(file, "utf8");
    const linked = content.replace(/<figure\b[\s\S]*?<\/figure>/g, linkImagesInFigure);

    if (linked !== content) {
      await writeFile(file, linked);
    }
  }
}

async function removeDynamicGhostIntegrations() {
  const htmlFiles = (await walk(publicDir)).filter((file) => file.endsWith(".html"));

  for (const file of htmlFiles) {
    const content = await readFile(file, "utf8");
    const cleaned = content
      .replace(/<script\b[^>]+src="https:\/\/cdn\.jsdelivr\.net\/ghost\/(?:portal|sodo-search|comments-ui)[^"]*"[^>]*><\/script>/g, "")
      .replace(/<script\b[^>]+src="https:\/\/umami\.padmorrison\.com\/script\.js"[^>]*><\/script>/g, "")
      .replace(/<script\b[^>]+data-ghost-comments-counts-api="[^"]*"[^>]*>\s*<\/script>/g, "")
      .replace(/<script\b[^>]+data-ghost-comment-count="[^"]*"[^>]*>\s*<\/script>/g, "")
      .replace(/<script\b[^>]+src="\/public\/member-attribution\.min\.js[^"]*"[^>]*><\/script>/g, "")
      .replace(/<link\b[^>]+rel="webmention"[^>]*>/g, "")
      .replace(/\sdata-portal="[^"]*"/g, "")
      .replace(/\sdata-ghost-search\b/g, "");

    if (cleaned !== content) {
      await writeFile(file, cleaned);
    }
  }
}

async function localizeStaticAssets() {
  const textFiles = (await walk(publicDir)).filter((file) => textFilePattern.test(file));

  for (const file of textFiles) {
    const content = await readFile(file, "utf8");
    const localized = content
      .replace(/https:\/\/writing\.padmorrison\.com\/assets\//g, "/assets/")
      .replace(/https:\/\/code\.jquery\.com\/jquery-3\.5\.1\.min\.js/g, "/assets/vendor/jquery-3.5.1.min.js");

    if (localized !== content) {
      await writeFile(file, localized);
    }
  }
}

async function removeVestigialStaticUi() {
  const textFiles = (await walk(publicDir)).filter((file) => textFilePattern.test(file));

  for (const file of textFiles) {
    const content = await readFile(file, "utf8");
    const cleaned = content
      .replace(/This is where my writing lives online\. During summer 2022\/2023, I will be writing about dive and snorkel sites around Perth, Western Australia\./g, "This is where my writing lived online. During summer 2022/2023, I wrote about dive and snorkel sites around Perth, Western Australia.")
      .replace(/<button\b[^>]*class="[^"]*\bgh-search\b[^"]*"[^>]*>[\s\S]*?<\/button>/g, "")
      .replace(/<a\b[^>]*class="[^"]*\bgh-head-btn\b[^"]*"[^>]*href="#\/portal\/signup"[^>]*>[\s\S]*?<\/a>/g, "")
      .replace(/<li\b[^>]*class="[^"]*\bnav-sign-up\b[^"]*"[^>]*>[\s\S]*?<\/li>/g, "")
      .replace(/<div\b[^>]*class="[^"]*\bgh-powered-by\b[^"]*"[^>]*>\s*<a href="https:\/\/ghost\.org\/"[^>]*>Powered by Ghost<\/a>\s*<\/div>/g, "")
      .replace(/<section\b[^>]*class="[^"]*\bgh-comments\b[^"]*"[^>]*>[\s\S]*?<\/section>/g, "")
      .replace(/<style id="gh-members-styles">[\s\S]*?<\/style>/g, "")
      .replace(/<p>Next week(?:'|&apos;)s theme is:?\s*<strong>\s*(?:'|&apos;)?Abrolhos Islands(?:'|&apos;)?\s*<\/strong>\.?\s*<\/p>/g, "")
      .replace(/<p>(?:<a href="https:\/\/writing\.padmorrison\.com\/#\/portal\/signup">)?Subscribe to the newsletter(?:<\/a>)? so you don(?:'|&apos;)t miss it\.\s*<\/p>/g, "")
      .replace(/href="Carnac Island https:\/\/goo\.gl\/maps\/qaTzYAeYTd8XdfxX6"/g, 'href="https://goo.gl/maps/qaTzYAeYTd8XdfxX6"')
      .replace(/href="writing\.padmorrison\.com\/beasts\/"/g, 'href="/beasts/"')
      .replace(/href="http:\/\/photos\.padmorrison\.com\/patrick\.morrison@research\.uwa\.edu\.au\?ref=writing\.padmorrison\.com"/g, 'href="mailto:patrick.morrison@research.uwa.edu.au"')
      .replace(/href="https:\/\/www\.divingwawrecks\.com\/blackwall-reach\?ref=writing\.padmorrison\.com"/g, 'href="https://www.divingwawrecks.com/blackwallreach?ref=writing.padmorrison.com"')
      .replace(/href="https:\/\/www\.divelightshop\.com\.au\/collections\/underwater-video-photo-lights\/products\/dive-lantern-v40-video-light-4-000-lumens\?ref=writing\.padmorrison\.com"/g, 'href="https://perthscuba.com/products/v40-video-light-4200lm"')
      .replace(/href="https:\/\/divelightshop\.com\/products\/dive-lantern-v40-video-light-4-000-lumens\?ref=writing\.padmorrison\.com"/g, 'href="https://perthscuba.com/products/v40-video-light-4200lm"')
      .replace(/href="https:\/\/education\.busseltonjetty\.com\.au\/fish\/western-red-scorpionfish\/\?ref=writing\.padmorrison\.com"/g, 'href="https://en.wikipedia.org/wiki/Scorpaena_sumptuosa"')
      .replace(/href="https:\/\/fishesofaustralia\.net\.au\/home\/species\/3655"/g, 'href="https://en.wikipedia.org/wiki/Scorpaena_sumptuosa"')
      .replace(/href="https:\/\/www\.uwauc\.org\.au\/events\/dunsborough-long-weekend-25th-30th-january-2022\/\?ref=writing\.padmorrison\.com"/g, 'href="https://linktr.ee/uwauc"')
      .replace(/href="https:\/\/www\.uwauc\.org\.au\/"/g, 'href="https://linktr.ee/uwauc"')
      .replace(/href="https:\/\/www\.ecu\.edu\.au\/centres\/kurongkurl-katitjin\/cultural-leadership\/nyoongar-six-seasons\/bunuru\?ref=writing\.padmorrison\.com"/g, 'href="https://www.vincent.wa.gov.au/our-neighbourhood/community/culture/aboriginal-culture/vincent-reconciliation.aspx"')
      .replace(/src="https:\/\/www\.abc\.net\.au\/news-web\/assets\/favicon-32x32\.png"/g, 'src="https://www.abc.net.au/favicon.ico"')
      .replace(/<p>\s*<\/p>/g, "");

    if (cleaned !== content) {
      await writeFile(file, cleaned);
    }
  }
}

async function writeHeaders() {
  await writeFile(
    path.join(publicDir, "_headers"),
    [
      "/rss/",
      "  Content-Type: application/rss+xml; charset=utf-8",
      "",
      "/sitemap*.xml",
      "  Content-Type: application/xml; charset=utf-8",
      "",
    ].join("\n"),
  );
}

async function writeLightboxAssets() {
  await mkdir(path.join(publicDir, "assets"), { recursive: true });

  await writeFile(
    path.join(publicDir, lightboxCssPath.replace(/^\//, "")),
    `a.preservation-original-image {
  cursor: zoom-in;
}

.preservation-lightbox-open {
  overflow: hidden;
}

.preservation-lightbox {
  align-items: center;
  background: rgba(8, 10, 12, 0.94);
  bottom: 0;
  color: #fff;
  display: none;
  flex-direction: column;
  gap: 16px;
  justify-content: center;
  left: 0;
  padding: 24px;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 9999;
}

.preservation-lightbox.is-open {
  display: flex;
}

.preservation-lightbox__image {
  box-shadow: 0 20px 80px rgba(0, 0, 0, 0.45);
  max-height: calc(100vh - 132px);
  max-width: 100%;
  object-fit: contain;
}

.preservation-lightbox__caption {
  color: rgba(255, 255, 255, 0.86);
  font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  max-width: min(900px, 100%);
  text-align: center;
}

.preservation-lightbox__open-original,
.preservation-lightbox__button {
  align-items: center;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  color: #fff;
  display: inline-flex;
  font: 14px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  justify-content: center;
  min-height: 44px;
  min-width: 44px;
  padding: 0 14px;
  text-decoration: none;
}

.preservation-lightbox__button {
  cursor: pointer;
  font-size: 26px;
  padding: 0;
  position: absolute;
}

.preservation-lightbox__button:hover,
.preservation-lightbox__button:focus,
.preservation-lightbox__open-original:hover,
.preservation-lightbox__open-original:focus {
  background: rgba(255, 255, 255, 0.24);
}

.preservation-lightbox__close {
  right: 18px;
  top: 18px;
}

.preservation-lightbox__previous {
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
}

.preservation-lightbox__next {
  right: 18px;
  top: 50%;
  transform: translateY(-50%);
}

.preservation-lightbox__footer {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

@media (max-width: 720px) {
  .preservation-lightbox {
    padding: 14px;
  }

  .preservation-lightbox__image {
    max-height: calc(100vh - 156px);
  }

  .preservation-lightbox__previous,
  .preservation-lightbox__next {
    bottom: 18px;
    top: auto;
    transform: none;
  }
}
`,
  );

  await writeFile(
    path.join(publicDir, lightboxJsPath.replace(/^\//, "")),
    `(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll("a.preservation-original-image"));

  if (!links.length) {
    return;
  }

  var currentIndex = 0;
  var lightbox = document.createElement("div");
  lightbox.className = "preservation-lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "Full-resolution image viewer");
  lightbox.innerHTML = [
    '<button class="preservation-lightbox__button preservation-lightbox__close" type="button" aria-label="Close">&times;</button>',
    '<button class="preservation-lightbox__button preservation-lightbox__previous" type="button" aria-label="Previous image">&#8249;</button>',
    '<img class="preservation-lightbox__image" alt="">',
    '<button class="preservation-lightbox__button preservation-lightbox__next" type="button" aria-label="Next image">&#8250;</button>',
    '<div class="preservation-lightbox__footer">',
    '<div class="preservation-lightbox__caption"></div>',
    '<a class="preservation-lightbox__open-original" target="_blank" rel="noopener">Open original</a>',
    '</div>'
  ].join("");

  document.body.appendChild(lightbox);

  var image = lightbox.querySelector(".preservation-lightbox__image");
  var caption = lightbox.querySelector(".preservation-lightbox__caption");
  var original = lightbox.querySelector(".preservation-lightbox__open-original");
  var closeButton = lightbox.querySelector(".preservation-lightbox__close");
  var previousButton = lightbox.querySelector(".preservation-lightbox__previous");
  var nextButton = lightbox.querySelector(".preservation-lightbox__next");

  function captionFor(link) {
    var figure = link.closest("figure");
    var figcaption = figure && figure.querySelector("figcaption");
    return figcaption ? figcaption.textContent.trim() : "";
  }

  function show(index) {
    currentIndex = (index + links.length) % links.length;
    var link = links[currentIndex];
    var img = link.querySelector("img");
    var href = link.getAttribute("href");

    image.removeAttribute("src");
    image.alt = img ? img.getAttribute("alt") || "" : "";
    image.src = href;
    original.href = href;
    caption.textContent = captionFor(link);
    caption.hidden = !caption.textContent;
    lightbox.classList.add("is-open");
    document.documentElement.classList.add("preservation-lightbox-open");
    closeButton.focus();
  }

  function close() {
    lightbox.classList.remove("is-open");
    document.documentElement.classList.remove("preservation-lightbox-open");
    image.removeAttribute("src");
    links[currentIndex].focus();
  }

  function move(step) {
    show(currentIndex + step);
  }

  links.forEach(function (link, index) {
    link.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();
      show(index);
    });
  });

  closeButton.addEventListener("click", close);
  previousButton.addEventListener("click", function () { move(-1); });
  nextButton.addEventListener("click", function () { move(1); });

  lightbox.addEventListener("click", function (event) {
    if (event.target === lightbox) {
      close();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (!lightbox.classList.contains("is-open")) {
      return;
    }

    if (event.key === "Escape") {
      close();
    } else if (event.key === "ArrowLeft") {
      move(-1);
    } else if (event.key === "ArrowRight") {
      move(1);
    }
  });
}());
`,
  );
}

async function injectLightboxAssets() {
  const htmlFiles = (await walk(publicDir)).filter((file) => file.endsWith(".html"));
  const cssTag = `<link rel="stylesheet" href="${lightboxCssPath}">`;
  const jsTag = `<script src="${lightboxJsPath}" defer></script>`;

  for (const file of htmlFiles) {
    let content = await readFile(file, "utf8");

    if (!content.includes(cssTag)) {
      content = content.replace("</head>", `${cssTag}\n</head>`);
    }

    if (!content.includes(jsTag)) {
      content = content.replace("</body>", `${jsTag}\n</body>`);
    }

    await writeFile(file, content);
  }
}

async function pruneCrawlerArtifacts() {
  await Promise.all([
    rm(path.join(publicDir, "beasts/carnac island https:"), { recursive: true, force: true }),
    rm(path.join(publicDir, "creatures/writing.padmorrison.com"), { recursive: true, force: true }),
  ]);
}

await normalizeQueryFiles();
await pruneCrawlerArtifacts();

await Promise.all([
  fetchToPublic("/sitemap.xml"),
  fetchToPublic("/sitemap-pages.xml"),
  fetchToPublic("/sitemap-posts.xml"),
  fetchToPublic("/sitemap-authors.xml"),
  fetchToPublic("/sitemap-tags.xml"),
  fetchToPublic("/sitemap.xsl"),
  fetchToPublic("/favicon.ico"),
  fetchToPublic("/favicon.png"),
  fetchExternalToPublic("https://code.jquery.com/jquery-3.5.1.min.js", "/assets/vendor/jquery-3.5.1.min.js"),
]);

await localizeGhostStorageImages();
await linkContentImagesToOriginals();
await removeDynamicGhostIntegrations();
await localizeStaticAssets();
await removeVestigialStaticUi();
await writeLightboxAssets();
await injectLightboxAssets();
await writeHeaders();
