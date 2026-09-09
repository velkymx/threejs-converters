#!/usr/bin/env node
// ply-to-glb.js — .ply (scan finds: photogrammetry, MeshLab, Gaussian-splat-era meshes) -> .glb. Zero deps. Pure Node.
// Handles: format ascii + binary_little_endian + binary_big_endian; x y z + nx ny nz + s t/uv + rgb(a);
//   vertex_indices list faces (n-gon fan triangulation). Other elements skipped if fixed-stride, else refused.
// Scale (reason: scans ship in mm/m/mystery): --units, --scale, --target-max; default center-XZ + ground-Y.
// Usage:
//   node converters/ply-to-glb.js <in.ply> [--out out.glb] [--color "#ff8844"] [--metal 0] [--rough .9]
//     [--units mm|cm|m|km|in|ft|yd] [--scale 0.01] [--target-max 2] [--no-center] [--no-ground]
// Note: splat PLYs (SH coefficients, no faces) are not meshes → refused with reason, not guessed.
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`ply-to-glb.js — PLY scan-find to three.js GLB
Usage:
  node converters/ply-to-glb.js <in.ply> [--out out.glb] [--color #rrggbb] [--metal 0] [--rough 0.9]
    [--units mm] [--scale 0.01] [--target-max 2] [--no-center] [--no-ground]
Example:
  node converters/ply-to-glb.js ./assets/scan.ply --out ./assets/scan.glb --units mm --target-max 2
Next: node converters/glb-optimize.js ./assets/scan.glb`);
  process.exit(args.length ? 0 : 1);
}

function parse(argv) {
  const o = { in: null, out: null, color: null, metal: 0, rough: 0.9,
    scale: 1, units: null, targetMax: 0, center: true, ground: true };
  const hex = (s) => {
    s = s.replace('#', ''); if (s.length === 3) s = [...s].map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) { console.error(`Bad --color '${s}' (want #rrggbb).`); process.exit(1); }
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
    else if (!a.startsWith('--') && !o.in) o.in = a;
    else { console.error(`Unknown: ${a}`); process.exit(1); }
  }
  if (!o.in) { console.error('Missing input.'); process.exit(1); }
  if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
  if (![o.metal, o.rough].every(Number.isFinite)) { console.error('Bad --metal/--rough (want numbers).'); process.exit(1); }
  if (o.units && !UNITS[o.units]) { console.error(`Bad --units (want ${Object.keys(UNITS).join('|')})`); process.exit(1); }
  if (!(o.scale > 0) || (o.targetMax < 0 || !Number.isFinite(o.targetMax))) { console.error('Bad --scale/--target-max.'); process.exit(1); }
  if (!o.out) o.out = o.in.replace(/\.ply$/i, '.glb');
  return o;
}

const o = parse(args);
const buf = readFileSync(o.in);

// --- header (ASCII prefix, always) ---
let hEnd = buf.indexOf('end_header');
if (hEnd < 0) { console.error('Not PLY: no end_header.'); process.exit(1); }
hEnd += 'end_header'.length;
while (hEnd < buf.length && (buf[hEnd] === 0x0a || buf[hEnd] === 0x0d)) hEnd++;
const header = buf.subarray(0, hEnd).toString('utf8');
const lines = header.split('\n').map((l) => l.trim()).filter(Boolean);
if (lines[0] !== 'ply') { console.error('Not PLY: bad magic.'); process.exit(1); }
const fmt = (lines.find((l) => l.startsWith('format ')) || '').split(/\s+/)[1];
if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(fmt)) { console.error(`Unsupported PLY format: ${fmt || '(missing)'}.`); process.exit(1); }
const le = fmt !== 'binary_big_endian';

const T = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
const elements = [];
let cur = null;
for (const l of lines.slice(1)) {
  const p = l.split(/\s+/);
  if (p[0] === 'comment' || p[0] === 'obj_info') continue;
  if (p[0] === 'element') { cur = { name: p[1], count: Number(p[2]), props: [] }; elements.push(cur); }
  else if (p[0] === 'property' && cur) {
    if (p[1] === 'list') cur.props.push({ list: true, ct: p[2], it: p[3], name: p[4] });
    else cur.props.push({ list: false, type: p[1], name: p[2] });
  }
}
const verts = elements.find((e) => e.name === 'vertex');
const faces = elements.find((e) => e.name === 'face');
if (!verts) { console.error('PLY has no vertex element.'); process.exit(1); }
if (!faces) {
  console.error('SKIP: PLY has vertices but no faces (point cloud / splat, not a mesh). Path: MeshLab → Poisson reconstruct → export PLY with faces.');
  process.exit(1);
}
const hasXYZ = ['x', 'y', 'z'].every((n) => verts.props.some((p) => p.name === n));
if (!hasXYZ) { console.error('PLY vertices lack x/y/z.'); process.exit(1); }

// --- body readers ---
function readScalar(dv, off, type) {
  const need = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2,
    int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 }[type];
  if (need === undefined || off + need > dv.byteLength) throw new Error('truncated binary body');
  switch (type) {
    case 'char': case 'int8': return [dv.getInt8(off), 1];
    case 'uchar': case 'uint8': return [dv.getUint8(off), 1];
    case 'short': case 'int16': return [dv.getInt16(off, le), 2];
    case 'ushort': case 'uint16': return [dv.getUint16(off, le), 2];
    case 'int': case 'int32': return [dv.getInt32(off, le), 4];
    case 'uint': case 'uint32': return [dv.getUint32(off, le), 4];
    case 'float': case 'float32': return [dv.getFloat32(off, le), 4];
    case 'double': case 'float64': return [dv.getFloat64(off, le), 8];
    default: throw new Error(`bad type ${type}`);
  }
}
for (const e of elements) for (const p of e.props) {
  const ts = p.list ? [p.ct, p.it] : [p.type];
  for (const t of ts) if (!T[t]) { console.error(`Unsupported PLY type: ${t}.`); process.exit(1); }
}

const P = [], N = [], UV = [], C = [];
const idx = [];
const vHasN = ['nx', 'ny', 'nz'].every((n) => verts.props.some((p) => p.name === n));
const uvProp = verts.props.find((p) => p.name === 's' || p.name === 'u' || p.name === 'texture_u')?.name;
const vvProp = uvProp === 's' ? 't' : uvProp === 'u' ? 'v' : 'texture_v';
const vHasUV = uvProp && verts.props.some((p) => p.name === vvProp);
const vHasC = ['red', 'green', 'blue'].every((n) => verts.props.some((p) => p.name === n));
const vHasA = vHasC && verts.props.some((p) => p.name === 'alpha');
const cIsByte = vHasC && ['uchar', 'uint8'].includes(verts.props.find((p) => p.name === 'red').type);

if (fmt === 'ascii') {
  const rows = buf.subarray(hEnd).toString('utf8').split('\n');
  let r = 0;
  const nextRow = () => {
    while (r < rows.length && !rows[r].trim()) r++;
    if (r >= rows.length) { console.error('PLY truncated.'); process.exit(1); }
    return rows[r++].trim().split(/\s+/).map(Number);
  };
  for (const e of elements) {
    for (let i = 0; i < e.count; i++) {
      const row = nextRow();
      let c = 0;
      const vals = {};
      for (const p of e.props) {
        if (p.list) { const n = row[c++]; vals[p.name] = row.slice(c, c + n); c += n; }
        else vals[p.name] = row[c++];
      }
      if (e === verts) {
        P.push(vals.x, vals.y, vals.z);
        if (vHasN) N.push(vals.nx, vals.ny, vals.nz);
        if (vHasUV) UV.push(vals[uvProp], vals[vvProp]);
        if (vHasC) C.push(vals.red / (cIsByte ? 255 : 1), vals.green / (cIsByte ? 255 : 1), vals.blue / (cIsByte ? 255 : 1));
      } else if (e === faces) {
        const f = vals.vertex_indices || vals.vertex_index || [];
        for (let k = 1; k < f.length - 1; k++) idx.push(f[0], f[k], f[k + 1]);
      }
    }
  }
} else {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = hEnd;
  try {
    for (const e of elements) {
      const isV = e === verts, isF = e === faces;
    if (!isV && !isF) { // skip fixed-stride elements; refuse variable ones
      if (e.props.some((p) => p.list)) { console.error(`SKIP: unsupported list element '${e.name}'. Path: strip it in MeshLab/Blender → export.`); process.exit(1); }
      const stride = e.props.reduce((s, p) => s + T[p.type], 0);
      off += stride * e.count;
      continue;
    }
    for (let i = 0; i < e.count; i++) {
      const vals = {};
      for (const p of e.props) {
        if (p.list) {
          const [n, s1] = readScalar(dv, off, p.ct); off += s1;
          vals[p.name] = [];
          for (let k = 0; k < n; k++) { const [v, s2] = readScalar(dv, off, p.it); off += s2; vals[p.name].push(v); }
        } else { const [v, s] = readScalar(dv, off, p.type); off += s; vals[p.name] = v; }
      }
      if (isV) {
        P.push(vals.x, vals.y, vals.z);
        if (vHasN) N.push(vals.nx, vals.ny, vals.nz);
        if (vHasUV) UV.push(vals[uvProp], vals[vvProp]);
        if (vHasC) C.push(vals.red / (cIsByte ? 255 : 1), vals.green / (cIsByte ? 255 : 1), vals.blue / (cIsByte ? 255 : 1));
      } else {
        const f = vals.vertex_indices || vals.vertex_index || [];
        for (let k = 1; k < f.length - 1; k++) idx.push(f[0], f[k], f[k + 1]);
      }
    }
    }
  } catch (e) { console.error(`PLY binary body truncated or corrupt (${e.message}).`); process.exit(1); }
}
if (!P.length || !idx.length) { console.error('PLY yielded no mesh (empty verts/faces).'); process.exit(1); }
if (!P.every(Number.isFinite) || !idx.every((v) => Number.isInteger(v) && v >= 0 && v < P.length / 3)) {
  console.error('PLY has corrupt vertices or out-of-range face indices.');
  process.exit(1);
}
console.log(`PLY ${fmt}: ${P.length / 3} verts, ${idx.length / 3} tris${vHasN ? '' : ' (normals computed)'}${vHasUV ? ', +UVs' : ''}${vHasC ? ', +colors' : ''}.`);

// --- SCALE (same convention as obj-to-glb) ---
let s = (o.units ? UNITS[o.units] : 1) * o.scale;
{
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3)
    for (let d = 0; d < 3; d++) { if (P[i + d] < mn[d]) mn[d] = P[i + d]; if (P[i + d] > mx[d]) mx[d] = P[i + d]; }
  const size = mx.map((v, i) => v - mn[i]);
  if (o.targetMax > 0) {
    const m = Math.max(...size);
    if (m > 0) s *= o.targetMax / (m * s);
    else console.log('Scale: degenerate bbox, skip auto-fit.');
  }
  if (!(s > 0 && Number.isFinite(s))) { console.error(`Bad computed factor ${s}.`); process.exit(1); }
  const tx = o.center ? -(mn[0] + mx[0]) / 2 * s : 0;
  const ty = o.ground ? -mn[1] * s : (o.center ? -(mn[1] + mx[1]) / 2 * s : 0);
  const tz = o.center ? -(mn[2] + mx[2]) / 2 * s : 0;
  for (let i = 0; i < P.length; i += 3) { P[i] = P[i] * s + tx; P[i + 1] = P[i + 1] * s + ty; P[i + 2] = P[i + 2] * s + tz; }
  console.log(`Scale: x${s} offset [${[tx, ty, tz].map((v) => v.toFixed(3))}] (size ${size.map((v) => (v * s).toFixed(3)).join(' x ')}m)`);
}

// smooth normals if missing
let norArr;
if (N.length === P.length) norArr = new Float32Array(N);
else {
  const acc = new Float64Array(P.length);
  for (let f = 0; f < idx.length; f += 3) {
    const [a, b, c] = [idx[f] * 3, idx[f + 1] * 3, idx[f + 2] * 3];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { acc[v] += nx; acc[v + 1] += ny; acc[v + 2] += nz; }
  }
  norArr = new Float32Array(P.length);
  for (let i = 0; i < acc.length; i += 3) {
    const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]) || 1;
    norArr[i] = acc[i] / l; norArr[i + 1] = acc[i + 1] / l; norArr[i + 2] = acc[i + 2] / l;
  }
}

const posArr = new Float32Array(P);
const uvArr = UV.length / 2 === P.length / 3 ? new Float32Array(UV) : null;
const colArr = C.length / 3 === P.length / 3 ? new Float32Array(C) : null;
const idxArr = P.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
const idxComp = idxArr instanceof Uint32Array ? 5125 : 5123;

const parts = [
  { data: Buffer.from(posArr.buffer), target: 34962 },
  { data: Buffer.from(norArr.buffer), target: 34962 },
  ...(uvArr ? [{ data: Buffer.from(uvArr.buffer), target: 34962 }] : []),
  ...(colArr ? [{ data: Buffer.from(colArr.buffer), target: 34962 }] : []),
  { data: Buffer.from(idxArr.buffer), target: 34963 },
];
let byteOffset = 0;
const bufferViews = [], accessors = [];
const attrs = { POSITION: 0, NORMAL: 1 };
let ai = 0;
const pushVB = (i, count, type, comp) => {
  bufferViews.push({ buffer: 0, byteOffset, byteLength: parts[i].data.length, target: parts[i].target });
  accessors.push({ bufferView: bufferViews.length - 1, byteOffset: 0, componentType: comp, count, type });
  byteOffset += parts[i].data.length; return ai++;
};
const bounds = (arr, stride) => {
  const min = Array(stride).fill(Infinity), max = Array(stride).fill(-Infinity);
  for (let i = 0; i < arr.length; i++) { const k = i % stride; if (arr[i] < min[k]) min[k] = arr[i]; if (arr[i] > max[k]) max[k] = arr[i]; }
  return { min, max };
};
const posIdx = pushVB(0, posArr.length / 3, 'VEC3', 5126);
Object.assign(accessors[posIdx], bounds(posArr, 3));
pushVB(1, norArr.length / 3, 'VEC3', 5126);
let pi = 2;
if (uvArr) { attrs.TEXCOORD_0 = ai; pushVB(pi++, uvArr.length / 2, 'VEC2', 5126); }
if (colArr) { attrs.COLOR_0 = ai; pushVB(pi++, colArr.length / 3, 'VEC3', 5126); }
const idxAcc = pushVB(pi, idxArr.length, 'SCALAR', idxComp);

const baseColor = o.color || (colArr ? [1, 1, 1, 1] : [0.75, 0.75, 0.78, 1]);
if (colArr && !o.color) console.log('Vertex colors kept as COLOR_0 (base white).');
const json = {
  asset: { version: '2.0', generator: 'threejs-converters ply-to-glb' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: basename(o.in) }],
  meshes: [{ name: basename(o.in), primitives: [{ attributes: attrs, indices: idxAcc, material: 0 }] }],
  materials: [{ name: 'mat', pbrMetallicRoughness: { baseColorFactor: baseColor, metallicFactor: o.metal, roughnessFactor: o.rough } }],
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
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size / 1024).toFixed(1)} KB) — ${(idxArr.length / 3).toFixed(0)} tris, ${(posArr.length / 3).toFixed(0)} verts`);
