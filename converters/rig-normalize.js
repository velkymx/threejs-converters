#!/usr/bin/env node
// rig-normalize.js — make any skinned GLB three.js-safe. Single file.
// Fixes (behavior-preserving unless noted):
//   >4 influences → keep top-4 by weight, renormalize (three.js vec4 hard limit; extras were silently dropped before)
//   weight sums ≠ 1 → renormalize (stops pose breathing)
//   JOINTS_1/WEIGHTS_1 second set → merged into top-4 then stripped (dead weight in three.js)
//   missing inverseBindMatrices → explicit identity IBM (= three.js fallback assumption, now visible to all loaders)
//   WEIGHTS rewritten FLOAT (exact sums; UBYTE rounding re-breaks normalization)
// Usage: node converters/rig-normalize.js <in.glb> [--out out.glb]
// Order: rig-normalize FIRST, then glb-optimize (quantize leaves JOINTS/WEIGHTS alone).
// Deps: @gltf-transform/core (npm i)
import { writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`rig-normalize.js — clamp influences, renormalize weights, explicit IBM
Usage:
  node converters/rig-normalize.js <in.glb> [--out out.rig.glb]
Check first: node converters/rig-report.js <model.glb>`);
  process.exit(args.length ? 0 : 1);
}
let input = null, output = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') output = args[++i];
  else if (!args[i].startsWith('--') && !input) input = args[i];
  else { console.error(`Unknown: ${args[i]}`); process.exit(1); }
}
if (!input) { console.error('Missing input.'); process.exit(1); }
if (!existsSync(input)) { console.error(`No such file: ${input}`); process.exit(1); }
if (!output) output = input.replace(/\.glb$/i, '.rig.glb');

const UMAX = { 5121: 255, 5123: 65535 };
const toFloat = (acc) => { // weights → float regardless of storage
  const raw = acc.getArray();
  if (acc.getNormalized() && UMAX[acc.getComponentType()]) {
    const m = UMAX[acc.getComponentType()], out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] / m;
    return out;
  }
  return Float32Array.from(raw);
};

const io = new NodeIO();
let doc;
try { doc = await io.read(input); }
catch { console.error(`Cannot read ${input} (corrupt or unsupported glTF).`); process.exit(1); }
let prims = 0, clamped = 0, renorm = 0, stripped = 0;

for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const j0 = prim.getAttribute('JOINTS_0'), w0 = prim.getAttribute('WEIGHTS_0');
  if (!j0 || !w0) continue;
  prims++;
  const J0 = [...j0.getArray()], W0 = [...toFloat(w0)];
  const j1 = prim.getAttribute('JOINTS_1'), w1 = prim.getAttribute('WEIGHTS_1');
  let J1 = null, W1 = null;
  if (j1 && w1) { J1 = [...j1.getArray()]; W1 = [...toFloat(w1)]; }
  const nv = j0.getCount();
  const W = new Float32Array(nv * 4);
  const JT = j0.getArray().constructor; // keep joint storage type (UBYTE vs USHORT)
  const Jn = new JT(nv * 4);
  for (let i = 0; i < nv; i++) {
    const cand = [];
    for (let k = 0; k < 4; k++) cand.push([W0[i*4+k], J0[i*4+k]]);
    if (J1 && W1) for (let k = 0; k < 4; k++) cand.push([W1[i*4+k], J1[i*4+k]]);
    cand.sort((a, b) => b[0] - a[0]);
    const top = cand.slice(0, 4);
    if (cand.length > 4 && cand[4][0] > 0) clamped++;
    let sum = 0; for (const [w] of top) sum += w;
    if (sum > 0 && Math.abs(sum - 1) > 1e-6) renorm++;
    for (let k = 0; k < 4; k++) { Jn[i*4+k] = top[k]?.[1] ?? 0; W[i*4+k] = sum > 0 ? (top[k]?.[0] ?? 0) / sum : (k === 0 ? 1 : 0); }
    if (sum === 0) { Jn[i*4] = cand[0]?.[1] ?? 0; } // zero-weight vert: pin to first joint (was rigid anyway)
  }
  j0.setArray(Jn);
  const wa = doc.createAccessor(`${w0.getName() || 'weights'}_f32`);
  wa.setType('VEC4'); wa.setArray(W);
  prim.setAttribute('WEIGHTS_0', wa);
  if (j1 || w1) { prim.setAttribute('JOINTS_1', null); prim.setAttribute('WEIGHTS_1', null); stripped++; }
}

let ibmAdded = 0;
for (const skin of doc.getRoot().listSkins()) {
  if (!skin.getInverseBindMatrices()) {
    const n = skin.listJoints().length;
    const ibm = doc.createAccessor('ibm_identity');
    ibm.setType('MAT4');
    const m = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) m[i*16] = m[i*16+5] = m[i*16+10] = m[i*16+15] = 1;
    ibm.setArray(m);
    skin.setInverseBindMatrices(ibm);
    ibmAdded++;
  }
}

try { mkdirSync(dirname(output) || '.', { recursive: true }); }
catch { console.error(`Cannot write to ${output} (bad path).`); process.exit(1); }
await io.write(output, doc);
console.log(`Wrote ${output} (${(statSync(output).size/1024).toFixed(1)} KB) — ${prims} skinned prim(s): ${clamped} verts clamped to 4, ${renorm} renormalized, ${stripped} 2nd-set(s) stripped, ${ibmAdded} IBM added.`);
console.log('Next: node converters/rig-report.js ' + output + '  (expect OK)');
