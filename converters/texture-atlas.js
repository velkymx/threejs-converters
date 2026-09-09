#!/usr/bin/env node
// texture-atlas.js — N images -> one atlas PNG + offsets JSON. Single file.
// Why: one bind and one material beats N draws with N textures; atlases also compress better.
// How: sharp metadata per input (uniform cell = largest side) -> grid composite with padding ->
//   offsets JSON carrying three.js repeat/offset UVs per tile -> optional loader snippet.
// Usage: node converters/texture-atlas.js <a.png> <b.png> [...] [--out atlas.png] [--json atlas.json]
//     [--padding 2] [--cols 0] [--snippet]
// Deps: sharp (npm i sharp).
import { statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`texture-atlas.js — pack images into one atlas + UV offsets
Usage:
  node converters/texture-atlas.js <a.png> <b.png> [...] [--out atlas.png] [--json atlas.json]
    [--padding 2] [--cols 0] [--snippet]
  --cols 0 picks ceil(sqrt(n)). Tiles sit top-left in uniform cells (cell = largest input side).
  JSON tiles carry pixel rects plus three.js repeat/offset (v-flipped for GL).
Example:
  node converters/texture-atlas.js ./tex/*.png --out ./tex/atlas.png --snippet`);
  process.exit(args.length ? 0 : 1);
}

const o = { ins: [], out: 'atlas.png', json: null, padding: 2, cols: 0, snippet: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') o.out = args[++i];
  else if (a === '--json') o.json = args[++i];
  else if (a === '--padding') o.padding = Number(args[++i]);
  else if (a === '--cols') o.cols = Number(args[++i]);
  else if (a === '--snippet') o.snippet = true;
  else if (!a.startsWith('--')) o.ins.push(a);
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.ins.length) { console.error('Missing input.'); process.exit(1); }
if (!Number.isInteger(o.padding) || o.padding < 0 || o.padding > 64) { console.error('Bad --padding (want 0..64).'); process.exit(1); }
if (!Number.isInteger(o.cols) || o.cols < 0) { console.error('Bad --cols (want 0 for auto, else >= 1).'); process.exit(1); }
for (const f of o.ins) if (!existsSync(f)) { console.error(`No such file: ${f}`); process.exit(1); }
if (!o.json) o.json = o.out.replace(/\.[a-z0-9]+$/i, '.json');

const metas = [];
for (const f of o.ins) {
  try {
    const m = await sharp(f).metadata();
    if (!m.width || !m.height) throw new Error('zero size');
    metas.push({ file: f, w: m.width, h: m.height });
  } catch { console.error(`SKIP ${basename(f)}: unreadable image.`); process.exit(1); }
}
// why uniform cells: mixed-size packing (shelf/maxrect) saves pixels but makes UV math and
// debugging harder; uniform grid keeps every tile addressable by index
const cell = Math.max(...metas.map((m) => Math.max(m.w, m.h)));
const cols = o.cols || Math.ceil(Math.sqrt(metas.length));
const rows = Math.ceil(metas.length / cols);
const W = cols * (cell + o.padding) + o.padding;
const H = rows * (cell + o.padding) + o.padding;
if (W > 16384 || H > 16384) { console.error(`Atlas ${W}x${H} exceeds 16384px — fewer/bigger inputs or --cols wider.`); process.exit(1); }

const tiles = {};
const composite = [];
metas.forEach((m, i) => {
  const col = i % cols, row = Math.floor(i / cols);
  const x = o.padding + col * (cell + o.padding), y = o.padding + row * (cell + o.padding);
  composite.push({ input: m.file, left: x, top: y });
  // why v-flip here: sharp compositing is top-left origin, three.js UVs are bottom-left
  tiles[basename(m.file)] = {
    x, y, w: m.w, h: m.h,
    u: x / W, v: 1 - (y + m.h) / H, ru: m.w / W, rv: m.h / H,
  };
});
mkdirSync(dirname(resolve(o.out)) || '.', { recursive: true });
await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(composite)
  .png({ compressionLevel: 9 })
  .toFile(o.out);
writeFileSync(o.json, JSON.stringify({ width: W, height: H, cell, padding: o.padding, cols, rows, tiles }, null, 2));
console.log(`Wrote ${o.out} (${W}x${H}, ${(statSync(o.out).size / 1024).toFixed(1)} KB) + ${o.json} — ${metas.length} tile(s)`);
if (Math.max(W, H) > 4096) console.log('Note: over 4096px — older mobile GPUs cap there; use fewer inputs or pre-shrink with texture-convert.');
if (o.snippet) {
  console.log('--- three.js snippet ---');
  console.log(`const atlas = await load('${basename(o.out)}'); atlas.colorSpace = SRGBColorSpace;`);
  for (const [name, t] of Object.entries(tiles)) {
    console.log(`const t_${name.replace(/\W/g, '_')} = atlas.clone(); t.repeat.set(${t.ru}, ${t.rv}); t.offset.set(${t.u}, ${t.v}); t.needsUpdate = true; // ${name}`);
  }
}
