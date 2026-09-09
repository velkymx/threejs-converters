#!/usr/bin/env node
// stl-to-glb.js — .stl (3D-print finds: Thingiverse, Printables) -> .glb. Zero deps. Pure Node.
// Handles: binary + ASCII detect (size check wins; 'solid' headers can be binary), facet soup → indexed flat mesh.
// Scale (reason: STL is unitless; slicer world = millimeters; three.js 1 unit = 1 meter):
//   default --units mm. Override --units/--scale/--target-max. Default center-XZ + ground-Y.
// Usage:
//   node converters/stl-to-glb.js <in.stl> [--out out.glb] [--units mm] [--scale 1] [--target-max 2]
//     [--smooth] [--color #rrggbb] [--metal 0.1] [--rough 0.8] [--no-center] [--no-ground]
// Notes: dedupe key = position+normal (flat shading kept, coplanar merges). --smooth averages normals (organic prints).
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`stl-to-glb.js — STL print-find to three.js GLB
Usage:
  node converters/stl-to-glb.js <in.stl> [--out out.glb] [--units mm] [--target-max 2] [--smooth]
Example:
  node converters/stl-to-glb.js ./assets/bracket.stl --out ./assets/bracket.glb --target-max 0.3
Next: node converters/glb-optimize.js ./assets/bracket.glb --target-max 0.3`);
  process.exit(args.length ? 0 : 1);
}

function parse(argv) {
  const o = { in: null, out: null, color: [0.75, 0.75, 0.78, 1], metal: 0.1, rough: 0.8,
    scale: 1, units: 'mm', targetMax: 0, center: true, ground: true, smooth: false };
  const hex = (s) => {
    s = s.replace('#', ''); if (s.length === 3) s = [...s].map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255).concat(1);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--color') o.color = hex(argv[++i]);
    else if (a === '--metal') o.metal = Number(argv[++i]);
    else if (a === '--rough') o.rough = Number(argv[++i]);
    else if (a === '--scale') o.scale = Number(argv[++i]);
    else if (a === '--units') o.units = argv[++i];
    else if (a === '--target-max') o.targetMax = Number(argv[++i]);
    else if (a === '--no-center') o.center = false;
    else if (a === '--no-ground') o.ground = false;
    else if (a === '--smooth') o.smooth = true;
    else if (!a.startsWith('--') && !o.in) o.in = a;
    else { console.error(`Unknown: ${a}`); process.exit(1); }
  }
  if (!o.in) { console.error('Missing input.'); process.exit(1); }
  if (!UNITS[o.units]) { console.error(`Bad --units (want ${Object.keys(UNITS).join('|')})`); process.exit(1); }
  if (!(o.scale > 0) || o.targetMax < 0 || !Number.isFinite(o.targetMax)) { console.error('Bad --scale/--target-max.'); process.exit(1); }
  if (!o.out) o.out = o.in.replace(/\.stl$/i, '.glb');
  return o;
}

const o = parse(args);
const buf = readFileSync(o.in);
let tris = []; // flat [x,y,z]*3 per tri

// --- detect: binary size check wins (headers may start with 'solid') ---
const nBin = buf.length >= 84 ? buf.readUInt32LE(80) : -1;
if (nBin >= 0 && buf.length === 84 + nBin * 50) {
  console.log(`STL binary: ${nBin} facets.`);
  for (let i = 0; i < nBin; i++) {
    const off = 84 + i * 50;
    tris.push([[buf.readFloatLE(off + 12), buf.readFloatLE(off + 16), buf.readFloatLE(off + 20)],
      [buf.readFloatLE(off + 24), buf.readFloatLE(off + 28), buf.readFloatLE(off + 32)],
      [buf.readFloatLE(off + 36), buf.readFloatLE(off + 40), buf.readFloatLE(off + 44)]]);
  }
} else {
  const txt = buf.toString('utf8');
  if (!/facet\s+normal/i.test(txt)) { console.error('Not STL: neither binary-sized nor ASCII facets.'); process.exit(1); }
  const verts = [...txt.matchAll(/vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  if (verts.length % 3 !== 0 || verts.some((v) => v.some((x) => !Number.isFinite(x)))) { console.error('Broken ASCII STL vertex soup.'); process.exit(1); }
  for (let i = 0; i < verts.length; i += 3) tris.push([verts[i], verts[i + 1], verts[i + 2]]);
  console.log(`STL ASCII: ${tris.length} facets.`);
}
if (!tris.length) { console.error('Empty STL.'); process.exit(1); }

// --- geometric face normals (deterministic; file normals often sloppy) ---
const faceN = (a, b, c) => {
  const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
  let nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
  const l = Math.hypot(nx, ny, nz);
  if (!(l > 0)) return null; // degenerate tri, drop
  return [nx / l, ny / l, nz / l];
};
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const pos = [], nor = [], idx = [];
const vMap = new Map();
const keyOf = (p, n) => o.smooth ? `${r4(p[0])},${r4(p[1])},${r4(p[2])}` : `${r4(p[0])},${r4(p[1])},${r4(p[2])}|${n.map(r4)}`;
let dropped = 0;
const acc = o.smooth ? new Map() : null; // posKey -> {sum, list of vert ids}
for (const [a, b, c] of tris) {
  const n = faceN(a, b, c);
  if (!n) { dropped++; continue; }
  for (const p of [a, b, c]) {
    const k = keyOf(p, n);
    if (vMap.has(k)) { idx.push(vMap.get(k)); continue; }
    const id = pos.length / 3;
    vMap.set(k, id); idx.push(id);
    pos.push(p[0], p[1], p[2]); nor.push(...n);
    if (acc) {
      const pk = `${r4(p[0])},${r4(p[1])},${r4(p[2])}`;
      if (!acc.has(pk)) acc.set(pk, []);
      acc.get(pk).push(id);
    }
  }
}
if (dropped) console.log(`Dropped ${dropped} degenerate facets (zero area).`);
if (o.smooth) { // average face normals per position → smooth shade
  for (const ids of acc.values()) {
    let sx = 0, sy = 0, sz = 0;
    for (const id of ids) { sx += nor[id*3]; sy += nor[id*3+1]; sz += nor[id*3+2]; }
    const l = Math.hypot(sx, sy, sz) || 1;
    for (const id of ids) { nor[id*3] = sx/l; nor[id*3+1] = sy/l; nor[id*3+2] = sz/l; }
  }
  console.log('Smooth normals averaged (organic mode).');
}

// --- SCALE (same convention as obj-to-glb) ---
{
  let s = UNITS[o.units] * o.scale;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let d = 0; d < 3; d++) { if (pos[i+d] < mn[d]) mn[d] = pos[i+d]; if (pos[i+d] > mx[d]) mx[d] = pos[i+d]; }
  const size = mx.map((v, i) => v - mn[i]);
  if (o.targetMax > 0) {
    const m = Math.max(...size);
    if (m > 0) s *= o.targetMax / (m * s); // auto-fit in meters, units kept (no double-scale)
    else console.log('Scale: degenerate bbox, skip auto-fit.');
  }
  if (!(s > 0 && Number.isFinite(s))) { console.error(`Bad factor ${s}.`); process.exit(1); }
  const tx = o.center ? -(mn[0]+mx[0])/2*s : 0;
  const ty = o.ground ? -mn[1]*s : (o.center ? -(mn[1]+mx[1])/2*s : 0);
  const tz = o.center ? -(mn[2]+mx[2])/2*s : 0;
  for (let i = 0; i < pos.length; i += 3) { pos[i] = pos[i]*s+tx; pos[i+1] = pos[i+1]*s+ty; pos[i+2] = pos[i+2]*s+tz; }
  console.log(`Scale: x${Number(s.toPrecision(6))} (--units ${o.units}) offset [${[tx,ty,tz].map((v)=>v.toFixed(3))}] size ${size.map((v)=>(v*s).toFixed(3)).join(' x ')}m`);
}

// --- pack GLB (single mesh, POSITION+NORMAL+indices) ---
const posArr = new Float32Array(pos), norArr = new Float32Array(nor);
const idxArr = pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
const idxComp = idxArr instanceof Uint32Array ? 5125 : 5123;
const parts = [
  { data: Buffer.from(posArr.buffer), target: 34962 },
  { data: Buffer.from(norArr.buffer), target: 34962 },
  { data: Buffer.from(idxArr.buffer), target: 34963 },
];
let byteOffset = 0;
const bufferViews = [], accessors = [];
const pushVB = (i, count, type, comp) => {
  bufferViews.push({ buffer: 0, byteOffset, byteLength: parts[i].data.length, target: parts[i].target });
  accessors.push({ bufferView: bufferViews.length - 1, byteOffset: 0, componentType: comp, count, type });
  byteOffset += parts[i].data.length;
  return accessors.length - 1;
};
const bnd = (arr) => {
  const mn = [Infinity,Infinity,Infinity], mx = [-Infinity,-Infinity,-Infinity];
  for (let i = 0; i < arr.length; i++) { const k = i % 3; if (arr[i] < mn[k]) mn[k] = arr[i]; if (arr[i] > mx[k]) mx[k] = arr[i]; }
  return { min: [...mn], max: [...mx] };
};
const posIdx = pushVB(0, posArr.length / 3, 'VEC3', 5126);
Object.assign(accessors[posIdx], bnd(posArr));
const norIdx = pushVB(1, norArr.length / 3, 'VEC3', 5126);
const idxAcc = pushVB(2, idxArr.length, 'SCALAR', idxComp);
const json = {
  asset: { version: '2.0', generator: 'threejs-converters stl-to-glb' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: basename(o.in) }],
  meshes: [{ name: basename(o.in), primitives: [{ attributes: { POSITION: posIdx, NORMAL: norIdx }, indices: idxAcc, material: 0 }] }],
  materials: [{ name: 'mat', pbrMetallicRoughness: { baseColorFactor: o.color, metallicFactor: o.metal, roughnessFactor: o.rough } }],
  buffers: [{ byteLength: byteOffset }], bufferViews, accessors,
};
const pad = (n) => (4 - (n % 4)) % 4;
let jsonBuf = Buffer.from(JSON.stringify(json));
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad(jsonBuf.length), 0x20)]);
let binBuf = Buffer.concat(parts.map((p) => p.data));
binBuf = Buffer.concat([binBuf, Buffer.alloc(pad(binBuf.length), 0)]);
const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
let off = 12;
out.writeUInt32LE(jsonBuf.length, off); out.writeUInt32LE(0x4E4F534A, off + 4); jsonBuf.copy(out, off + 8); off += 8 + jsonBuf.length;
out.writeUInt32LE(binBuf.length, off); out.writeUInt32LE(0x004E4942, off + 4); binBuf.copy(out, off + 8);
writeFileSync(o.out, out);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size/1024).toFixed(1)} KB) — ${(idxArr.length/3).toFixed(0)} tris, ${(posArr.length/3).toFixed(0)} verts (flat, no UVs)`);
