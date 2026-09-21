// Draws the 96×96 star icon with the SDK's 16-grey PNG encoder (4× supersampled for soft edges).
import { writeFileSync } from "node:fs";
import { encodePng4 } from "@quireos/sdk";

const SIZE = 96;
const SS = 4;
const cx = SIZE / 2;
const cy = SIZE / 2 + 2;
const outer = 44;
const inner = 18;
const pts = [];
for (let i = 0; i < 10; i++) {
  const r = i % 2 === 0 ? outer : inner;
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
}
function inside(x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const idx = new Uint8Array(SIZE * SIZE);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let cover = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) cover++;
    idx[y * SIZE + x] = Math.round(15 * (1 - cover / (SS * SS))); // 0 = ink
  }
}
const png = await encodePng4(idx, SIZE, SIZE);
const out = new URL("../icon.png", import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${png.length} bytes)`);
