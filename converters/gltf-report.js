#!/usr/bin/env node
// gltf-report.js — budget + SCALE check for three.js. Zero deps. Pure Node.
// Usage: node converters/gltf-report.js <model.glb|gltf> [--json]
// Reports: verts, tris, meshes, nodes, draws, materials, textures, size + WORLD bbox (node transforms applied) → verdict.
import { readFileSync, statSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`gltf-report.js — asset budget + scale check
Usage:
  node converters/gltf-report.js <model.glb|model.gltf> [--json]
Budgets (reason: mobile GPU limits):
  tris <100k great, <300k ok mobile, >1M desktop-only. nodes/draws <50 great.
Scale (reason: three.js 1 unit = 1 meter):
  world bbox accounts full node chain (translation/rotation/scale).
  Flags suspect scale: >1000m (mm mixup?) or <1cm (tiny?) or center far off-origin (float jitter?).`);
  process.exit(args.length ? 0 : 1);
}
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('Missing input file.'); process.exit(1); }
if (!existsSync(file)) { console.error(`No such file: ${file}`); process.exit(1); }
const asJson = args.includes('--json');
let bytes;
try { bytes = readFileSync(file); }
catch { console.error(`Cannot read ${file}.`); process.exit(1); }
let json;
try {
  if (file.endsWith('.glb')) {
    if (bytes.length < 20) throw new Error('too small');
    const jsonLen = bytes.readUInt32LE(12);
    json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
  } else json = JSON.parse(bytes.toString('utf8'));
} catch { console.error(`Cannot parse ${file} (not valid glTF/GLB).`); process.exit(1); }

// --- minimal column-major mat4: node local = matrix ?? T*R*S ---
function quatMat([x, y, z, w]) {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, 0, 0, 0, 1];
}
function compose(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], s = n.scale || [1, 1, 1];
  const r = quatMat(n.rotation || [0, 0, 0, 1]);
  // M = T * R * S: scale columns of R, inject translation
  return [
    r[0]*s[0], r[1]*s[0], r[2]*s[0], 0,
    r[4]*s[1], r[5]*s[1], r[6]*s[1], 0,
    r[8]*s[2], r[9]*s[2], r[10]*s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = v;
  }
  return o;
}
const xfPt = (m, x, y, z) => [
  m[0]*x + m[4]*y + m[8]*z + m[12],
  m[1]*x + m[5]*y + m[9]*z + m[13],
  m[2]*x + m[6]*y + m[10]*z + m[14],
];

const acc = json.accessors || [], meshes = json.meshes || [], nodes = json.nodes || [],
  mats = json.materials || [], texs = json.textures || [], imgs = json.images || [];
let tris = 0, verts = 0, draws = 0, nonTri = 0, missingMinMax = 0, quantized = 0;
const wmin = [Infinity, Infinity, Infinity], wmax = [-Infinity, -Infinity, -Infinity];
let hasGeo = false;

function primStats(p) {
  draws++;
  const idxAcc = p.indices != null ? acc[p.indices] : null;
  const posAcc = acc[p.attributes?.POSITION];
  const vCount = posAcc?.count ?? 0;
  verts += vCount;
  const mode = p.mode ?? 4; // default TRIANGLES
  if (mode === 4) {
    const n = idxAcc ? (idxAcc.count ?? 0) : vCount;
    tris += Math.floor(n / 3);
  } else if (mode !== 0 && mode !== 1) nonTri += 1; // POINTS/LINES need no tri budget; fans/strips flagged
}

function walk(ni, parent) {
  const n = nodes[ni];
  if (!n) return;
  const w = mul(parent, compose(n));
  const meshList = n.mesh != null ? [meshes[n.mesh]] : [];
  // (node.extensions EXT_mesh_gpu_instancing ignored for bbox: base mesh bounds still representative)
  for (const m of meshList) {
    if (!m) continue;
    for (const p of m.primitives || []) {
      primStats(p);
      const pa = acc[p.attributes?.POSITION];
      if (!pa || !pa.min || !pa.max) { missingMinMax++; continue; }
      if (pa.normalized) { quantized++; continue; } // quantized ints: raw min/max not meters, skip (no false alarm)
      hasGeo = true;
      for (let i = 0; i < 8; i++) {
        const [X, Y, Z] = xfPt(w, i & 1 ? pa.max[0] : pa.min[0], i & 2 ? pa.max[1] : pa.min[1], i & 4 ? pa.max[2] : pa.min[2]);
        if (X < wmin[0]) wmin[0] = X; if (Y < wmin[1]) wmin[1] = Y; if (Z < wmin[2]) wmin[2] = Z;
        if (X > wmax[0]) wmax[0] = X; if (Y > wmax[1]) wmax[1] = Y; if (Z > wmax[2]) wmax[2] = Z;
      }
    }
  }
  for (const c of n.children || []) walk(c, w);
}
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const scenes = json.scenes?.length ? json.scenes : [{ nodes: nodes.map((_, i) => i) }];
for (const s of scenes) for (const r of s.nodes || []) walk(r, IDENT);
// dangling meshes (no scene ref): count stats, local bbox
if (!hasGeo) for (const m of meshes) for (const p of m?.primitives || []) {
  primStats(p);
  const pa = acc[p.attributes?.POSITION];
  if (pa?.min && pa?.max && !pa.normalized) {
    hasGeo = true;
    for (let d = 0; d < 3; d++) { if (pa.min[d] < wmin[d]) wmin[d] = pa.min[d]; if (pa.max[d] > wmax[d]) wmax[d] = pa.max[d]; }
  }
}

const size = hasGeo ? wmax.map((v, i) => v - wmin[i]) : null;
const maxDim = size ? Math.max(...size) : 0;
const center = size ? wmin.map((v, i) => (v + wmax[i]) / 2) : null;
const scaleWarn = [];
if (size) {
  if (maxDim > 1000) scaleWarn.push(`HUGE (${maxDim.toFixed(0)}m): suspect millimeters → fix: glb-optimize.js --units mm --target-max 2`);
  else if (maxDim > 100) scaleWarn.push(`LARGE (${maxDim.toFixed(1)}m): suspect centimeters → fix: --units cm --target-max 2`);
  else if (maxDim < 0.01) scaleWarn.push(`TINY (${(maxDim * 1000).toFixed(1)}mm): suspect micro units → fix: --scale 100 or --target-max 2`);
  else if (maxDim < 0.1) scaleWarn.push(`SMALL (${(maxDim * 100).toFixed(1)}cm): check intended size → fix: --target-max 2`);
  const offXZ = Math.hypot(center[0], center[2]);
  if (offXZ > Math.max(2 * maxDim, 1)) scaleWarn.push(`OFF-ORIGIN (center xz ${offXZ.toFixed(1)}m away): float jitter ingame → fix: glb-optimize.js defaults recenter (drop --no-center)`);
  if (wmin[1] > maxDim) scaleWarn.push(`FLOATING (min.y ${wmin[1].toFixed(1)}m): hovers ingame → fix: defaults ground it (drop --no-ground)`);
  else if (wmax[1] < 0) scaleWarn.push(`UNDERGROUND (max.y ${wmax[1].toFixed(1)}m): buried ingame → fix: defaults ground it`);
}
if (missingMinMax) scaleWarn.push(`${missingMinMax} primitive(s) lack POSITION min/max: bbox partial, re-export source.`);
if (quantized && !size) scaleWarn.push(`QUANTIZED positions (${quantized} prim): bbox unreadable statically — run gltf-report on the pre-quantize file, or verify scale in viewer.`);
if (nonTri) scaleWarn.push(`${nonTri} non-triangle primitive(s) (fan/strip): three.js draws them, budget counts triangles only.`);

const sizeKB = statSync(file).size / 1024;
const verdict =
  tris < 100_000 && draws < 50 ? 'MOBILE-READY — good for games.' :
  tris < 300_000 && draws < 100 ? 'MOBILE-OK — optimize textures next (texture-convert.js).' :
  tris < 1_000_000 ? 'DESKTOP-OK — run glb-optimize.js, consider LODs.' :
  'HEAVY — must optimize / split before ingame use.';
const scaleOk = scaleWarn.length === 0;
const report = {
  file, sizeKB: +sizeKB.toFixed(1), verts, tris,
  meshes: meshes.length, nodes: nodes.length, drawCalls: draws,
  materials: mats.length, textures: texs.length, images: imgs.length,
  worldBBox: size ? { min: wmin.map((v) => +v.toFixed(4)), max: wmax.map((v) => +v.toFixed(4)), size: size.map((v) => +v.toFixed(4)) } : null,
  scale: size ? { maxDim: +maxDim.toFixed(4), ok: scaleOk, warnings: scaleWarn } : null,
  verdict,
};
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Report ${file} (${report.sizeKB} KB)`);
  console.log(` verts ${verts} | tris ${tris} | meshes ${report.meshes} | nodes ${report.nodes} | draws ${draws}`);
  console.log(` materials ${report.materials} | textures ${report.textures} | images ${report.images}`);
  if (size) console.log(` world ${size.map((v) => v.toFixed(3)).join(' x ')}m (max ${maxDim.toFixed(3)}m) center [${center.map((v) => v.toFixed(2))}] min.y ${wmin[1].toFixed(3)}`);
  else console.log(' world bbox: NO GEOMETRY or missing POSITION min/max');
  console.log(scaleOk ? 'Scale: OK (sane meter range, near origin).' : `Scale:\n  - ${scaleWarn.join('\n  - ')}`);
  console.log(`Verdict: ${verdict}`);
  if (draws >= 50) console.log('Fix draws: merge meshes / use glb-optimize instance+palette.');
  if (tris >= 300_000) console.log('Fix tris: glb-optimize weld+quantize, or decimate upstream.');
  if (report.images > 8 || sizeKB > 5120) console.log('Fix weight: texture-convert --size 1024/2048 --format webp.');
}
