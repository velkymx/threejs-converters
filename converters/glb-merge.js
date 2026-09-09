#!/usr/bin/env node
// glb-merge.js — N .glb/.gltf -> one merged .glb. Single file.
// Why: levels/props ship as many finds; each file = extra downloads + draws. Merge once, load once.
// How: mergeDocuments per input (buffers/images/anims carried) → optional join (fuse compatible
//   primitives, cuts draws) → dedup + prune. Skins/skeletons merge as-is; run rig-report after on merge.
// Usage: node converters/glb-merge.js <a.glb> <b.glb> [...] [--out merged.glb] [--no-join] [--no-prune]
// Deps: @gltf-transform/core @gltf-transform/functions (npm i)
import { writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { mergeDocuments, join, dedup, prune, unpartition } from '@gltf-transform/functions';

const args = process.argv.slice(2);
if (args.length < 1 || args.includes('--help') || args.includes('-h')) {
  console.log(`glb-merge.js — merge models into one GLB
Usage:
  node converters/glb-merge.js <a.glb> <b.glb> [...] [--out merged.glb] [--no-join] [--no-prune]
What: concatenates scenes/meshes/materials/anims of every input.
  --join default ON (fuse compatible primitives → fewer draws; splits by material automatically).
  Skins kept per-input (no skeleton retarget). Scales kept as-authored: normalize inputs
  first with glb-optimize.js if finds came in mixed units.
Example:
  node converters/glb-merge.js ./assets/chair.glb ./assets/table.glb --out ./assets/room.glb
Next: node converters/gltf-report.js ./assets/room.glb`);
  process.exit(args.length ? 0 : 1);
}

const o = { ins: [], out: null, doJoin: true, doPrune: true };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') o.out = args[++i];
  else if (a === '--no-join') o.doJoin = false;
  else if (a === '--no-prune') o.doPrune = false;
  else if (!a.startsWith('--')) o.ins.push(a);
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (o.ins.length < 2) { console.error('Need 2+ inputs.'); process.exit(1); }
if (!o.out) o.out = 'merged.glb';
for (const f of o.ins) if (!existsSync(f)) { console.error(`No such file: ${f}`); process.exit(1); }
try { mkdirSync(dirname(o.out) || '.', { recursive: true }); }
catch { console.error(`Cannot write to ${o.out} (bad path).`); process.exit(1); }

const io = new NodeIO();
const read = async (f) => {
  try { return await io.read(f); }
  catch { console.error(`Cannot read ${f} (corrupt or unsupported glTF).`); process.exit(1); }
};
let before = 0;
const base = await read(o.ins[0]);
before += statSync(o.ins[0]).size;
console.log(`Base ${o.ins[0]}`);
for (const f of o.ins.slice(1)) {
  const src = await read(f);
  before += statSync(f).size;
  mergeDocuments(base, src);
  console.log(` + ${f}`);
}
const count = (fn) => base.getRoot()[fn]().length;
console.log(`Merged: ${count('listScenes')} scene(s), ${count('listMeshes')} mesh(es), ${count('listMaterials')} mat(s), ${count('listAnimations')} anim(s)`);
if (o.doJoin) { await base.transform(join()); console.log(`Join: now ${count('listMeshes')} mesh(es)`); }
if (o.doPrune) { await base.transform(dedup(), prune({ keepAttributes: true })); }
await base.transform(unpartition()); // mergeDocuments leaves N buffers; GLB needs exactly 1
const outBytes = await io.writeBinary(base);
writeFileSync(o.out, Buffer.from(outBytes));
const after = statSync(o.out).size;
console.log(`Wrote ${o.out} (${(after / 1024).toFixed(1)} KB, inputs ${(before / 1024).toFixed(1)} KB)`);
console.log('Next: node converters/gltf-report.js ' + o.out);
