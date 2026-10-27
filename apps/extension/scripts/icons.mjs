// Renders the toolbar icons from one SVG (coral tile with the archive glyph used in the app).
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5.5" fill="#ff6363"/>
  <g transform="translate(4 4) scale(0.6667)" fill="none" stroke="#08090a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <rect width="20" height="5" x="2" y="3" rx="1"/>
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>
    <path d="M10 12h4"/>
  </g>
</svg>`;

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(svg(size)), { density: 72 * (size / 24) * 4 }).resize(size, size).png().toFile(`public/icons/${size}.png`);
}
console.log("icons written");
