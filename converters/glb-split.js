#!/usr/bin/env node
// glb-split.js — one .glb -> N .glb (per mesh or per scene). Single file.
// Why: oversized finds must be chunked for budgets/streaming; artists also want single props out of kits.
// How: clone document per part, detach other meshes/scenes, prune orphans. Transforms kept (parts stay
//   in world pose); skins kept only if their joints survive — skinned splits print a warning.
// Usage: node converters/glb-split.js <in.glb> [--out-dir splits] [--by mesh|scene]
// Deps: @gltf-transform/core @gltf-transform/functions (npm i)
import { mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { cloneDocument, prune } from '@gltf-transform/functions';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`glb-split.js — explode GLB into parts
Usage:
  node converters/glb-split.js <in.glb> [--out-dir splits] [--by mesh|scene]
  --by mesh (default): one file per mesh. --by scene: one file per scene.
Example:
  node converters/glb-split.js ./assets/kit.glb --out-dir ./assets/kit-parts --by mesh
Next: node converters/gltf-report.js ./assets/kit-parts/<part>.glb`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, outDir: 'splits', by: 'mesh' };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out-dir') o.outDir = args[++i];
  else if (a === '--by') o.by = args[++i];
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
if (!['mesh', 'scene'].includes(o.by)) { console.error('Bad --by (want mesh|scene).'); process.exit(1); }
const stem = o.in.split('/').pop().replace(/\.gl(b|tf)$/i, '');
const safe = (s) => (s || 'part').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 48);

const io = new NodeIO();
let src;
try { src = await io.read(o.in); }
catch { console.error(`Cannot read ${o.in} (corrupt or unsupported glTF).`); process.exit(1); }
const root = src.getRoot();
const skins = root.listSkins().length;
if (skins && o.by === 'mesh') console.log(`Warn: ${skins} skin(s) present — splits keep joints, verify with rig-report.js.`);
try { mkdirSync(o.outDir, { recursive: true }); }
catch { console.error(`Cannot write to ${o.outDir} (bad path).`); process.exit(1); }

const jobs = o.by === 'scene'
  ? root.listScenes().map((s, i) => ({ name: `${stem}.scene${i}_${safe(s.getName())}`, keepScene: s }))
  : root.listMeshes().map((m, i) => ({ name: `${stem}.mesh${i}_${safe(m.getName())}`, keepMesh: m }));

if (!jobs.length) { console.error('No meshes/scenes found.'); process.exit(1); }
let n = 0;
for (const j of jobs) {
  const doc = cloneDocument(src);
  const r = doc.getRoot();
  if (j.keepMesh) {
    const keep = r.listMeshes().find((m) => m.getName() === j.keepMesh.getName());
    for (const m of r.listMeshes()) if (m !== keep) m.dispose();
    const alive = new Set(r.listMeshes());
    for (const nd of r.listNodes()) { const mm = nd.getMesh(); if (mm && !alive.has(mm)) nd.setMesh(null); }
  } else {
    const keep = r.listScenes().find((s) => s.getName() === j.keepScene.getName());
    for (const s of r.listScenes()) if (s !== keep) s.dispose();
  }
  await doc.transform(prune({ keepAttributes: true }));
  const out = join(o.outDir, `${j.name}.glb`);
  writeFileSync(out, Buffer.from(await io.writeBinary(doc)));
  console.log(`Wrote ${out} (${(statSync(out).size / 1024).toFixed(1)} KB)`);
  n++;
}
console.log(`Split ${o.in} → ${n} part(s) in ${o.outDir}/`);
