/**
 * formatter.js: Markdown -> styled HTML (ES module, no dependencies).
 *
 *   import { render, toHtml } from "../utils/formatter";
 *   render(markdown, element)   // sets innerHTML and wires the Copy buttons
 *   toHtml(markdown)            // returns an HTML string
 *
 * Supports: headings 1-6, bold/italic/strike, inline code, links, auto-links,
 * nested + ordered + task lists, tables with alignment, blockquotes, callouts
 * (> [!NOTE|TIP|WARNING|IMPORTANT]), fenced code (``` or ~~~, unclosed while
 * streaming), syntax highlighting, copy buttons and "Sources" chips.
 * HTML is escaped first; only http(s) and mailto links are allowed.
 * Dark theme: add the class "jf-dark" to the wrapper (no automatic OS switch).
 */

const CSS = `
.jf{--jf-fg:#1f2937;--jf-mut:#6b7280;--jf-bd:#e5e7eb;--jf-soft:#f8fafc;--jf-acc:#6366f1;--jf-acc2:#ec4899;
  font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;color:var(--jf-fg);word-wrap:break-word;overflow-wrap:anywhere}
.jf.jf-dark{--jf-fg:#e5e7eb;--jf-mut:#9ca3af;--jf-bd:#2f3646;--jf-soft:#1a2132}
.jf *{box-sizing:border-box}
.jf>:first-child{margin-top:0}.jf>:last-child{margin-bottom:0}
.jf p{margin:.55em 0}
.jf strong{font-weight:700}
.jf em{font-style:italic}
.jf del{opacity:.65}
.jf a{color:var(--jf-acc);text-decoration:none;border-bottom:1px dashed currentColor}
.jf a:hover{opacity:.8}
.jf .jf-h{margin:1.1em 0 .4em;line-height:1.3;font-weight:800;color:var(--jf-fg)}
.jf h1.jf-h{font-size:1.45em;padding-bottom:.25em;border-bottom:2px solid transparent;border-image:linear-gradient(90deg,var(--jf-acc),var(--jf-acc2),transparent) 1}
.jf h2.jf-h{font-size:1.25em}.jf h3.jf-h{font-size:1.1em;color:var(--jf-acc)}
.jf h4.jf-h,.jf h5.jf-h,.jf h6.jf-h{font-size:1em;color:var(--jf-mut)}
.jf hr{border:0;height:2px;margin:1.2em 0;background:linear-gradient(90deg,var(--jf-acc),var(--jf-acc2),transparent)}
.jf ul,.jf ol{margin:.4em 0;padding-left:1.4em}.jf li{margin:.2em 0}.jf li::marker{color:var(--jf-acc);font-weight:700}
.jf li>ul,.jf li>ol{margin:.2em 0}
.jf li.jf-task{list-style:none;margin-left:-1.2em}
.jf .jf-box{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:8px;border-radius:5px;
  border:2px solid var(--jf-bd);font-size:11px;line-height:1;vertical-align:-2px;color:#fff}
.jf .jf-box.on{background:linear-gradient(135deg,var(--jf-acc),var(--jf-acc2));border-color:transparent}
.jf .jf-lead{padding:13px 16px;margin:.4em 0 .9em;border-radius:14px;border:1px solid var(--jf-bd);border-left:5px solid var(--jf-acc);
  background:linear-gradient(135deg,rgba(99,102,241,.10),rgba(236,72,153,.07));font-size:1.03em}
.jf .jf-ic{font:.88em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:2px 6px;border-radius:6px;color:#db2777;background:rgba(236,72,153,.12);overflow-wrap:anywhere}
.jf .jf-tablewrap{overflow-x:auto;margin:.8em 0;border:1px solid var(--jf-bd);border-radius:12px}
.jf table{border-collapse:collapse;width:100%;font-size:.93em}
.jf th{padding:9px 12px;text-align:left;color:#fff;background:linear-gradient(90deg,var(--jf-acc),var(--jf-acc2));white-space:nowrap}
.jf td{padding:8px 12px;border-top:1px solid var(--jf-bd);vertical-align:top}
.jf tr:nth-child(even) td{background:var(--jf-soft)}
.jf .jf-call{margin:.8em 0;padding:11px 14px;border-radius:12px;border:1px solid;border-left-width:5px}
.jf .jf-call>:last-child{margin-bottom:0}
.jf .jf-call b.t{display:block;margin-bottom:2px;text-transform:uppercase;letter-spacing:.06em;font-size:.75em}
.jf .jf-call.note{border-color:#3b82f6;background:rgba(59,130,246,.10)}.jf .jf-call.note b.t{color:#3b82f6}
.jf .jf-call.tip{border-color:#10b981;background:rgba(16,185,129,.10)}.jf .jf-call.tip b.t{color:#10b981}
.jf .jf-call.warning{border-color:#f59e0b;background:rgba(245,158,11,.12)}.jf .jf-call.warning b.t{color:#d97706}
.jf .jf-call.important{border-color:#ef4444;background:rgba(239,68,68,.10)}.jf .jf-call.important b.t{color:#ef4444}
.jf .jf-quote{margin:.8em 0;padding:2px 14px;border-left:4px solid var(--jf-bd);color:var(--jf-mut)}
.jf .jf-chips{display:flex;flex-wrap:wrap;gap:8px;margin:.5em 0 1em;padding:0;list-style:none}
.jf .jf-chip{display:inline-flex;align-items:center;gap:6px;margin:0;padding:5px 12px;border-radius:999px;font-size:.84em;border:1px solid var(--jf-bd);background:var(--jf-soft)}
.jf .jf-chip::before{content:"";width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,var(--jf-acc),var(--jf-acc2))}
.jf .jf-code{margin:.9em 0;border-radius:16px;overflow:hidden;background:#1e1f20;border:1px solid #2b2c2e}
.jf .jf-code-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 4px 18px}
.jf .jf-lang{font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#e3e3e3}
.jf .jf-actions{display:flex;gap:2px}
.jf .jf-btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:50%;
  background:none;color:#c4c7c5;cursor:pointer}
.jf .jf-btn:hover{background:rgba(255,255,255,.08)}
.jf .jf-btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.jf .jf-btn .i-ok{display:none}
.jf .jf-btn.ok{color:#81c995}.jf .jf-btn.ok .i-ok{display:block}.jf .jf-btn.ok .i-copy{display:none}
.jf .jf-code pre{margin:0;padding:6px 18px 16px;overflow:auto;max-height:520px;font:13.5px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e3e3e3;white-space:pre}
.jf .jf-code pre code{display:block;min-width:max-content;background:none;padding:0}
.jf .jf-line{display:block;white-space:pre}
.jf .t-c{color:#8e918f}                  /* comments  */
.jf .t-s{color:#a8d98a}                  /* strings   */
.jf .t-k{color:#8ab4f8}                  /* keywords  */
.jf .t-l{color:#d98cf0}                  /* null / new / throw / true... */
.jf .t-n{color:#f6a15b}                  /* numbers   */
.jf .t-f{color:#e6d37a}                  /* function names */
.jf .t-b{color:#f6a15b}                  /* types / Classes */
.jf .t-key{color:#7fdbca}
`;

export function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById("jf-styles")) return;
  const s = document.createElement("style");
  s.id = "jf-styles";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ inline */
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(src) {
  const codes = [];
  let s = String(src).replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, c) => {
    codes.push(c.trim());
    return "\u0000" + (codes.length - 1) + "\u0000";
  });
  s = esc(s);
  s = s
    // links first, so their text can still be formatted
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)(?:\s+&quot;[^)]*?&quot;)?\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/\*\*\*([^*]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__([^_]+?)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(
      /(^|[\s(>])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g,
      '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>',
    )
    .replace(/ {2,}\n/g, "<br>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code class="jf-ic">' + esc(codes[i]) + "</code>");
}

/* --------------------------------------------------------------- highlight */
const ALIAS = {
  py: "python", python3: "python", js: "javascript", jsx: "javascript", ts: "javascript",
  tsx: "javascript", typescript: "javascript", sh: "bash", shell: "bash", zsh: "bash",
  yml: "yaml", golang: "go", console: "bash",
};
const PLAIN = new Set(["", "text", "txt", "plain", "output", "log"]);
const KW = {
  python: "def class return if elif else for while in not and or is import from as try except finally raise with lambda yield pass break continue global nonlocal async await None True False self",
  javascript: "const let var function return if else for while do switch case break continue new this class extends import from export default async await try catch finally throw typeof instanceof null undefined true false of in",
  bash: "if then else elif fi for while do done case esac function in echo cd ls export sudo pip npm git curl brew docker",
  sql: "select from where insert into values update set delete create table alter drop join left right inner outer on group by order having limit as and or not null primary key distinct union",
  json: "true false null", yaml: "true false null",
  go: "func package import return if else for range type struct interface var const go defer chan map nil true false",
  applescript: "tell end application set to if then else repeat with return true false",
  html: "", _: "if else for while return function class import from const let var def true false null",
};
const HASH = "#[^\\n]*", DASH = "--[^\\n]*", SLASH = "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
const COMMENT = {
  python: HASH, bash: HASH, yaml: HASH, applescript: DASH, sql: DASH,
  json: "(?!)", html: "<!--[\\s\\S]*?-->", _: SLASH,
};
const LIT = new Set("null undefined true false None True False new throw delete void".split(" "));
const TYPES = new Set("string number boolean any unknown never object void bigint symbol".split(" "));
const LABEL = { ts: "TypeScript", typescript: "TypeScript", tsx: "TSX", js: "JavaScript", javascript: "JavaScript",
  jsx: "JSX", py: "Python", python: "Python", sh: "Bash", bash: "Bash", zsh: "Bash", json: "JSON", html: "HTML",
  css: "CSS", sql: "SQL", yml: "YAML", yaml: "YAML", go: "Go", text: "Text", txt: "Text" };
const labelOf = (l) => LABEL[l] || (l ? l[0].toUpperCase() + l.slice(1) : "Text");

export function highlight(code, lang) {
  const key = ALIAS[lang] || lang;
  if (PLAIN.has(key)) return esc(code);
  const kw = {};
  (KW[key] !== undefined ? KW[key] : KW._).split(" ").forEach((w) => w && (kw[w] = 1));
  const isKw = (w) => kw[w] || (key === "sql" && kw[w.toLowerCase()]);
  const re = new RegExp(
    [
      "(" + (COMMENT[key] || COMMENT._) + ")",
      "(\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*'|`(?:\\\\.|[^`\\\\])*`)",
      "(\\b\\d+(?:\\.\\d+)?\\b)",
      "(\\b[A-Za-z_$][\\w$]*)(?=\\s*\\()",
      "(\\b[A-Za-z_$][\\w$]*\\b)",
    ].join("|"),
    "g",
  );
  let out = "", last = 0, m;
  while ((m = re.exec(code)) !== null) {
    if (m[0] === "") { re.lastIndex++; continue; }
    out += esc(code.slice(last, m.index));
    let cls = "";
    if (m[1]) cls = "t-c";
    else if (m[2]) cls = key === "json" && /^\s*:/.test(code.slice(re.lastIndex)) ? "t-key" : "t-s";
    else if (m[3]) cls = "t-n";
    else if (m[4]) cls = LIT.has(m[4]) ? "t-l" : isKw(m[4]) ? "t-k" : "t-f";
else if (m[5]) cls = LIT.has(m[5]) ? "t-l"
  : isKw(m[5]) ? "t-k"
  : TYPES.has(m[5]) || /^[A-Z][A-Za-z0-9]+$/.test(m[5]) ? "t-b" : "";
    out += cls ? '<span class="' + cls + '">' + esc(m[0]) + "</span>" : esc(m[0]);
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}

const ICON_DL = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v8M8.5 12.5l3.5 3.5 3.5-3.5"/></svg>';
const ICON_COPY = '<svg class="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>' +
  '<svg class="i-ok" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function codeBox(lang, code) {
  lang = (lang || "text").toLowerCase();
  const html = highlight(code, lang)
    .split("\n")
    .map((l) => '<span class="jf-line">' + (l || " ") + "</span>")
    .join("");
  return (
    '<div class="jf-code" data-lang="' + esc(lang) + '"><div class="jf-code-head">' +
    '<span class="jf-lang">' + esc(labelOf(lang)) + "</span>" +
    '<span class="jf-actions">' +
    '<button type="button" class="jf-btn" data-jf-dl title="Download">' + ICON_DL + "</button>" +
    '<button type="button" class="jf-btn" data-jf-copy title="Copy">' + ICON_COPY + "</button>" +
    "</span></div><pre><code>" + html + "</code></pre></div>"
  );
}

/* ------------------------------------------------------------------ blocks */
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEAD_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const SRC_RE = /^(sources?|references?|citations?)\b/i;
const indentOf = (l) => l.match(/^\s*/)[0].length;

const splitRow = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (line) =>
  line !== undefined && line.indexOf("-") > -1 && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function startsBlock(l, next) {
  return (
    FENCE_RE.test(l) || HEAD_RE.test(l) || HR_RE.test(l) || LIST_RE.test(l) || /^\s*>/.test(l) ||
    (l.indexOf("|") > -1 && isSep(next))
  );
}

function parseList(L, i, chips) {
  const first = L[i].match(LIST_RE);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  const items = [];

  while (i < L.length) {
    const m = L[i].match(LIST_RE);
    if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
    let text = m[3], nested = "";
    i++;
    while (i < L.length) {
      if (!L[i].trim()) {                       // blank: continue only if a nested item follows
        let j = i;
        while (j < L.length && !L[j].trim()) j++;
        if (j < L.length && LIST_RE.test(L[j]) && indentOf(L[j]) > base) { i = j; continue; }
        break;
      }
      const nm = L[i].match(LIST_RE);
      if (nm && nm[1].length > base) {
        const [html, next] = parseList(L, i, false);
        nested += html; i = next;
      } else if (!nm && indentOf(L[i]) > base) {
        text += "\n" + L[i].trim(); i++;
      } else break;
    }
    items.push({ text, nested });
  }

  if (chips) {
    return [
      '<ul class="jf-chips">' +
        items.map(({ text: t }) => {
          const h = t.match(/https?:\/\/[^\s)\]]+/);
          if (h && t.indexOf("](") === -1) {
            let label = t;
            try { label = new URL(h[0]).hostname.replace(/^www\./, ""); } catch (e) { /* keep text */ }
            return '<li class="jf-chip"><a href="' + esc(h[0]) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a></li>";
          }
          return '<li class="jf-chip">' + inline(t) + "</li>";
        }).join("") + "</ul>",
      i,
    ];
  }

  const tag = ordered ? "ol" : "ul";
  const lis = items.map(({ text, nested }) => {
    const tm = text.match(/^\[( |x|X)\]\s+([\s\S]*)$/);
    if (tm) {
      const on = tm[1] !== " ";
      return '<li class="jf-task"><span class="jf-box' + (on ? " on" : "") + '">' + (on ? "✓" : "") + "</span>" + inline(tm[2]) + nested + "</li>";
    }
    return "<li>" + inline(text).replace(/\n/g, "<br>") + nested + "</li>";
  });
  return ["<" + tag + (ordered && start !== 1 ? ' start="' + start + '"' : "") + ">" + lis.join("") + "</" + tag + ">", i];
}

function blocks(L, top) {
  const out = [];
  let i = 0, inSources = false, leadDone = !top, m;

  while (i < L.length) {
    const line = L[i];

    if ((m = line.match(FENCE_RE))) {                                  // fenced code
      const ch = m[1][0], len = m[1].length, buf = [];
      i++;
      while (i < L.length) {
        const t = L[i].trim();
        if (t.length >= len && t === ch.repeat(t.length)) break;
        buf.push(L[i++]);
      }
      i++;                                                              // skip closing fence (or end)
      out.push(codeBox(m[2] || "text", buf.join("\n")));
      leadDone = true; continue;
    }
    if (!line.trim()) { i++; continue; }

    if ((m = line.match(HEAD_RE))) {                                    // heading
      inSources = SRC_RE.test(m[2].replace(/[*_:`]/g, "").trim());
      out.push("<h" + m[1].length + ' class="jf-h">' + inline(m[2]) + "</h" + m[1].length + ">");
      leadDone = true; i++; continue;
    }
    if (HR_RE.test(line)) { out.push("<hr>"); i++; continue; }

    if (line.indexOf("|") > -1 && isSep(L[i + 1])) {                    // table
      const head = splitRow(line);
      const aligns = splitRow(L[i + 1]).map((c) =>
        /^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : "left");
      i += 2;
      const rows = [];
      while (i < L.length && L[i].trim() && L[i].indexOf("|") > -1) rows.push(splitRow(L[i++]));
      const cell = (tag, c, k) =>
        "<" + tag + ' style="text-align:' + (aligns[k] || "left") + '">' + inline(c) + "</" + tag + ">";
      out.push(
        '<div class="jf-tablewrap"><table><thead><tr>' + head.map((c, k) => cell("th", c, k)).join("") +
        "</tr></thead><tbody>" + rows.map((r) => "<tr>" + r.map((c, k) => cell("td", c, k)).join("") + "</tr>").join("") +
        "</tbody></table></div>",
      );
      leadDone = true; continue;
    }

    if (/^\s*>/.test(line)) {                                           // quote / callout
      const q = [];
      while (i < L.length && /^\s*>/.test(L[i])) q.push(L[i++].replace(/^\s*>\s?/, ""));
      const cm = q[0].match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(.*)$/i);
      if (cm) {
        const raw = cm[1].toLowerCase();
        const kind = raw === "caution" ? "warning" : raw;
        out.push('<div class="jf-call ' + kind + '"><b class="t">' + kind + "</b>" + blocks([cm[2]].concat(q.slice(1)), false) + "</div>");
      } else {
        out.push('<blockquote class="jf-quote">' + blocks(q, false) + "</blockquote>");
      }
      leadDone = true; continue;
    }

    if (LIST_RE.test(line)) {                                           // list (nested)
      const [html, next] = parseList(L, i, inSources);
      out.push(html); i = next; leadDone = true; continue;
    }

    const para = [line]; i++;                                           // paragraph
    while (i < L.length && L[i].trim() && !startsBlock(L[i], L[i + 1])) para.push(L[i++]);
    const raw = para.join("\n");
    if (/^\**\s*(sources?|references?)\s*:?\s*\**\s*$/i.test(raw)) {
      inSources = true; out.push('<h4 class="jf-h">Sources</h4>'); continue;
    }
    const isLead = !leadDone && /^\*\*/.test(raw) && raw.length < 400;
    leadDone = true;
    out.push("<p" + (isLead ? ' class="jf-lead"' : "") + ">" + inline(raw).replace(/\n/g, "<br>") + "</p>");
  }
  return out.join("");
}

/* ------------------------------------------------------------------ public */
export function toHtml(src) {
  ensureStyles();
  const text = String(src == null ? "" : src).replace(/\r\n?/g, "\n");
  return '<div class="jf">' + blocks(text.split("\n"), true) + "</div>";
}

const EXT = { javascript: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx", python: "py", py: "py",
  bash: "sh", sh: "sh", json: "json", html: "html", css: "css", sql: "sql", yaml: "yml", yml: "yml", go: "go" };

function copyText(text, btn) {
  const done = () => {
    btn.classList.add("ok");
    setTimeout(() => btn.classList.remove("ok"), 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => {});
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
}

function download(text, lang) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = "code." + (EXT[lang] || "txt");
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function render(markdown, el) {
  el.innerHTML = toHtml(markdown);
  if (!el.__jfBound) {
    el.__jfBound = true;
    el.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("[data-jf-copy],[data-jf-dl]");
      if (!t) return;
      const box = t.closest(".jf-code");
      const text = Array.prototype.map.call(box.querySelectorAll(".jf-line"), (n) => n.textContent).join("\n");
      if (t.hasAttribute("data-jf-copy")) copyText(text, t);
      else download(text, box.dataset.lang);
    });
  }
  return el;
}
export default { toHtml, render, highlight, ensureStyles };