// Generates the PWA raster icons from the single source of truth, src/app/icon.svg.
// Re-run after editing the SVG:  node scripts/build-icons.mjs
//
// - icon-192.png / icon-512.png  → manifest "any" icons (the SVG as-authored, rounded corners)
// - icon-maskable-512.png        → manifest "maskable" icon: full-bleed background with the mark
//   pulled into the safe zone, so Android's mask can't clip it.
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const svg = readFileSync(join(root, "src/app/icon.svg"));
const outDir = join(root, "public/icons");
mkdirSync(outDir, { recursive: true });

// High render density so the vector rasterizes crisply before any downscale.
const render = (size) => sharp(svg, { density: 512 }).resize(size, size);

for (const size of [192, 512]) {
  await render(size).png().toFile(join(outDir, `icon-${size}.png`));
}

// Maskable: composite the mark (scaled into the central safe zone) onto a full-bleed
// background matching the SVG's own panel color, so there are no transparent corners.
const CANVAS = 512;
const MARGIN = Math.round(CANVAS * 0.14); // ~72px → mark sits within the ~72% safe zone
const mark = await render(CANVAS - MARGIN * 2).png().toBuffer();
await sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: "#0f151a" } })
  .composite([{ input: mark, top: MARGIN, left: MARGIN }])
  .png()
  .toFile(join(outDir, "icon-maskable-512.png"));

console.log("wrote public/icons/{icon-192,icon-512,icon-maskable-512}.png");
