import type { SectionContext } from "./api";

/** What the page reports once you have picked a section. */
export interface PickedSection {
  type: string;
  /** Document coordinates (CSS pixels from the top of the page). */
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  scrollY: number;
  selector?: string;
  pageTitle: string;
  method: "select" | "crop" | "list";
}

/**
 * Runs inside the page (must stay self-contained): an overlay to pick a section. "select" highlights the element under
 * the pointer (↑ picks its parent, ↓ its first child, Enter confirms); "crop" lets you drag a box. Escape cancels.
 * The result goes to the service worker as a message, since the popup has closed by then.
 */
export function sectionPicker(mode: "select" | "crop") {
  const w = window as unknown as { __pivotPicker?: () => void };
  w.__pivotPicker?.();
  const root = document.createElement("div");
  root.setAttribute("data-pivot-picker", "");
  root.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;";
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;pointer-events:none;border:2px solid #ff6a13;background:rgba(255,106,19,.12);border-radius:4px;display:none;";
  const tip = document.createElement("div");
  tip.style.cssText =
    "position:fixed;left:50%;top:16px;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:#18110d;color:#fbf3ea;font:500 13px system-ui,sans-serif;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.4);";
  tip.textContent =
    mode === "select"
      ? "Click a section to save it · ↑ bigger · ↓ smaller · Enter to save · Esc to cancel"
      : "Drag a box around what to save · Esc to cancel";
  root.append(box, tip);
  document.documentElement.append(root);

  const guessType = (el: Element | null) => {
    const words = [];
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      words.push(e.tagName, e.id, e.getAttribute("class") ?? "", e.getAttribute("aria-label") ?? "");
      if (words.length > 24) break;
    }
    const heading = el?.querySelector("h1, h2, h3")?.textContent ?? "";
    const text = `${words.join(" ")} ${heading}`.toLowerCase();
    const rules: [RegExp, string][] = [
      [/pricing|plans?\b|price/, "Pricing"],
      [/\bnav\b|navbar|menu|header/, "Navbar"],
      [/footer/, "Footer"],
      [/hero|banner|jumbotron/, "Hero"],
      [/testimonial|review|quote/, "Testimonials"],
      [/faq|question/, "FAQ"],
      [/feature/, "Features"],
      [/\bcta\b|call-to-action|get started|sign up/, "Call to action"],
      [/form|sign ?in|log ?in|contact/, "Form"],
      [/gallery|showcase|work|portfolio/, "Gallery"],
    ];
    for (const [re, name] of rules) if (re.test(text)) return name;
    const r = el?.getBoundingClientRect();
    return r && r.top + scrollY < innerHeight * 0.6 ? "Hero" : "Section";
  };
  const selectorOf = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      if (e.id) {
        parts.unshift(`#${CSS.escape(e.id)}`);
        break;
      }
      const cls = [...e.classList]
        .slice(0, 2)
        .map((c) => `.${CSS.escape(c)}`)
        .join("");
      parts.unshift(`${e.tagName.toLowerCase()}${cls}`);
    }
    return parts.join(" > ");
  };
  const show = (r: { left: number; top: number; width: number; height: number }) => {
    box.style.display = "block";
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
  };
  const cleanup = () => {
    root.remove();
    removeEventListener("keydown", onKey, true);
    w.__pivotPicker = undefined;
  };
  const finish = (rect: { x: number; y: number; width: number; height: number }, type: string, selector?: string) => {
    cleanup();
    if (rect.width < 8 || rect.height < 8) return;
    void chrome.runtime.sendMessage({
      type: "pivot:section-picked",
      section: {
        type,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y + scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        viewport: { width: innerWidth, height: innerHeight },
        scrollY: Math.round(scrollY),
        selector,
        pageTitle: document.title,
        method: mode,
      },
    });
  };

  let current: Element | null = null;
  const elementAt = (x: number, y: number) => {
    root.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    root.style.pointerEvents = "";
    return el;
  };
  const highlight = (el: Element | null) => {
    current = el;
    if (el) show(el.getBoundingClientRect());
  };
  let start: { x: number; y: number } | null = null;

  root.addEventListener("mousemove", (e) => {
    if (mode === "select") highlight(elementAt(e.clientX, e.clientY));
    else if (start) {
      show({
        left: Math.min(start.x, e.clientX),
        top: Math.min(start.y, e.clientY),
        width: Math.abs(e.clientX - start.x),
        height: Math.abs(e.clientY - start.y),
      });
    }
  });
  root.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (mode === "crop") start = { x: e.clientX, y: e.clientY };
  });
  root.addEventListener("mouseup", (e) => {
    if (mode === "crop" && start) {
      const rect = {
        x: Math.min(start.x, e.clientX),
        y: Math.min(start.y, e.clientY),
        width: Math.abs(e.clientX - start.x),
        height: Math.abs(e.clientY - start.y),
      };
      start = null;
      const center = elementAt(rect.x + rect.width / 2, rect.y + rect.height / 2);
      finish(rect, guessType(center) === "Section" ? "Crop" : guessType(center));
    }
  });
  root.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (mode === "select" && current) {
      const r = current.getBoundingClientRect();
      finish({ x: r.left, y: r.top, width: r.width, height: r.height }, guessType(current), selectorOf(current));
    }
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
      return;
    }
    if (mode !== "select" || !current) return;
    if (e.key === "ArrowUp" && current.parentElement && current.parentElement !== document.documentElement) {
      e.preventDefault();
      highlight(current.parentElement);
    } else if (e.key === "ArrowDown" && current.firstElementChild) {
      e.preventDefault();
      highlight(current.firstElementChild);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = current.getBoundingClientRect();
      finish({ x: r.left, y: r.top, width: r.width, height: r.height }, guessType(current), selectorOf(current));
    }
  };
  addEventListener("keydown", onKey, true);
  w.__pivotPicker = cleanup;
  // keyboard users start with the main content highlighted
  if (mode === "select") highlight(document.querySelector("main, [role=main]") ?? document.body.firstElementChild);
}

/** Runs inside the page: the page's main sections (landmarks, sections with headings), for picking with the keyboard. */
export function listSections(): PickedSection[] {
  const seen = new Set<Element>();
  const out: PickedSection[] = [];
  const nameOf = (el: Element) => {
    const label = el.getAttribute("aria-label") || el.querySelector("h1, h2, h3")?.textContent?.trim() || "";
    const tag = el.tagName.toLowerCase();
    const kind =
      tag === "nav" || (tag === "header" && !el.closest("main"))
        ? "Navbar"
        : tag === "footer"
          ? "Footer"
          : /pricing|plan/i.test(label + el.className)
            ? "Pricing"
            : out.length === 0 || el.getBoundingClientRect().top + scrollY < innerHeight * 0.6
              ? "Hero"
              : "Section";
    return { kind, label: label.replace(/\s+/g, " ").slice(0, 60) };
  };
  const candidates = document.querySelectorAll(
    "body > header, nav, main > section, main > div > section, section, [role=region], footer, main > *",
  );
  for (const el of candidates) {
    if (seen.has(el) || out.length >= 20) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 120 || r.width < innerWidth * 0.4) continue;
    // skip one nested inside an element already listed
    if ([...seen].some((s) => s.contains(el))) continue;
    seen.add(el);
    const { kind, label } = nameOf(el);
    out.push({
      type: label ? `${kind}: ${label}` : kind,
      rect: {
        x: Math.round(r.left),
        y: Math.round(r.top + scrollY),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
      viewport: { width: innerWidth, height: innerHeight },
      scrollY: Math.round(scrollY),
      selector: el.id ? `#${CSS.escape(el.id)}` : undefined,
      pageTitle: document.title,
      method: "list",
    });
  }
  return out.sort((a, b) => a.rect.y - b.rect.y);
}

/** Runs inside the page: scrolls to `y` without smooth scrolling and returns where it ended up. */
export function scrollPageTo(y: number) {
  document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
  scrollTo(0, y);
  return scrollY;
}

/** The type and context saved with the section, without the "Hero: <heading>" label used in the list. */
export function toSectionContext(s: PickedSection): SectionContext {
  return { ...s, type: s.type.split(":")[0].trim() };
}
