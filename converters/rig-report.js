#!/usr/bin/env node
// rig-report.js — skeleton audit for three.js. Zero deps. Pure Node.
// Why (reason each breaks ingame silently):
//   >4 influences/vertex → three.js skinIndex is vec4, extras ignored, deformation wrong with no error
//   weights not summing to 1 → mesh inflates/deflates when posed
//   missing inverseBindMatrices → three.js assumes identity (bind = current pose); ok only if authored that way
//   detached joints (outside scene graph) → no matrixWorld updates, limbs freeze at origin
//   zero/non-uniform joint scale → skew or collapsed skin
// Usage: node converters/rig-report.js <model.glb> [--json]
// Note: influence decode needs the .glb BIN chunk; .gltf with external .bin gets JSON-only checks.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`rig-report.js — is this rig three.js-safe?
Usage:
  node converters/rig-report.js <model.glb> [--json]
Fix path: node converters/rig-normalize.js <model.glb> (clamp 4, renormalize, explicit IBM).`);
  process.exit(args.length ? 0 : 1);
}
const file = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
const bytes = readFileSync(file);
let json, bin = null;
if (file.endsWith('.glb')) {
  const jsonLen = bytes.readUInt32LE(12);
  json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
  const binOff = 20 + jsonLen;
  if (bytes.length > binOff + 8) bin = bytes.subarray(binOff + 8, binOff + 8 + bytes.readUInt32LE(binOff));
} else json = JSON.parse(bytes.toString('utf8'));

const nodes = json.nodes || [], skins = json.skins || [], accs = json.accessors || [],
  views = json.bufferViews || [], meshes = json.meshes || [], anims = json.animations || [];

// --- reachability + parents ---
const parent = new Map();
nodes.forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
const reachable = new Set();
const mark = (i) => { if (reachable.has(i) || !nodes[i]) return; reachable.add(i); (nodes[i].children || []).forEach(mark); };
(json.scenes?.length ? json.scenes : [{ nodes: nodes.map((_, i) => i) }]).forEach((s) => (s.nodes || []).forEach(mark));

// --- accessor decode (GLB BIN only) ---
const COMP = { 5120: [Int8Array, 1, 127], 5121: [Uint8Array, 1, 255], 5122: [Int16Array, 2, 32767], 5123: [Uint16Array, 2, 65535], 5125: [Uint32Array, 4, 1], 5126: [Float32Array, 4, 1] };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
function readAcc(ai) { // stride-aware: writers interleave vertex attributes (byteStride)
  const a = accs[ai];
  if (!a || !bin) return null;
  const v = views[a.bufferView];
  if (!v) return null;
  const [Arr, bpe, max] = COMP[a.componentType] || [];
  const n = NC[a.type];
  if (!Arr || !n) return null;
  const base = (v.byteOffset || 0) + (a.byteOffset || 0);
  const stride = v.byteStride || n * bpe;
  const need = a.count * n;
  const get = (el, k) => {
    const off = bin.byteOffset + base + el * stride + k * bpe;
    if (Arr === Float32Array) return new DataView(bin.buffer).getFloat32(off, true);
    const dv = new DataView(bin.buffer);
    if (Arr === Uint8Array) return dv.getUint8(off);
    if (Arr === Int8Array) return dv.getInt8(off);
    if (Arr === Uint16Array) return dv.getUint16(off, true);
    if (Arr === Int16Array) return dv.getInt16(off, true);
    if (Arr === Uint32Array) return dv.getUint32(off, true);
    return NaN;
  };
  const out = new Float32Array(need);
  for (let el = 0; el < a.count; el++) for (let k = 0; k < n; k++) {
    const r = get(el, k);
    if (!Number.isFinite(r)) return null;
    out[el * n + k] = a.normalized ? r / max : r;
  }
  return out;
}

const warn = [];
let skinnedVerts = 0, over4 = 0, maxInf = 0, wMin = Infinity, wMax = -Infinity, zeroW = 0, sets2 = 0;
for (const m of meshes) for (const p of m.primitives || []) {
  const j0 = p.attributes?.JOINTS_0, w0 = p.attributes?.WEIGHTS_0;
  if (j0 == null || w0 == null) continue;
  const J0 = readAcc(j0), W0 = readAcc(w0);
  const has2 = p.attributes?.JOINTS_1 != null || p.attributes?.WEIGHTS_1 != null;
  if (has2) sets2++;
  if (!J0 || !W0) {
    if (has2 || j0 != null) warn.push('Influence decode skipped (external .bin or odd types): save as .glb for full audit.');
    continue;
  }
  const J1 = has2 ? readAcc(p.attributes.JOINTS_1) : null;
  const W1 = has2 ? readAcc(p.attributes.WEIGHTS_1) : null;
  const nv = accs[j0].count;
  skinnedVerts += nv;
  for (let i = 0; i < nv; i++) {
    let inf = 0, sum = 0;
    for (let k = 0; k < 4; k++) { const w = W0[i*4+k]; if (w > 0) { inf++; sum += w; } }
    if (J1 && W1) for (let k = 0; k < 4; k++) { const w = W1[i*4+k]; if (w > 0) { inf++; sum += w; } }
    if (inf > maxInf) maxInf = inf;
    if (inf > 4) over4++;
    if (sum === 0) zeroW++;
    else { if (sum < wMin) wMin = sum; if (sum > wMax) wMax = sum; }
  }
}
if (over4) warn.push(`${over4} verts with >4 influences (max ${maxInf}): three.js drops extras → fix: rig-normalize.js`);
if (sets2) warn.push(`${sets2} primitive(s) carry JOINTS_1/WEIGHTS_1 second set: ignored by three.js, dead weight → rig-normalize strips.`);
if (wMin !== Infinity && (wMin < 0.999 || wMax > 1.001)) warn.push(`Weight sums off-1 (min ${wMin.toFixed(3)}, max ${wMax.toFixed(3)}): mesh breathes when posed → rig-normalize renormalizes.`);
if (zeroW) warn.push(`${zeroW} zero-weight verts: rigid at bind pose (usually loose parts, info only).`);

const rigs = skins.map((s, si) => {
  const joints = s.joints || [];
  let depth = 0;
  const jset = new Set(joints);
  for (const j of joints) { let d = 0, p = j; const seen = new Set(); while (parent.has(p) && jset.has(parent.get(p)) && !seen.has(p)) { seen.add(p); p = parent.get(p); d++; } if (d > depth) depth = d; }
  const detached = joints.filter((j) => !reachable.has(j));
  if (detached.length) warn.push(`Skin ${si}: ${detached.length}/${joints.length} joints outside scene graph (limbs freeze) → reparent under scene root.`);
  if (!s.inverseBindMatrices) warn.push(`Skin ${si}: no inverseBindMatrices (three.js assumes identity bind; ok only if authored so) → rig-normalize writes explicit identity IBM.`);
  const badScale = joints.filter((j) => {
    const sc = nodes[j]?.scale; if (!sc) return false;
    return sc.some((v) => v === 0) || !(Math.abs(sc[0]-sc[1]) < 1e-6 && Math.abs(sc[1]-sc[2]) < 1e-6);
  });
  if (badScale.length) warn.push(`Skin ${si}: ${badScale.length} joint(s) zero/non-uniform scale (skew/collapse) → clear scale in DCC.`);
  return { joints: joints.length, depth, ibm: s.inverseBindMatrices != null, detached: detached.length };
});
if (!skins.length) warn.push('No skins: static mesh. (Info — rigid animations still play.)');

const rep = { file, skins: skins.length, rigs, skinnedVerts, maxInfluences: maxInf, over4Verts: over4,
  weightSum: wMin === Infinity ? null : { min: +wMin.toFixed(4), max: +wMax.toFixed(4) },
  animations: anims.length, ok: warn.length === 0, warnings: warn };
if (asJson) console.log(JSON.stringify(rep, null, 2));
else {
  console.log(`Rig ${file}: ${skins.length} skin(s), ${skinnedVerts} skinned verts, max ${maxInf} influences, ${anims.length} animation(s)`);
  for (const [i, r] of rigs.entries()) console.log(` skin${i}: ${r.joints} joints, depth ${r.depth}, IBM ${r.ibm ? 'yes' : 'MISSING'}, detached ${r.detached}`);
  console.log(rep.ok ? 'Rig: OK for three.js.' : `Rig:\n  - ${warn.join('\n  - ')}`);
}
