// Direction 3's interactions: the menu drawer, the billing switch and the tea tabs.
(() => {
  const $ = (s) => document.querySelector(s);
  const drawer = $("#drawer"),
    menu = $("#menu-button"),
    scrim = $("#scrim");
  const setMenu = (open) => {
    drawer.dataset.open = String(open);
    scrim.hidden = !open;
    menu.setAttribute("aria-expanded", String(open));
    if (open) drawer.querySelector("a").focus();
    else menu.focus();
  };
  menu.addEventListener("click", () => setMenu(drawer.dataset.open !== "true"));
  scrim.addEventListener("click", () => setMenu(false));
  $("#close-menu").addEventListener("click", () => setMenu(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.dataset.open === "true") setMenu(false);
  });
  const billing = $("#billing");
  billing.addEventListener("click", () => {
    const yearly = billing.getAttribute("aria-checked") !== "true";
    billing.setAttribute("aria-checked", String(yearly));
    for (const p of document.querySelectorAll("[data-monthly]"))
      p.textContent = "$" + (yearly ? p.dataset.yearly : p.dataset.monthly);
    $("#per").textContent = yearly ? "a month, billed yearly" : "a month";
  });
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (t) => {
    for (const x of tabs) {
      const on = x === t;
      x.setAttribute("aria-selected", String(on));
      x.tabIndex = on ? 0 : -1;
      $("#" + x.getAttribute("aria-controls")).hidden = !on;
    }
  };
  for (const t of tabs) {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(t);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        select(n);
        n.focus();
      }
    });
  }
})();
