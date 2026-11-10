# tinyminds-web

<!-- vamosoft-ai-standards template v0.2.68 — do not remove this line; /audit and sync-project.sh use it -->

The public website of TinyMinds Quiz at https://tinyminds.hu: hand-written Hungarian and English landing pages,
a support page, a legal index, and the legal documents (ÁSZF / Terms, privacy policies, HU + EN) generated from
the lawyer's PDFs. Static site on Vercel (project `tinyminds-legal`, team `vamosoft-gm`); every push to `main`
deploys to production. The mobile app and both store listings link to these URLs.

## Standards

Vamosoft global rules apply (loaded from `~/.claude/rules/vamosoft` or the `vamosoft` plugin;
source: github.com/Vamosoft-Development/ai-standards). In short: Linear first and last, English only,
Research → Plan → Implement → Validate, commit per logical unit (merge only on the developer's request), tests with every change.
Reference projects for structure: `tinyminds` (the app monorepo this site belongs to).

## Stack

- Plain HTML/CSS/JS, no framework and no build step; `vercel.json` sets `cleanUrls` (`hu/aszf.html` is served at `/hu/aszf`).
- Brand tokens at the top of `assets/site.css`; fonts (Pally, Objectivity) self-hosted as woff2 in `assets/fonts/`.
- Legal generator: Node scripts `scripts/build.mjs` + `scripts/convert.mjs` (needs `pdftotext` from poppler).

## Structure

```
index.html          Hungarian landing page (hand-written)
en/index.html       English landing page (hand-written; shares assets/site.css + site.js)
support.html        bilingual support / contact page
legal.html          legal document index
hu/, en/            legal documents: binding .pdf originals + generated .html next to them
assets/             site.css, site.js, fonts/, heroes/, icons/, illustrations/, og.png, store badges
scripts/            build.mjs (regenerate / --check legal HTML), convert.mjs (PDF text -> HTML)
app-ads.txt         AdMob app verification
```

## Commands

```bash
node scripts/build.mjs           # regenerate the legal HTML from the PDFs
node scripts/build.mjs --check   # verify committed HTML matches the PDFs (what CI runs)
npx serve .                      # local preview (no build step)
```

## Environment

None. No secrets, no `.env` files; the Vercel project is linked to the GitHub repository.

## Project-specific conventions

- Never rename or move a published URL (`/`, `/en`, `/support`, `/legal`, `/hu/aszf`, `/hu/adatkezelesi-tajekoztato`,
  `/en/terms-and-conditions`, `/en/privacy-policy`): the app and the store listings embed them.
- The `.pdf` files are the legally binding originals; the `.html` next to them is generated, never edited by hand.
  A new version goes into the `tinyminds` monorepo first (`supabase/storage/legal/`, `npm run legal:build`),
  then the changed `.pdf` + regenerated `.html` are copied here (identical paths).
- The Hungarian and English landing pages are written separately: change both when one changes.
- Landing copy mirrors the live App Store / Google Play listings (name, subtitle, description, subscription terms,
  age rating): update both when a listing changes.
- `assets/heroes/` and `assets/icons/` are copies of the mobile app's bundled assets; re-copy from the monorepo when the art changes.

## Key files

- `scripts/build.mjs` — regenerates and verifies each legal page word-for-word against its PDF
- `assets/site.css` — brand colour and font tokens
- `vercel.json` — `cleanUrls`

## Known pitfalls

- `build.mjs` needs `pdftotext` (poppler); without it the fidelity check cannot run locally.
- A parser heuristic that mishandles a new document makes the build fail on purpose rather than drop a clause.

## Docs

- `README.md` — hosting, URL table, legal-document workflow, landing-page assets
- `TESTING.md` — the checks that guard this site
