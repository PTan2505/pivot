// Renders the toolbar icons from the brand app icon (PT monogram on the kiln tile, ember seam).
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync(new URL("../../../docs/brand/pivot-app-icon.svg", import.meta.url));

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 72 * (size / 400) * 4 })
    .resize(size, size)
    .png()
    .toFile(`public/icons/${size}.png`);
}
console.log("icons written");
