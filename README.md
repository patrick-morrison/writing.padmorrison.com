# writing.padmorrison.com

Static export of the Ghost blog at <https://writing.padmorrison.com>.

## Export

```sh
npm install
npm run export
```

The generated site is written to `public/`.

The export post-processes Ghost image URLs so the site uses local image files
instead of depending on `storage.ghost.io`. Article images link to the local
original upload while still displaying resized `srcset` variants.

## Audit

```sh
npm run audit
```

The audit checks that exported pages do not hotlink Ghost image storage, that
all local image references exist, and that every resized Ghost image reference
has a matching local original upload.

## Local Preview

```sh
npm run serve
```

Then open <http://127.0.0.1:8080>.

## Deploy

This repository is configured for Netlify. The publish directory is `public`.
