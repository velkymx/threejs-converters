#!/usr/bin/env node
// material-normalize.js — force every material to lit PBR Metal/Rough sane for three.js. Single file.
// Why: finds ship with KHR_materials_unlit (flat look), specular-gloss legacy, doubleSide-everything
//   (overdraw + shadow acne), garbage factors. three.js renders Standard; normalize once, look right.
// Fixes: spec/gloss → metal/rough (metalRough transform) · unlit → lit (drops KHR_materials_unlit,
//   keeps baseColor) · doubleSided off unless --keep-double · alphaMode BLEND only if baseColor alpha<1
//   else OPAQUE · clamp metal/rough/emissive into range · dedup identical materials.
// Usage: node converters/material-normalize.js <in.glb> [--out out.glb] [--keep-double]
// Deps: @gltf-transform/core @gltf-transform/functions (npm i)
import { writeFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { metalRough, dedup, prune } from '@gltf-transform/functions';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`material-normalize.js — sane PBR materials for three.js
Usage:
  node converters/material-normalize.js <in.glb> [--out out.glb] [--keep-double]
Example:
  node converters/material-normalize.js ./assets/find.glb --out ./assets/find.mat.glb
Next: node converters/glb-optimize.js ./assets/find.mat.glb`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, out: null, keepDouble: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') o.out = args[++i];
  else if (a === '--keep-double') o.keepDouble = true;
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (!o.out) o.out = o.in.replace(/\.gl(b|tf)$/i, '.mat.glb');

const io = new NodeIO();
const doc = await io.read(o.in);
await doc.transform(metalRough()); // spec-gloss legacy → metal/rough (no-op if already PBR)

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
let unlit = 0, doubled = 0, blended = 0, clamped = 0;
for (const m of doc.getRoot().listMaterials()) {
  if (m.getExtension('KHR_materials_unlit')) { m.setExtension('KHR_materials_unlit', null); unlit++; }
  if (!o.keepDouble && m.getDoubleSided()) { m.setDoubleSided(false); doubled++; }
  const bc = m.getBaseColorFactor();
  if (m.getAlphaMode() === 'BLEND' && (bc[3] ?? 1) >= 1 && !m.getBaseColorTexture()) { m.setAlphaMode('OPAQUE'); blended++; }
  for (const [get, set] of [[m.getMetallicFactor, m.setMetallicFactor], [m.getRoughnessFactor, m.setRoughnessFactor]]) {
    const v = get.call(m), c = clamp01(v);
    if (c !== v) { set.call(m, c); clamped++; }
  }
  const e = m.getEmissiveFactor();
  if (e.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) { m.setEmissiveFactor(e.map(clamp01)); clamped++; }
}
// dedup identical PBR materials (same factors + same textures)
const key = (m) => JSON.stringify([m.getBaseColorFactor(), m.getMetallicFactor(), m.getRoughnessFactor(),
  m.getAlphaMode(), m.getDoubleSided(), m.getEmissiveFactor(),
  m.getBaseColorTexture()?.getName(), m.getMetallicRoughnessTexture()?.getName(), m.getNormalTexture()?.getName()]);
const seen = new Map();
let merged = 0;
for (const m of [...doc.getRoot().listMaterials()]) {
  const k = key(m);
  if (seen.has(k)) {
    const keep = seen.get(k);
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) if (p.getMaterial() === m) p.setMaterial(keep);
    m.dispose();
    merged++;
  } else seen.set(k, m);
}
await doc.transform(dedup(), prune({ keepAttributes: true }));

console.log(`Materials: ${seen.size + merged} → ${seen.size} (${merged} duplicates merged)`);
console.log(`Fixes: ${unlit} unlit→lit, ${doubled} double→front, ${blended} blend→opaque, ${clamped} factor(s) clamped`);
writeFileSync(o.out, Buffer.from(await io.writeBinary(doc)));
console.log(`Wrote ${o.out} (${(statSync(o.out).size / 1024).toFixed(1)} KB)`);
