// Converts the lawyer-authored legal PDFs into standalone, self-hosted HTML pages.
//
// The PDFs are the legally binding source of truth, so this module never
// rewrites, summarises or reflows their wording — it only recovers the document
// structure (headings, paragraphs, bullet lists) that `pdftotext -layout`
// flattens into plain text, and wraps it in semantic HTML. `extractPlainText`
// exists so the build can prove the rendered page contains exactly the same
// words as the PDF; if a future document trips a parser heuristic, that check
// fails loudly instead of silently dropping a clause.

/** Section heading, e.g. "12. Account Deletion" or "8.1 Own Server Infrastructure".
 *  Bounded to 1-2 digits per segment so Hungarian dates ("2026. 06. 30.") and
 *  monetary figures are never mistaken for headings. A top-level number must
 *  carry its dot ("18. Reklámok") — a bare number opening a sentence
 *  ("18 éven aluli személyek…") is prose, not a heading. */
const HEADING_RE = /^(\d{1,2}(?:\.\d{1,2})+|\d{1,2}(?=\.))\.?[ \t]+([^\d\s].*)$/;

/** Bullet as emitted by `pdftotext -layout`: three spaces, glyph, three spaces. */
const BULLET_RE = /^[ \t]*[•▪◦·-][ \t]+(.*)$/;

/** Continuation line of a wrapped bullet — indented to align under the bullet text. */
const BULLET_CONT_RE = /^[ \t]{5,}\S/;

/** Document header fields, present in both languages. */
const META_RE =
  /^(Verzió|Version|Hatálybalépés|Effective Date|Utolsó módosítás|Last Updated)[ \t]*:[ \t]*(.*)$/;

/** A line that closes a sentence — used to tell a soft wrap from a new paragraph. */
const SENTENCE_END_RE = /[.!?:]["'”’)\]]?$/;

/** "Adatkezelő:", "Registered Address:" — a short leading label the PDF sets in bold.
 *  Kept deliberately tight (few short words) so that a lead-in sentence ending in
 *  a colon — "Az Alkalmazás lehetőséget biztosít többek között:" — is not bolded. */
const LABEL_RE = /^([A-ZÁÉÍÓÖŐÚÜŰ][^:<]{0,32}):(\s|$)/;
const LABEL_MAX_WORDS = 4;

/** English definition style: "Virtual Points mean digital points…". */
const DEFINITION_RE = /^([A-Z][A-Za-z\- ]{0,40}?) (means|mean)\b/;

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/g;
// Combined so linkification is a SINGLE pass: the URL alternative comes first,
// so a URL is matched whole (including any '@' inside it) before the email
// pattern can match a substring of it. Two separate passes would let EMAIL_RE
// splice a mailto anchor inside an already-built href.
const URL_OR_EMAIL_RE = new RegExp(`${URL_RE.source}|${EMAIL_RE.source}`, 'g');

function endsSentence(line) {
  return SENTENCE_END_RE.test(line.trim());
}

/** True when the line opens with a cased lowercase letter, i.e. it continues the
 *  previous line even though that line ended in a period (abbreviations). */
function startsLowercase(line) {
  const first = line.trim()[0];
  if (!first) return false;
  return first !== first.toUpperCase() && first === first.toLowerCase();
}

/** Rejoin the hard-wrapped lines of one logical block into a single string. */
function joinWrapped(lines) {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Parse `pdftotext -layout` output into a structured document.
 *
 * @param {string} raw
 * @returns {{title: string, meta: Array<{label: string, value: string}>, blocks: Array<object>}}
 */
export function parseDocument(raw) {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''));

  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const title = (lines[i] ?? '').trim();
  i++;

  const meta = [];
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i++;
      continue;
    }
    const m = META_RE.exec(lines[i].trim());
    if (!m) break;
    meta.push({ label: m[1], value: m[2].trim() });
    i++;
  }

  const blocks = [];
  let para = [];
  let listItems = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', text: joinWrapped(para) });
      para = [];
    }
  };
  const flushList = () => {
    if (listItems) {
      blocks.push({ type: 'list', items: listItems.map(joinWrapped) });
      listItems = null;
    }
  };

  for (; i < lines.length; i++) {
    const line = lines[i];

    // Blank lines end a paragraph but NOT a list: the Hungarian documents put a
    // blank line between every bullet, so closing on blank would shatter each
    // list into a series of one-item lists.
    if (!line.trim()) {
      flushPara();
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushPara();
      if (!listItems) listItems = [];
      listItems.push([bullet[1]]);
      continue;
    }

    if (
      listItems &&
      BULLET_CONT_RE.test(line) &&
      !HEADING_RE.test(line.trim())
    ) {
      listItems[listItems.length - 1].push(line);
      continue;
    }

    const heading = HEADING_RE.exec(line.trim());
    if (heading && line.trim().length <= 120) {
      flushPara();
      flushList();
      blocks.push({
        type: 'heading',
        number: heading[1],
        level: heading[1].split('.').length,
        text: heading[2].trim(),
      });
      continue;
    }

    flushList();

    // Decide whether this line continues the current paragraph or starts a new
    // one. A hard wrap leaves the previous line mid-sentence; a genuine new
    // paragraph follows a completed sentence and opens with a capital.
    if (para.length) {
      const prev = para[para.length - 1];
      if (endsSentence(prev) && !startsLowercase(line)) flushPara();
    }
    para.push(line);
  }

  flushPara();
  flushList();

  return { title, meta, blocks };
}

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Apply inline formatting to already-escaped text. */
function renderInline(text) {
  let html = escapeHtml(text);

  html = html.replace(URL_OR_EMAIL_RE, (m) =>
    /^https?:/i.test(m)
      ? `<a href="${m}" rel="noopener noreferrer">${m}</a>`
      : `<a href="mailto:${m}">${m}</a>`,
  );

  // Restore the emphasis the PDF carries on definition terms and field labels.
  const label = LABEL_RE.exec(html);
  if (label && label[1].trim().split(/\s+/).length <= LABEL_MAX_WORDS) {
    html = html.replace(LABEL_RE, `<strong>${label[1]}:</strong>${label[2]}`);
  } else {
    const def = DEFINITION_RE.exec(html);
    if (def) html = html.replace(def[1], `<strong>${def[1]}</strong>`);
  }

  return html;
}

function slugId(number) {
  return `s-${number.replace(/\./g, '-')}`;
}

const STYLES = `
:root{
  --navy:#344580; --blue:#6189CE; --light:#97ADE4; --card:#E4EAFF;
  --ink:#253156; --muted:#5b6b96; --bg:#f5f7ff; --surface:#ffffff; --rule:#dfe6fb;
}
@media (prefers-color-scheme: dark){
  :root{
    --ink:#e8edff; --muted:#9db0e0; --bg:#161d33; --surface:#1e2743;
    --card:#26314f; --rule:#33406a;
  }
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-size:17px; line-height:1.65; -webkit-text-size-adjust:100%;
}
header.masthead{background:var(--navy); color:#fff; padding:28px 20px 24px}
header.masthead .wrap{max-width:760px; margin:0 auto}
header.masthead h1{margin:0 0 10px; font-size:26px; line-height:1.3; font-weight:700}
.meta{display:flex; flex-wrap:wrap; gap:8px 18px; margin:0; padding:0; list-style:none;
  font-size:14px; color:var(--light)}
.meta strong{color:#fff; font-weight:600}
.actions{display:flex; flex-wrap:wrap; gap:10px; margin-top:18px}
.actions a{
  display:inline-block; padding:9px 16px; border-radius:999px; text-decoration:none;
  font-size:14px; font-weight:600; background:rgba(255,255,255,.14); color:#fff;
  border:1px solid rgba(255,255,255,.28); line-height:1.4;
}
.actions a:hover{background:rgba(255,255,255,.24)}
main{max-width:760px; margin:0 auto; padding:0 20px 64px}
nav.toc{
  background:var(--surface); border:1px solid var(--rule); border-radius:14px;
  padding:18px 22px; margin:28px 0 8px;
}
nav.toc h2{margin:0 0 10px; font-size:15px; text-transform:uppercase;
  letter-spacing:.06em; color:var(--muted)}
nav.toc ol{margin:0; padding-left:20px; font-size:15px}
nav.toc li{margin:4px 0}
nav.toc li.sub{list-style:none; margin-left:-4px; font-size:14px}
nav.toc a{color:var(--ink); text-decoration:none}
nav.toc a:hover{text-decoration:underline}
section{padding-top:8px}
h2.section{font-size:20px; line-height:1.35; margin:34px 0 12px; color:var(--ink);
  scroll-margin-top:16px}
h3.section{font-size:17px; line-height:1.4; margin:24px 0 10px; color:var(--ink);
  scroll-margin-top:16px}
h2.section .num,h3.section .num{color:var(--blue); margin-right:.4em}
p{margin:0 0 14px}
ul{margin:0 0 16px; padding-left:22px}
li{margin:6px 0}
a{color:var(--blue)}
strong{font-weight:600}
footer{
  max-width:760px; margin:0 auto; padding:24px 20px 48px; border-top:1px solid var(--rule);
  color:var(--muted); font-size:14px;
}
footer a{color:var(--blue)}
@media (max-width:520px){
  body{font-size:16px}
  header.masthead h1{font-size:22px}
  h2.section{font-size:18px}
}
`;

/**
 * Render a parsed document as a standalone HTML page.
 *
 * @param {object} doc          result of `parseDocument`
 * @param {object} opts
 * @param {string} opts.lang    BCP-47 language tag for <html lang>
 * @param {string} opts.pdfHref link to the original PDF
 * @param {string} opts.altHref link to the same document in the other language
 * @param {object} opts.strings UI labels for this language
 * @param {Array<{href: string, label: string}>} [opts.related] sibling documents
 */
export function renderHtml(doc, opts) {
  const { lang, pdfHref, altHref, strings, related = [] } = opts;

  const headings = doc.blocks.filter((b) => b.type === 'heading');
  const toc = headings
    .map(
      (h) =>
        `      <li class="${h.level > 1 ? 'sub' : ''}"><a href="#${slugId(h.number)}">` +
        `${h.level > 1 ? `${escapeHtml(h.number)} ` : ''}${escapeHtml(h.text)}</a></li>`,
    )
    .join('\n');

  const body = doc.blocks
    .map((b) => {
      if (b.type === 'heading') {
        const tag = b.level > 1 ? 'h3' : 'h2';
        return (
          `      <${tag} class="section" id="${slugId(b.number)}">` +
          `<span class="num">${escapeHtml(b.number)}.</span>${escapeHtml(b.text)}</${tag}>`
        );
      }
      if (b.type === 'list') {
        const items = b.items
          .map((it) => `        <li>${renderInline(it)}</li>`)
          .join('\n');
        return `      <ul>\n${items}\n      </ul>`;
      }
      return `      <p>${renderInline(b.text)}</p>`;
    })
    .join('\n');

  const metaHtml = doc.meta
    .map(
      (m) =>
        `        <li><strong>${escapeHtml(m.label)}:</strong> ${escapeHtml(m.value)}</li>`,
    )
    .join('\n');

  const relatedHtml = related
    .map((r) => `      <a href="${r.href}">${escapeHtml(r.label)}</a>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(doc.title)}</title>
    <meta name="description" content="${escapeHtml(doc.title)} — Tiny Minds" />
    <meta name="robots" content="index, follow" />
    <style>${STYLES}</style>
  </head>
  <body>
    <header class="masthead">
      <div class="wrap">
        <h1>${escapeHtml(doc.title)}</h1>
        <ul class="meta">
${metaHtml}
        </ul>
        <div class="actions">
          <a href="${pdfHref}">${escapeHtml(strings.downloadPdf)}</a>
          <a href="${altHref}">${escapeHtml(strings.otherLanguage)}</a>
${relatedHtml}
        </div>
      </div>
    </header>
    <main>
      <nav class="toc">
        <h2>${escapeHtml(strings.contents)}</h2>
        <ol>
${toc}
        </ol>
      </nav>
      <section>
${body}
      </section>
    </main>
    <footer>
      <p>${escapeHtml(strings.footer)}</p>
    </footer>
  </body>
</html>
`;
}

/**
 * Strip markup and collapse whitespace, so rendered output can be compared
 * word-for-word against the extracted PDF text.
 */
export function extractPlainText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Flatten a parsed document back to plain text, in source order.
 * The build compares this against the raw PDF text to prove the parser neither
 * dropped nor duplicated anything.
 */
export function documentContentText(doc) {
  const parts = [doc.title];
  for (const m of doc.meta) parts.push(`${m.label}: ${m.value}`);
  for (const b of doc.blocks) {
    if (b.type === 'heading') parts.push(`${b.number}. ${b.text}`);
    else if (b.type === 'list') parts.push(b.items.join(' '));
    else parts.push(b.text);
  }
  return parts.join(' ');
}

/**
 * Normalise text for the fidelity comparison.
 *
 * Whitespace, bullet glyphs and periods are removed: the first two are layout
 * artefacts, and periods differ harmlessly because sub-section headings are
 * written "8.1 Title" in the PDF but reconstructed as "8.1. Title". Dropping
 * periods costs the check nothing — a missing or altered *word* still fails.
 */
export function normalizeForCompare(text) {
  return text
    .replace(/[•▪◦]/g, ' ')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
