#!/usr/bin/env node
// draco-compress.js — .glb -> Draco-compressed .glb (KHR_draco_mesh_compression). Single file.
// Why: Draco shrinks triangle geometry far beyond quantization alone; three.js decodes it with
//   DRACOLoader, so web delivery gets much smaller for one loader line.
// How: gltf-transform draco() marks primitives, then NodeIO encodes on write with the draco3dgltf
//   wasm encoder (pure wasm, no native toolchain). Compression is lossy via quantization bits.
// Usage: node converters/draco-compress.js <in.glb> [--out out.drc.glb] [--method edgebreaker|sequential]
//     [--level 7] [--quant 14]
// Deps: @gltf-transform/core @gltf-transform/functions draco3dgltf (npm i)
import { writeFileSync, statSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`draco-compress.js — Draco mesh compression for three.js delivery
Usage:
  node converters/draco-compress.js <in.glb> [--out out.drc.glb] [--method edgebreaker|sequential]
    [--level 7] [--quant 14]
  --level 0..10 trades encode time for size (7 is the sweet spot); --quant sets POSITION bits
  (normals 10, UVs 12 fixed — same as glb-optimize).
Example:
  node converters/draco-compress.js ./assets/chair.opt.glb --out ./assets/chair.drc.glb
Next: load in three.js with DRACOLoader + KHR_draco_mesh_compression support.`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, out: null, method: 'edgebreaker', level: 7, quant: 14 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') o.out = args[++i];
  else if (a === '--method') o.method = args[++i];
  else if (a === '--level') o.level = Number(args[++i]);
  else if (a === '--quant') o.quant = Number(args[++i]);
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
if (!['edgebreaker', 'sequential'].includes(o.method)) { console.error('Bad --method (want edgebreaker|sequential).'); process.exit(1); }
if (!Number.isInteger(o.level) || o.level < 0 || o.level > 10) { console.error('Bad --level (want 0..10).'); process.exit(1); }
if (!(o.quant >= 1 && o.quant <= 16)) { console.error(`Bad --quant: ${o.quant} (want 1..16).`); process.exit(1); }
if (!o.out) o.out = o.in.replace(/\.glb$/i, '.drc.glb');

const data = readFileSync(o.in);
if (data.length < 12 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2) {
  console.error(`Not a GLB file: ${o.in} (bad magic or version).`);
  process.exit(1);
}

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({ 'draco3d.encoder': await draco3d.createEncoderModule() });
let doc;
try { doc = await io.read(o.in); }
catch { console.error(`Cannot read ${o.in} (corrupt or unsupported glTF).`); process.exit(1); }
if (!doc.getRoot().listMeshes().length) { console.error('No meshes to compress.'); process.exit(1); }

// why speed mapping: draco speeds run 0 (slowest/best) to 10; --level runs the human way
// (higher = smaller), so both speeds mirror it
await doc.transform(draco({
  method: o.method,
  encodeSpeed: 10 - o.level,
  decodeSpeed: 10 - o.level,
  quantizePosition: o.quant,
}));
try { mkdirSync(dirname(o.out) || '.', { recursive: true }); }
catch { console.error(`Cannot write to ${o.out} (bad path).`); process.exit(1); }
const before = statSync(o.in).size;
writeFileSync(o.out, Buffer.from(await io.writeBinary(doc)));
const after = statSync(o.out).size;
console.log(`Wrote ${o.out} (${(after / 1024).toFixed(1)} KB, was ${(before / 1024).toFixed(1)} KB) — ${((100 * (1 - after / before)).toFixed(1))}% smaller`);
console.log('Load in three.js: GLTFLoader + DRACOLoader (draco decoder path) required.');
