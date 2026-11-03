#!/usr/bin/env node
// Builds a mockup viewer: node make-viewer.mjs <mockups folder> [--title "Ledgerly pricing"] [--interactive 2,3]
//
// Writes <folder>/index.html, a self-contained page (no network, no dependencies). It shows every mockup-*.html in the
// folder as a tab, at desktop, tablet or phone width. Keys 1–9 and ←/→ switch versions; Replay reloads the version.
// "Choose this version" copies a reply for the chat ("I choose version 3: <title>"). The approval is still that
// message, sent by the user.
//
// Each version is embedded in the page and runs in a sandboxed frame with an opaque origin and a strict policy: no
// network, no access to other files, no navigating the page, no popups or forms. Local stylesheets, images, fonts and
// media inside the folder are inlined; anything remote or outside the folder is removed and listed. Scripts are removed
// too, except in the versions named with --interactive (motion prototypes), where inline and local scripts run.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIME = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

/** The policy every version runs under; only interactive versions may run inline scripts. */
export const versionPolicy = (interactive) =>
  [
    "default-src 'none'",
    `script-src ${interactive ? "'unsafe-inline'" : "'none'"}`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
  ].join("; ");
/** The sandbox flags of a version's frame: never allow-same-origin, forms, popups, modals or top navigation. */
export const versionSandbox = (interactive) => (interactive ? "allow-scripts" : "");

const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Inlines one mockup. Local files are read only when they resolve (symlinks followed) inside `root`.
 * @returns {{ html: string, removed: string[] }}
 */
export function inlineMockup(file, root, { interactive = false } = {}) {
  const realRoot = fs.realpathSync(root);
  const removed = [];
  const local = (ref, baseDir) => {
    const clean = ref
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .split(/[?#]/)[0];
    if (!clean || /^(data|blob):/i.test(ref.trim())) return null;
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(clean)) return { drop: `${clean} (not local)` };
    let target;
    try {
      target = fs.realpathSync(path.resolve(baseDir, decodeURIComponent(clean)));
    } catch {
      return { drop: `${clean} (missing)` };
    }
    const rel = path.relative(realRoot, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return { drop: `${clean} (outside the mockup folder)` };
    return { target };
  };
  const dataUri = (target) =>
    `data:${MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream"};base64,${fs.readFileSync(target).toString("base64")}`;
  const refOrDrop = (ref, baseDir) => {
    const r = local(ref, baseDir);
    if (r === null) return ref;
    if (r.drop) {
      removed.push(r.drop);
      return "";
    }
    return dataUri(r.target);
  };
  const css = (text, baseDir, depth = 0) =>
    text
      .replace(/@import\s+(?:url\()?\s*(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi, (_, _q, ref) => {
        const r = local(ref, baseDir);
        if (!r || r.drop || depth >= 4) {
          removed.push(r?.drop ?? `${ref} (import too deep)`);
          return "";
        }
        return css(fs.readFileSync(r.target, "utf8"), path.dirname(r.target), depth + 1);
      })
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => `url(${q}${refOrDrop(ref, baseDir)}${q})`);

  const dir = path.dirname(file);
  let html = fs.readFileSync(file, "utf8");
  // Nothing in the mockup may loosen or redirect the frame: its own policies, refresh and base go.
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(content-security-policy|refresh)[^>]*>/gi, (m) => {
    removed.push("a <meta http-equiv> tag");
    return "";
  });
  html = html.replace(/<base\b[^>]*>/gi, () => {
    removed.push("a <base> tag");
    return "";
  });
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, body) => {
    const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    if (!interactive) {
      removed.push(src ? `${src} (script)` : "an inline script");
      return "";
    }
    if (!src) return m;
    const r = local(src, dir);
    if (!r || r.drop) {
      removed.push(r?.drop ?? src);
      return "";
    }
    const rest = attrs.replace(/\bsrc\s*=\s*["']?[^"'\s>]+["']?/i, "");
    return `<script${rest}>${fs.readFileSync(r.target, "utf8").replace(/<\/script/gi, "<\\/script")}</script>`;
  });
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) {
      if (href && !/^data:/i.test(href)) removed.push(`${href} (link)`);
      return "";
    }
    const r = href ? local(href, dir) : null;
    if (!r || r.drop) {
      removed.push(r?.drop ?? `${href} (stylesheet)`);
      return "";
    }
    return `<style>${css(fs.readFileSync(r.target, "utf8"), path.dirname(r.target))}</style>`;
  });
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, a, body, b) => a + css(body, dir) + b);
  html = html.replace(/\bstyle\s*=\s*"([^"]*)"/gi, (_, body) => `style="${css(body, dir)}"`);
  html = html.replace(
    /(<(?:img|source|video|audio|track|image|input|embed|object|iframe)\b[^>]*?\s)(src|href|poster|data|xlink:href)\s*=\s*(["'])([^"']*)\3/gi,
    (_, pre, attr, q, ref) => `${pre}${attr}=${q}${refOrDrop(ref, dir)}${q}`,
  );
  html = html.replace(/\ssrcset\s*=\s*(["'])([^"']*)\1/gi, (_, q, set) => {
    const first = set.split(",")[0].trim().split(/\s+/)[0];
    return ` src=${q}${refOrDrop(first, dir)}${q}`;
  });

  // Links would navigate the frame itself (a request no policy can stop): only in-page #anchors keep their href.
  let links = 0;
  html = html.replace(/(<(?:a|area)\b[^>]*?)\shref\s*=\s*(["'])([^"']*)\2/gi, (m, pre, q, ref) => {
    if (ref.startsWith("#")) return m;
    links++;
    return pre;
  });
  if (links) removed.push(`${links} link${links === 1 ? "" : "s"} (href removed)`);

  const policy = `<meta http-equiv="Content-Security-Policy" content="${versionPolicy(interactive)}">`;
  html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (h) => h + policy) : policy + html;
  return { html, removed: [...new Set(removed)] };
}

/** Builds the viewer page for a folder; returns its HTML and what each version lost. */
export function buildViewer(dir, { title = null, interactive = [] } = {}) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^mockup-.*\.html$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) throw new Error(`No mockup-*.html files in ${dir}`);

  const versions = files.map((file, i) => {
    const n = i + 1;
    const isInteractive = interactive.includes(n);
    const { html, removed } = inlineMockup(path.join(dir, file), dir, { interactive: isInteractive });
    const name = (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? file.replace(/\.html$/i, "")).trim();
    return { n, file, title: name, interactive: isInteractive, html, removed };
  });
  const data = versions.map(({ n, title: t, interactive: i, html }) => ({
    n,
    title: t,
    sandbox: versionSandbox(i),
    interactive: i,
    html,
  }));
  // The viewer page itself: its own inline script and styles, nothing else.
  const pagePolicy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${pagePolicy}">
<meta name="referrer" content="no-referrer">
<title>${esc(title ?? "Mockups")} — ${versions.length} versions</title>
<style>
  :root { color-scheme: dark; --bg:#0c0806; --surface:#18110d; --raised:#221812; --ink:#fbf3ea; --muted:#b8a596; --subtle:#94806f; --accent:#ff6a13; --on-accent:#0c0806; --focus:#ff8c42; }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, -apple-system, sans-serif; }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px 16px; background: var(--surface); }
  h1 { margin: 0 12px 0 0; font-size: 15px; font-weight: 600; }
  [role=tablist] { display: flex; flex-wrap: wrap; gap: 6px; }
  button { font: inherit; color: inherit; border: 0; cursor: pointer; border-radius: 999px; padding: 7px 14px; background: var(--raised); }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  [role=tab][aria-selected=true] { background: var(--ink); color: var(--bg); }
  .sizes { display: flex; gap: 4px; margin-left: auto; }
  .sizes [aria-pressed=true] { background: var(--ink); color: var(--bg); }
  .choose { background: var(--accent); color: var(--on-accent); font-weight: 600; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 16px; color: var(--muted); font-size: 13px; }
  .bar b { color: var(--ink); font-weight: 500; }
  .chip { border-radius: 999px; padding: 2px 8px; background: var(--raised); color: var(--ink); font-size: 12px; }
  .hint { color: var(--subtle); margin-left: auto; }
  main { flex: 1; overflow: auto; display: flex; justify-content: center; padding: 0 16px 16px; }
  iframe { border: 0; background: #fff; border-radius: 10px; width: 100%; height: 100%; min-height: 70vh; }
  .status { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--raised); padding: 10px 16px; border-radius: 999px; opacity: 0; transition: opacity .2s; }
  .status.on { opacity: 1; }
  textarea.copy { position: fixed; left: -9999px; }
  @media (prefers-reduced-motion: reduce) { .status { transition: none; } }
</style>
</head>
<body>
<header>
  <h1>${esc(title ?? "Mockups")}</h1>
  <div role="tablist" aria-label="Versions">
    ${versions.map((v) => `<button role="tab" id="tab-${v.n}" aria-controls="frame" aria-selected="false" data-n="${v.n}" title="${esc(v.title)}">${v.n}</button>`).join("\n    ")}
  </div>
  <div class="sizes" role="group" aria-label="Width">
    <button data-w="100%" aria-pressed="true">Desktop</button><button data-w="768px" aria-pressed="false">Tablet</button><button data-w="390px" aria-pressed="false">Phone</button>
  </div>
</header>
<div class="bar">
  <span>Version <b id="num"></b> · <b id="name"></b></span><span class="chip" id="kind"></span>
  <button id="replay">Replay</button>
  <button class="choose" id="choose">Choose this version</button>
  <span class="hint"><span id="motion"></span> · Keys 1–${Math.min(versions.length, 9)} and ← → switch versions</span>
</div>
<main id="stage"></main>
<div class="status" role="status" id="status"></div>
<script>
  const versions = ${JSON.stringify(data).replace(/</g, "\\u003c")};
  const stage = document.getElementById("stage");
  let current = 1;
  let width = "100%";
  function load() {
    const v = versions[current - 1];
    // A new frame each time, so the sandbox flags of this version apply and Replay restarts its motion.
    const frame = document.createElement("iframe");
    frame.id = "frame";
    frame.setAttribute("role", "tabpanel");
    frame.setAttribute("aria-labelledby", "tab-" + current);
    frame.setAttribute("sandbox", v.sandbox);
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.style.width = width;
    frame.srcdoc = v.html;
    // A version may only ever show its own document: if it navigates itself (a script setting location), it's stopped.
    let loads = 0;
    frame.addEventListener("load", () => {
      if (++loads > 1) {
        frame.remove();
        stage.textContent = "This version tried to open another page, so it was stopped. Replay shows it again.";
      }
    });
    stage.replaceChildren(frame);
  }
  function show(n) {
    current = n;
    const v = versions[n - 1];
    document.getElementById("num").textContent = n;
    document.getElementById("name").textContent = v.title;
    document.getElementById("kind").textContent = v.interactive ? "Interactive" : "Static";
    document.querySelectorAll("[role=tab]").forEach((t) => {
      const on = +t.dataset.n === n;
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
    });
    history.replaceState(null, "", "#" + n);
    load();
  }
  function say(text) {
    const s = document.getElementById("status");
    s.textContent = text;
    s.classList.add("on");
    clearTimeout(say.t);
    say.t = setTimeout(() => s.classList.remove("on"), 4000);
  }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const motionText = () =>
    (document.getElementById("motion").textContent = reduce.matches
      ? "Your browser reports reduced motion"
      : "Your browser reports full motion (turn on Reduce motion in the OS to preview it)");
  reduce.addEventListener("change", motionText);
  motionText();
  document.querySelectorAll("[role=tab]").forEach((t) => t.addEventListener("click", () => show(+t.dataset.n)));
  document.querySelectorAll(".sizes button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".sizes button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      width = b.dataset.w;
      document.getElementById("frame").style.width = width;
    }),
  );
  document.getElementById("replay").addEventListener("click", load);
  document.getElementById("choose").addEventListener("click", async () => {
    const text = "I choose version " + current + ": " + versions[current - 1].title;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = Object.assign(document.createElement("textarea"), { value: text, className: "copy" });
      document.body.append(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    say("Copied “" + text + "”. Paste it in the chat, adding any changes you want.");
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("textarea, input")) return;
    if (/^[1-9]$/.test(e.key) && +e.key <= versions.length) show(+e.key);
    if (e.key === "ArrowRight") show((current % versions.length) + 1);
    if (e.key === "ArrowLeft") show(((current + versions.length - 2) % versions.length) + 1);
  });
  show(Math.min(Math.max(parseInt(location.hash.slice(1)) || 1, 1), versions.length));
</script>
</body>
</html>
`;
  return {
    page,
    versions: versions.map(({ n, file, title: t, interactive: i, removed }) => ({
      n,
      file,
      title: t,
      interactive: i,
      removed,
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dir = args.find((a, i) => !a.startsWith("--") && !/^--(title|interactive)$/.test(args[i - 1] ?? ""));
  if (!dir || !fs.existsSync(dir)) {
    console.error("Usage: node make-viewer.mjs <mockups folder> [--title <name>] [--interactive <n,…>]");
    process.exit(1);
  }
  const interactive = (opt("--interactive") ?? "").split(",").map(Number).filter(Boolean);
  try {
    const { page, versions } = buildViewer(dir, { title: opt("--title") ?? null, interactive });
    const out = path.join(dir, "index.html");
    fs.writeFileSync(out, page);
    console.log(`${out} (${versions.length} versions)`);
    for (const v of versions) {
      const kind = v.interactive ? "interactive" : "static";
      console.log(`  ${v.n}. ${v.title} — ${kind}${v.removed.length ? `; removed: ${v.removed.join(", ")}` : ""}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
