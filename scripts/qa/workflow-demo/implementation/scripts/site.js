// Kettle & Leaf landing page: the menu drawer, the billing switch and the tea tabs (approved direction 3).
const $ = (s) => document.querySelector(s);

function setupMenu() {
  const drawer = $("#drawer");
  const button = $("#menu-button");
  const scrim = $("#scrim");
  const set = (open) => {
    drawer.dataset.open = String(open);
    scrim.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    (open ? drawer.querySelector("a") : button).focus();
  };
  button.addEventListener("click", () => set(drawer.dataset.open !== "true"));
  scrim.addEventListener("click", () => set(false));
  $("#close-menu").addEventListener("click", () => set(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.dataset.open === "true") set(false);
  });
}

function setupBilling() {
  const sw = $("#billing");
  sw.addEventListener("click", () => {
    const yearly = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(yearly));
    for (const p of document.querySelectorAll("[data-monthly]"))
      p.textContent = `$${yearly ? p.dataset.yearly : p.dataset.monthly}`;
    $("#per").textContent = yearly ? "a month, billed yearly" : "a month";
  });
}

function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
  };
  for (const t of tabs) {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = tabs.indexOf(t);
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      select(next);
      next.focus();
    });
  }
}

setupMenu();
setupBilling();
setupTabs();
