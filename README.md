# OUAT Web

This directory is a static HTML/CSS/JavaScript Vercel project. It has no build
step. Set the Vercel Root Directory to this directory and use the `Other`
framework preset with an empty build command and `.` as the output directory.

The card catalog stays in `assets/card-ui/catalog.json`. Card illustrations and
card UI images are resolved by `asset-config.js` to the public Vercel Blob
store. The current Blob naming convention is `<name>-converted.webp` under
`cards/` and `card-ui/`.

The browser expects the API at the same origin (`/v1/...`) by default. Put the
FastAPI service behind the same domain, or set `apiOrigin` in
`runtime-config.js` and add that origin to the page CSP before deploying.

Run the browser-side tests locally with:

```text
npm test
```
