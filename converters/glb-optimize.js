#!/usr/bin/env node
// glb-optimize.js — .glb/.gltf -> three.js-ready optimized .glb. Single file.
// Pipeline: SCALE-normalize → dedup → instance → palette → prune → resample → sparse → weld → quantize → textureCompress(webp)
// Usage:
//   node converters/glb-optimize.js <in.glb> [--out out.glb] [--texture-size 2048] [--no-compress] [--quant 14]
//   Scale (reason: internet finds ship in mm/cm/inches; three.js expects 1 unit = 1 meter):
//     [--scale 0.01] [--units mm|cm|m|km|in|ft|yd] [--target-max 2] [--target-height 1.8]
//     [--no-center] [--no-ground]
// Deps: @gltf-transform/core @gltf-transform/functions sharp (npm i)
import { writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import {
  dedup, instance, palette, prune, resample, sparse, weld,
  quantize, textureCompress,
} from '@gltf-transform/functions';

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`glb-optimize.js — optimize model for three.js
Usage:
  node converters/glb-optimize.js <in.glb|in.gltf> [--out out.glb] [--texture-size 2048] [--no-compress] [--quant 14]
  node converters/glb-optimize.js <in.glb> --units cm | --scale 0.01 | --target-max 2

Scale flags (reason: 1 three.js unit = 1 meter; random online scales break camera/physics/shadows):
  --units mm|cm|m|km|in|ft|yd   multiply raw units to meters (e.g. --units cm)
  --scale FACTOR                 explicit extra multiplier (combines with --units)
  --target-max M                 auto-fit longest bbox side to M meters (after units/scale)
  --target-height M              auto-fit bbox Y height to M meters
  --no-center                    keep XZ offset (default: center XZ to origin)
  --no-ground                    keep Y offset (default: rest bbox min.y on y=0)
  --no-scale                     skip scale stage entirely (inspect-only)
  --no-quantize                  skip quantization (keeps float POSITION; use if target viewer lacks KHR_mesh_quantization)

What it does: world-bbox measure → uniform root wrapper (exact for any hierarchy/rotation/mirror,
safe for skins: uniform S cancels in skinning matrices) → dedup, instance, palette, prune,
resample, sparse, weld, quantize, webp textureCompress.
Examples:
  node converters/glb-optimize.js ./assets/model.glb --out ./assets/model.opt.glb --target-max 2
  node converters/glb-optimize.js ./assets/chair-cm.glb --units cm --out ./assets/chair.glb`);
  process.exit(args.length ? 0 : 1);
}

function parse(argv) {
  const o = { in: null, out: null, texSize: 2048, compress: true, quant: 14,
    scale: 1, units: null, targetMax: 0, targetHeight: 0, center: true, ground: true, doScale: true, doQuant: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--texture-size') o.texSize = Number(argv[++i]);
    else if (a === '--no-compress') o.compress = false;
    else if (a === '--quant') o.quant = Number(argv[++i]);
    else if (a === '--scale') o.scale = Number(argv[++i]);
    else if (a === '--units') o.units = argv[++i];
    else if (a === '--target-max') o.targetMax = Number(argv[++i]);
    else if (a === '--target-height') o.targetHeight = Number(argv[++i]);
    else if (a === '--no-center') o.center = false;
    else if (a === '--no-ground') o.ground = false;
    else if (a === '--no-scale') o.doScale = false;
    else if (a === '--no-quantize') o.doQuant = false;
    else if (!a.startsWith('--') && !o.in) o.in = a;
    else { console.error(`Unknown: ${a}`); process.exit(1); }
  }
  if (!o.in) { console.error('Missing input file.'); process.exit(1); }
  if (o.units && !UNITS[o.units]) { console.error(`Bad --units (want ${Object.keys(UNITS).join('|')})`); process.exit(1); }
  for (const k of ['scale', 'texSize', 'quant', 'targetMax', 'targetHeight'])
    if (!Number.isFinite(o[k]) || o[k] < 0 || (k === 'scale' && o[k] === 0)) { console.error(`Bad --${k}: ${o[k]}`); process.exit(1); }
  if (o.texSize < 1 || o.texSize > 16384) { console.error(`Bad --texSize: ${o.texSize} (want 1..16384).`); process.exit(1); }
  if (!(o.quant >= 1 && o.quant <= 16)) { console.error(`Bad --quant: ${o.quant} (want 1..16).`); process.exit(1); }
  if (!o.out) o.out = o.in.replace(/\.gl(tf|b)$/i, '.opt.glb');
  return o;
}

function accBounds(pos) { // never throws: stored min/max else scan array
  try {
    const mn = pos.getMin(), mx = pos.getMax();
    if (mn && mx && mn.length === 3 && mx.length === 3 && [...mn, ...mx].every(Number.isFinite)) return { mn, mx };
  } catch { /* hostile accessor: fall through to scan */ }
  try {
    const a = pos.getArray();
    if (!a || a.length < 3) return null;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < a.length; i += 3)
      for (let d = 0; d < 3; d++) { const v = a[i + d]; if (!Number.isFinite(v)) return null; if (v < mn[d]) mn[d] = v; if (v > mx[d]) mx[d] = v; }
    return { mn, mx };
  } catch { return null; }
}
function mulMat(a, b) { // column-major 4x4, out = a * b
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function worldBBox(doc) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let found = false;
  const visit = (node, parent) => {
    const w = mulMat(parent, [...node.getMatrix()]);
    const mesh = node.getMesh();
    if (mesh) for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const bb = accBounds(pos);
      if (!bb) continue; // skip broken accessors, never crash
      const { mn, mx } = bb;
      found = true;
      for (let i = 0; i < 8; i++) {
        const x = i & 1 ? mx[0] : mn[0], y = i & 2 ? mx[1] : mn[1], z = i & 4 ? mx[2] : mn[2];
        const X = w[0]*x + w[4]*y + w[8]*z + w[12], Y = w[1]*x + w[5]*y + w[9]*z + w[13], Z = w[2]*x + w[6]*y + w[10]*z + w[14];
        if (X < min[0]) min[0] = X; if (Y < min[1]) min[1] = Y; if (Z < min[2]) min[2] = Z;
        if (X > max[0]) max[0] = X; if (Y > max[1]) max[1] = Y; if (Z > max[2]) max[2] = Z;
      }
    }
    for (const c of node.listChildren()) visit(c, w);
  };
  for (const scene of doc.getRoot().listScenes()) for (const r of scene.listChildren()) visit(r, IDENT);
  // fallback: meshes never referenced by any scene (dangling) — still measure local bbox
  if (!found) for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const bb = accBounds(pos);
    if (!bb) continue;
    const { mn, mx } = bb;
    found = true;
    for (let d = 0; d < 3; d++) { if (mn[d] < min[d]) min[d] = mn[d]; if (mx[d] > max[d]) max[d] = mx[d]; }
  }
  return found ? { min, max } : null;
}
const fmt = (b) => b ? `min [${b.min.map((v) => v.toFixed(3))}] max [${b.max.map((v) => v.toFixed(3))}] size [${b.max.map((v, i) => (v - b.min[i]).toFixed(3))}]` : '(no geometry)';

const o = parse(args);
if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
try { mkdirSync(dirname(o.out) || '.', { recursive: true }); }
catch { console.error(`Cannot write to ${o.out} (bad path).`); process.exit(1); }
const before = statSync(o.in).size;
console.log(`Load ${o.in} (${(before / 1024).toFixed(1)} KB)…`);
const io = new NodeIO();
let doc;
try { doc = await io.read(o.in); }
catch { console.error(`Cannot read ${o.in} (corrupt or unsupported glTF).`); process.exit(1); }

// --- SCALE stage (first: measure raw world units, decide uniform factor, wrap in root) ---
if (o.doScale) {
  const raw = worldBBox(doc);
  console.log(`BBox raw: ${fmt(raw)}`);
  if (!raw) console.log('Scale: no geometry found, skip.');
  else {
    const rawSize = raw.max.map((v, i) => v - raw.min[i]);
    let s = (o.units ? UNITS[o.units] : 1) * o.scale;
    const scaledSize = rawSize.map((v) => v * s);
    if (o.targetMax > 0) {
      const m = Math.max(...scaledSize);
      if (m <= 0) console.log('Scale: degenerate bbox, skip auto-fit.');
      else s *= o.targetMax / m;
    } else if (o.targetHeight > 0) {
      if (scaledSize[1] <= 0) console.log('Scale: zero height, skip auto-fit.');
      else s *= o.targetHeight / scaledSize[1];
    }
    if (!(s > 0 && Number.isFinite(s))) { console.error(`Bad computed factor ${s}, abort scale.`); process.exit(1); }
    // world offset in scaled space: center XZ, ground Y
    const cx = (raw.min[0] + raw.max[0]) / 2 * s, cz = (raw.min[2] + raw.max[2]) / 2 * s;
    const t = [o.center ? -cx : 0, o.ground ? -raw.min[1] * s : (o.center ? -(raw.min[1] + raw.max[1]) / 2 * s : 0), o.center ? -cz : 0];
    const scenes = doc.getRoot().listScenes();
    if (scenes.length === 0) console.log('Scale: no scenes, skip wrapper.');
    else if (s === 1 && t.every((v) => v === 0)) console.log('Scale: already normalized (factor 1, offset 0). No wrapper.');
    else {
      const root = doc.createNode('SCALE_ROOT');
      root.setScale([s, s, s]);
      root.setTranslation(t);
      for (const scene of scenes) {
        const kids = [...scene.listChildren()];
        for (const k of kids) { scene.removeChild(k); root.addChild(k); }
        scene.addChild(root);
      }
      console.log(`Scale: factor x${Number(s.toPrecision(6))} (${o.units ? `--units ${o.units} ` : ''}${o.scale !== 1 ? `--scale ${o.scale} ` : ''}${o.targetMax ? `--target-max ${o.targetMax} ` : ''}${o.targetHeight ? `--target-height ${o.targetHeight} ` : ''}→ root wrapper) offset [${t.map((v) => v.toFixed(3))}]`);
      const afterBox = worldBBox(doc);
      console.log(`BBox out: ${fmt(afterBox)}`);
    }
    const finalMax = Math.max(...rawSize) * s;
    if (finalMax > 1000) console.log('Warn: model still >1000m — check --units (mm vs cm mixup is common).');
    else if (finalMax < 0.01) console.log('Warn: model still <1cm — check --units (maybe meters already, drop --units).');
  }
} else console.log('Scale: skipped (--no-scale).');

await doc.transform(
  dedup(),
  instance(),
  palette(),
  prune({ keepAttributes: true }),
  resample(),
  sparse({ ratio: 1 / 10 }),
  weld({ tolerance: 0.0001 }),
  ...(o.doQuant ? [quantize({ quantizePosition: o.quant, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeGeneric: 12 })] : []),
);
if (!o.doQuant) console.log('Quantize: skipped (--no-quantize).');

if (o.compress) {
  console.log(`Compress textures → webp max ${o.texSize}px…`);
  await doc.transform(textureCompress({
    encoder: (await import('sharp')).default,
    targetFormat: 'webp',
    resize: [o.texSize, o.texSize],
    quality: 82,
    effort: 4,
  }));
}

const outBytes = await io.writeBinary(doc);
writeFileSync(o.out, Buffer.from(outBytes));
const after = statSync(o.out).size;
console.log(`Wrote ${o.out} (${(after / 1024).toFixed(1)} KB) — ${((100 * (1 - after / before)).toFixed(1))}% smaller`);
console.log('Load in three.js: GLTFLoader + WebP support is built-in. 1 unit = 1 meter.');
