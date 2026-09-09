#!/usr/bin/env node
// lod-generate.js — .glb -> LOD chain (.lod1.glb, .lod2.glb, ...) via meshoptimizer. Single file.
// Why: one mesh rarely fits all distances; games swap lower-tri versions far away. meshoptimizer's
//   simplifier runs as pure wasm in Node, so this needs no native toolchain.
// How: fresh read per level (simplify mutates) -> dedup -> simplify(ratio, error, lockBorder) ->
//   write `<out>.lodN.glb` + tri counts. The input itself stays untouched as LOD0.
// Usage: node converters/lod-generate.js <in.glb> [--out lod.glb] [--levels 0.5,0.25]
//     [--error 0.001] [--lock-border]
// Deps: @gltf-transform/core @gltf-transform/functions meshoptimizer (npm i)
import { writeFileSync, statSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { dedup, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`lod-generate.js — LOD chain via meshoptimizer simplify
Usage:
  node converters/lod-generate.js <in.glb> [--out lod.glb] [--levels 0.5,0.25]
    [--error 0.001] [--lock-border]
  Ratios are fractions of source tris, strictly decreasing. --error bounds deviation in model
  units. --lock-border keeps tile edges stitched (slower, use for chunked terrain).
Example:
  node converters/lod-generate.js ./assets/tree.glb --out ./assets/tree.lod.glb --levels 0.5,0.25
  # LOD1 (ratio 0.5): 12000 tris → tree.lod1.glb
Next: swap in three.js with THREE.LOD at your distances.`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, out: null, levels: [0.5, 0.25], error: 0.001, lockBorder: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') o.out = args[++i];
  else if (a === '--levels') o.levels = args[++i].split(',').map(Number);
  else if (a === '--error') o.error = Number(args[++i]);
  else if (a === '--lock-border') o.lockBorder = true;
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
if (!o.levels.length || !o.levels.every((r) => r > 0 && r < 1)) { console.error('Bad --levels (want ratios in (0,1), e.g. 0.5,0.25).'); process.exit(1); }
if ([...o.levels].sort((a, b) => b - a).some((r, i) => r !== o.levels[i])) { console.error('Bad --levels (want strictly decreasing).'); process.exit(1); }
if (!Number.isFinite(o.error) || o.error < 0) { console.error('Bad --error (want >= 0 model units).'); process.exit(1); }
if (!o.out) o.out = o.in.replace(/\.glb$/i, '.lod.glb');

const data = readFileSync(o.in);
if (data.length < 12 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2) {
  console.error(`Not a GLB file: ${o.in} (bad magic or version).`);
  process.exit(1);
}
try { mkdirSync(dirname(o.out) || '.', { recursive: true }); }
catch { console.error(`Cannot write to ${o.out} (bad path).`); process.exit(1); }

await MeshoptSimplifier.ready;
const io = new NodeIO();
const countTris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    n += Math.floor(((idx ? idx.getCount() : 0) || prim.getAttribute('POSITION')?.getCount() || 0) / 3);
  }
  return n;
};
const base = await io.read(o.in).catch(() => { console.error(`Cannot read ${o.in} (corrupt or unsupported glTF).`); process.exit(1); });
const srcTris = countTris(base);
if (!srcTris) { console.error('No triangles to simplify.'); process.exit(1); }
// skinned meshes allowed: simplify remaps every attribute stream (joints/weights included)
// together, so influence data stays per-vertex consistent — verify with rig-report.js after
console.log(`Source: ${srcTris} tris${base.getRoot().listSkins().length ? ' (skinned — re-check with rig-report.js)' : ''}.`);
const stem = o.out.replace(/\.glb$/i, '');
let n = 0;
for (const ratio of o.levels) {
  n++;
  // why fresh read: simplify mutates in place, so every level derives from the source
  const doc = await io.read(o.in);
  await doc.transform(
    dedup(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: o.error, lockBorder: o.lockBorder }),
  );
  const out = `${stem}.lod${n}.glb`;
  writeFileSync(out, Buffer.from(await io.writeBinary(doc)));
  console.log(`LOD${n} (ratio ${ratio}): ${countTris(doc)} tris → ${out} (${(statSync(out).size / 1024).toFixed(1)} KB)`);
}
