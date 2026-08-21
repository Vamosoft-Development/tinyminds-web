// Regenerates the legal HTML pages from the source PDFs.
//
//   node scripts/build.mjs          # rebuild the HTML pages
//   node scripts/build.mjs --check  # verify committed HTML is up to date (CI)
//
// The PDFs in hu/ and en/ are the binding originals and the only input; the
// HTML next to them is generated output. The authoring pipeline lives in the
// private tinyminds monorepo (scripts/legal/) — this is the same generator
// minus the document-index page (index.html here is the landing page and
// legal.html / support.html are hand-written). When the lawyer sends a new
// document version, update it in the monorepo first (its CI gates fidelity),
// then copy the PDF + regenerated HTML here — this check proves the copies
// stayed intact.
//
// Every page is verified word-for-word against the text extracted from its
// PDF before being written, so a parser heuristic that mis-handles a future
// document fails the build instead of quietly dropping a clause.
// Requires `pdftotext` (poppler).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseDocument,
  renderHtml,
  documentContentText,
  normalizeForCompare,
} from './convert.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const STRINGS = {
  hu: {
    downloadPdf: 'PDF letöltése',
    otherLanguage: 'English',
    contents: 'Tartalom',
    footer:
      'Tiny Minds — Baráth Csaba egyéni vállalkozó · Dorog, Hegyalja utca 1. · tinymindsquiz@gmail.com',
  },
  en: {
    downloadPdf: 'Download PDF',
    otherLanguage: 'Magyar',
    contents: 'Contents',
    footer:
      'Tiny Minds — Csaba Baráth, Sole Proprietor · Hegyalja utca 1., Dorog, Hungary · tinymindsquiz@gmail.com',
  },
};

/** id -> document. `alt` is the same document in the other language, `related`
 *  the other document in the same language. */
export const DOCS = {
  'privacy-hu': {
    lang: 'hu',
    path: 'hu/adatkezelesi-tajekoztato',
    navLabel: 'Adatkezelési tájékoztató',
    alt: 'privacy-en',
    related: ['terms-hu'],
  },
  'terms-hu': {
    lang: 'hu',
    path: 'hu/aszf',
    navLabel: 'ÁSZF',
    alt: 'terms-en',
    related: ['privacy-hu'],
  },
  'privacy-en': {
    lang: 'en',
    path: 'en/privacy-policy',
    navLabel: 'Privacy Policy',
    alt: 'privacy-hu',
    related: ['terms-en'],
  },
  'terms-en': {
    lang: 'en',
    path: 'en/terms-and-conditions',
    navLabel: 'Terms and Conditions',
    alt: 'terms-hu',
    related: ['privacy-en'],
  },
};

function pdfToText(pdfPath) {
  return execFileSync(
    'pdftotext',
    ['-enc', 'UTF-8', '-nopgbrk', '-layout', pdfPath, '-'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

/** Relative href from one document to another, so the pages work under any host. */
function hrefBetween(fromPath, toPath, ext) {
  const fromDir = fromPath.split('/')[0];
  const [toDir, toFile] = toPath.split('/');
  return fromDir === toDir
    ? `${toFile}.${ext}`
    : `../${toDir}/${toFile}.${ext}`;
}

function buildPage(id) {
  const doc = DOCS[id];
  const pdfPath = resolve(ROOT, `${doc.path}.pdf`);
  if (!existsSync(pdfPath)) throw new Error(`Missing source PDF: ${pdfPath}`);

  const raw = pdfToText(pdfPath);
  const parsed = parseDocument(raw);

  // Fidelity gate: the structured document must contain exactly the words of the PDF.
  const expected = normalizeForCompare(raw);
  const actual = normalizeForCompare(documentContentText(parsed));
  if (expected !== actual) {
    throw new Error(
      `Content mismatch for ${id} — the parser lost or altered text.\n` +
        firstDifference(expected, actual),
    );
  }

  const html = renderHtml(parsed, {
    lang: doc.lang,
    pdfHref: `${doc.path.split('/')[1]}.pdf`,
    altHref: hrefBetween(doc.path, DOCS[doc.alt].path, 'html'),
    strings: STRINGS[doc.lang],
    related: doc.related.map((r) => ({
      href: hrefBetween(doc.path, DOCS[r].path, 'html'),
      label: DOCS[r].navLabel,
    })),
  });

  return { doc, html };
}

/** Human-readable pointer to where two normalised strings diverge. */
function firstDifference(a, b) {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  const from = Math.max(0, i - 90);
  return (
    `  at offset ${i}\n` +
    `  pdf : …${a.slice(from, i + 90)}\n` +
    `  html: …${b.slice(from, i + 90)}`
  );
}

function main() {
  const check = process.argv.includes('--check');
  let stale = 0;

  for (const id of Object.keys(DOCS)) {
    const { doc, html } = buildPage(id);
    const file = resolve(ROOT, `${doc.path}.html`);
    const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (current === html) continue;
    stale++;
    if (check) {
      console.error(`stale: ${file.replace(`${ROOT}/`, '')}`);
    } else {
      writeFileSync(file, html, 'utf8');
      console.log(`wrote: ${file.replace(`${ROOT}/`, '')}`);
    }
  }

  if (check && stale > 0) {
    console.error(
      `\n${stale} legal page(s) out of date — run: node scripts/build.mjs`,
    );
    process.exit(1);
  }
  if (check) console.log('legal pages are up to date');
  if (!check && stale === 0) console.log('legal pages already up to date');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
