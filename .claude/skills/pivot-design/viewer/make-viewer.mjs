#!/usr/bin/env node
// Builds a mockup viewer: node make-viewer.mjs <mockups folder> [--title "Ledgerly pricing"]
//
// Writes <folder>/index.html, a self-contained page (no network, no dependencies). It shows every mockup-*.html in the
// folder as a tab, at desktop, tablet or phone width. Keys 1–9 and ←/→ switch versions. "Choose this version" copies a
// reply for the chat ("I choose version 3: <title>"). The approval is still that message, sent by the user.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const titleArg = args.includes("--title") ? args[args.indexOf("--title") + 1] : null;
if (!dir || !fs.existsSync(dir)) {
  console.error("Usage: node make-viewer.mjs <mockups folder> [--title <name>]");
  process.exit(1);
}

const files = fs
  .readdirSync(dir)
  .filter((f) => /^mockup-.*\.html$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!files.length) {
  console.error(`No mockup-*.html files in ${dir}`);
  process.exit(1);
}

const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const versions = files.map((file, i) => {
  const html = fs.readFileSync(path.join(dir, file), "utf8");
  const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? file.replace(/\.html$/i, "")).trim();
  return { n: i + 1, file, title };
});

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titleArg ?? "Mockups")} — ${versions.length} versions</title>
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
  <h1>${esc(titleArg ?? "Mockups")}</h1>
  <div role="tablist" aria-label="Versions">
    ${versions.map((v) => `<button role="tab" id="tab-${v.n}" aria-controls="frame" aria-selected="false" data-n="${v.n}" title="${esc(v.title)}">${v.n}</button>`).join("\n    ")}
  </div>
  <div class="sizes" role="group" aria-label="Width">
    <button data-w="100%" aria-pressed="true">Desktop</button><button data-w="768px" aria-pressed="false">Tablet</button><button data-w="390px" aria-pressed="false">Phone</button>
  </div>
</header>
<div class="bar"><span>Version <b id="num"></b> · <b id="name"></b></span><button class="choose" id="choose">Choose this version</button><span class="hint">Keys 1–${Math.min(versions.length, 9)} and ← → switch versions</span></div>
<main><iframe id="frame" role="tabpanel" title="Mockup"></iframe></main>
<div class="status" role="status" id="status"></div>
<script>
  const versions = ${JSON.stringify(versions)};
  const frame = document.getElementById("frame");
  let current = 1;
  function show(n) {
    current = n;
    const v = versions[n - 1];
    frame.src = v.file;
    frame.setAttribute("aria-labelledby", "tab-" + n);
    document.getElementById("num").textContent = n;
    document.getElementById("name").textContent = v.title;
    document.querySelectorAll("[role=tab]").forEach((t) => {
      const on = +t.dataset.n === n;
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
    });
    history.replaceState(null, "", "#" + n);
  }
  function say(text) {
    const s = document.getElementById("status");
    s.textContent = text;
    s.classList.add("on");
    clearTimeout(say.t);
    say.t = setTimeout(() => s.classList.remove("on"), 4000);
  }
  document.querySelectorAll("[role=tab]").forEach((t) => t.addEventListener("click", () => show(+t.dataset.n)));
  document.querySelectorAll(".sizes button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".sizes button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      frame.style.width = b.dataset.w;
    }),
  );
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

const out = path.join(dir, "index.html");
fs.writeFileSync(out, page);
console.log(`${out} (${versions.length} versions)`);
