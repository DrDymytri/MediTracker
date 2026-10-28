import sharp from "sharp";
import path from "node:path";

// Heart-pulse mark on the brand green. Edit and re-run `npm run icons` to regenerate.
const svg = (size, inset) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#173f37"/>
  <g transform="translate(256 256) scale(${inset}) translate(-256 -256)" fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <path d="M256 420 C 120 320 80 250 80 190 C 80 140 118 106 164 106 C 204 106 236 128 256 160 C 276 128 308 106 348 106 C 394 106 432 140 432 190 C 432 250 392 320 256 420 Z"/>
    <path d="M130 250 H210 L240 190 L280 310 L310 250 H382" stroke="#7fd1c3"/>
  </g>
</svg>`;

const out = path.join(process.cwd(), "public");
const targets = [["icon-192.png", 192, 0.9], ["icon-512.png", 512, 0.8], ["apple-touch-icon.png", 180, 0.9]];
for (const [name, size, inset] of targets) {
  await sharp(Buffer.from(svg(size, inset))).png().toFile(path.join(out, name));
  console.log(`Wrote public/${name}`);
}
