# Kettle & Leaf — landing page (synthetic demo)

**Goal:** sign up visitors for a loose-leaf tea subscription. **Audience:** adults 25–45 who drink tea daily and
want better tea without a shop visit. **Type:** marketing landing page, one screen deep plus pricing. **Preferences:**
calm, warm, editorial; no stock-photo clutter. **Functional:** mobile menu, monthly/yearly billing switch, tea-type
tabs, one primary action ("Start my box"). **Constraints:** static HTML/CSS/JS (the target project has no framework),
WCAG AA contrast, works at 390 px.

## References

- Calm editorial hero — take: generous type scale, one action; leave: full-bleed photo.
- Pricing cards with switch — take: billing switch above the cards; leave: three tiers (we have two).
- Mobile drawer menu — take: right-side drawer, Escape closes; leave: nested submenus.

## Motion

Motion: standard — the page has a small set of essential state changes (auto).

| Item               | Tag       | Trigger → behaviour                                 | Reduced motion                              |
| ------------------ | --------- | --------------------------------------------------- | ------------------------------------------- |
| M1 · Hero entrance | essential | load → the heading rises 12 px and fades in, 400 ms | no movement; the heading is visible at once |
| M2 · Tab panel     | essential | click a tea tab → its panel fades in, 200 ms        | no fade; the panel shows at once            |
