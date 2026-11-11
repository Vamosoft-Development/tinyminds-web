# Testing Guide

How this project is checked and what a change must include. Static HTML site: no package.json, no unit-test
runner. The test is the legal-fidelity check, which runs in CI (`.github/workflows/check.yml`).

## TL;DR

```bash
node scripts/build.mjs --check   # committed legal HTML equals the text of its PDF (needs pdftotext / poppler)
node scripts/build.mjs           # regenerate the HTML after a PDF changes
```

## What is covered

| Tier | What | Where | Runner |
|---|---|---|---|
| UNIT / INT | every legal page `hu/*.html`, `en/*.html` matches its PDF word for word | `scripts/build.mjs --check` (uses `scripts/convert.mjs`) | Node, run by CI on every push to `main` and every PR |
| Manual | landing, support and legal-index pages render in HU and EN, links to the stores and legal pages work | open the page locally, mobile and desktop widths | browser |

## UI verification (every change that touches an app)

`/ui-verification` runs before the PR for a visible change: web in a real browser (Playwright), sized by
`~/vamosoft/ai-standards/ops/ui-test/ui-test.sh scope`. The site has no backend, so no local backend is needed:
serve the folder statically and check the changed pages at 390 px and desktop width.

## Rules

- Changes to `scripts/convert.mjs` or `scripts/build.mjs` ship with a fixture that fails without the change
  (a regression PDF/HTML pair or a unit test next to the script). Today the CI check is the only guard; a new
  parser heuristic that is not covered by a fixture is incomplete.
- Never hand-edit a generated legal `.html`; regenerate it and let `--check` prove it.
- No skipped checks without `// skip(DEV-123): reason`.
