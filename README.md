# tinyminds-web

The public website of **TinyMinds Quiz**, served at
[tinyminds.hu](https://tinyminds.hu): the landing page, the legal documents
(ÁSZF / Terms, privacy policies, HU + EN) and the support page.

## Hosting & CD

Static site on Vercel — project **`tinyminds-legal`** (team `vamosoft-gm`),
connected to this repository: **every push to `main` deploys to production
automatically**. No build step; `vercel.json` enables `cleanUrls`, so
`hu/aszf.html` is served at `/hu/aszf`.

| Path | Page |
| --- | --- |
| `/` | Landing page (`index.html`, hand-written) |
| `/support` | Support / contact (`support.html`, hand-written, bilingual) |
| `/legal` | Document index (`legal.html`, hand-written) |
| `/hu/aszf` · `/hu/adatkezelesi-tajekoztato` | Hungarian legal documents (generated) |
| `/en/terms-and-conditions` · `/en/privacy-policy` | English legal documents (generated) |

These URLs are baked into the mobile app and the App Store / Google Play
listings — **never rename or move them**.

## Legal documents

The `.pdf` files are the legally binding originals from the lawyer; the
`.html` next to them is **generated — never edit it by hand**. The authoring
pipeline lives in the private `tinyminds` monorepo (`scripts/legal/`); this
repo carries the same generator (`scripts/build.mjs` + `scripts/convert.mjs`)
minus the index page, and CI re-verifies on every push that each HTML page
contains word-for-word the text of its PDF.

When a new document version arrives:

1. Update it in the monorepo first (`supabase/storage/legal/`,
   `npm run legal:build`) — its CI gates fidelity and Supabase Storage keeps
   serving the PDFs.
2. Copy the changed `.pdf` + regenerated `.html` here (paths are identical),
   or drop the PDF in place and run `node scripts/build.mjs`.
3. Commit and push — CI proves fidelity, Vercel deploys.
