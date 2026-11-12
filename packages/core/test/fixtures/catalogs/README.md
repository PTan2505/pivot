Trimmed copies of the public catalogs that hybrid search syncs, recorded on 2026-11-01 so tests never call the sites:

- `magicui-registry.json`, `magicui-sitemap.xml`, `magicui-llms.txt`: https://magicui.design/r/registry.json, /sitemap.xml
  and /llms.txt (MIT). `rainbow-button` is left out of the trimmed `llms.txt` on purpose, to test that components
  missing from Magic UI's own free list are excluded.
- `reactbits-registry.json`, `reactbits-sitemap.xml`: https://reactbits.dev/r/registry.json and /sitemap.xml
  (MIT + Commons Clause; titles and descriptions only, no component code).
- `shadcn-index.json`: https://ui.shadcn.com/r/index.json (MIT).

The registry indexes list file paths without contents; none of these files contain component code.
