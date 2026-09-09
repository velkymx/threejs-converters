#!/usr/bin/env node
// md3-to-glb.js — .md3 (Quake 3 / OpenArena / Tremulous mods) -> .glb. Zero deps. Pure Node.
// Why: Q3-era mods are still exchanged as md3+skin+shader trios; no three.js loader exists, but the
//   format is documented and small enough to parse exactly.
// How: bounds-checked DataView walk of header -> frames -> tags -> surfaces; frame N verts unscale
//   by the spec /64 factor with lat/long normal decode; one GLB primitive per surface; sibling
//   basename.skin (mesh,texture lines) names materials after their texture stem.
// Usage: node converters/md3-to-glb.js <in.md3> [--out out.glb] [--frame 0]
//     [--units mm|cm|m|km|in|ft|yd] [--scale 1] [--target-max 2] [--color #rrggbb] [--metal 0] [--rough 0.9]
//     [--no-center] [--no-ground]
// Refusals: bad IDP3 magic, wrong version, truncated structs, out-of-range --frame, missing verts.
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`md3-to-glb.js — Quake 3 MD3 to three.js GLB (frame N as static mesh)
Usage:
  node converters/md3-to-glb.js <in.md3> [--out out.glb] [--frame 0]
    [--units mm|cm|m|km|in|ft|yd] [--scale 1] [--target-max 2] [--color #rrggbb] [--metal 0] [--rough 0.9]
    [--no-center] [--no-ground]
  MD3 stores Quake units; --units converts them, so --units in treats them as inches.
Example:
  node converters/pk3-to-dir.js ./assets/pak0.pk3 --out-dir ./assets/pak0
  node converters/md3-to-glb.js ./assets/pak0/models/arena.md3 --out ./assets/arena.glb --target-max 4
Next: node converters/glb-optimize.js ./assets/arena.glb`);
  process.exit(args.length ? 0 : 1);
}

function parse(argv) {
  const o = { in: null, out: null, frame: 0, color: [0.75, 0.75, 0.78, 1], metal: 0, rough: 0.9,
    scale: 1, units: 'm', targetMax: 0, center: true, ground: true };
  const hex = (s) => {
    s = s.replace('#', ''); if (s.length === 3) s = [...s].map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) { console.error(`Bad --color '${s}' (want #rrggbb).`); process.exit(1); }
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255).concat(1);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--frame') o.frame = Number(argv[++i]);
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
  if (o.units && !UNITS[o.units]) { console.error(`Bad --units (want ${Object.keys(UNITS).join('|')})`); process.exit(1); }
  if (!(o.scale > 0) || o.targetMax < 0 || !Number.isFinite(o.targetMax)) { console.error('Bad --scale/--target-max.'); process.exit(1); }
  if (!Number.isInteger(o.frame) || o.frame < 0) { console.error('Bad --frame (want frame index >= 0).'); process.exit(1); }
  if (![o.metal, o.rough].every(Number.isFinite)) { console.error('Bad --metal/--rough (want numbers).'); process.exit(1); }
  if (!o.out) o.out = o.in.replace(/\.md3$/i, '.glb');
  return o;
}

const o = parse(args);
const buf = readFileSync(o.in);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
// why hard bounds: mod files are untrusted; every struct read checks first so truncation
// exits with a named error instead of a RangeError traceback
const need = (off, n, what) => { if (off + n > buf.length) { console.error(`MD3 truncated in ${what}.`); process.exit(1); } };
const str = (off, n) => buf.subarray(off, off + n).toString('ascii').replace(/\0.*$/s, '');
if (buf.length < 108 || buf.subarray(0, 4).toString('ascii') !== 'IDP3') {
  console.error('Not MD3 (bad IDP3 magic). Quake 2 models use md2-to-glb.js instead.');
  process.exit(1);
}
const ver = dv.getInt32(4, true);
if (ver !== 15) { console.error(`Unsupported MD3 version ${ver} (need 15).`); process.exit(1); }
const numFrames = dv.getInt32(76, true), numTags = dv.getInt32(80, true);
const numSurfaces = dv.getInt32(84, true);
let surfOff = dv.getInt32(100, true);
if (o.frame >= numFrames) { console.error(`Bad --frame ${o.frame} (file has ${numFrames} frame(s)).`); process.exit(1); }
console.log(`MD3: ${numFrames} frame(s), ${numTags} tag(s), ${numSurfaces} surface(s) → frame ${o.frame}.`);

// sibling .skin: 'meshname,texture/path' lines name materials after their texture stem
const skinMap = new Map();
const skinPath = o.in.replace(/\.md3$/i, '.skin');
if (existsSync(skinPath)) {
  for (const line of readFileSync(skinPath, 'utf8').split('\n')) {
    const m = line.trim().match(/^([^,]+),(.+)$/);
    if (m) skinMap.set(m[1].trim().toLowerCase(), basename(m[2].trim()).replace(/\.[a-z0-9]+$/i, ''));
  }
  if (skinMap.size) console.log(`Skin: ${skinMap.size} material name(s) from ${basename(skinPath)}.`);
}

const prims = []; // {pos, nor, uv, idx, mat}
for (let s = 0; s < numSurfaces; s++) {
  need(surfOff, 108, 'surface header');
  if (buf.subarray(surfOff, surfOff + 4).toString('ascii') !== 'IDP3') { console.error(`Surface ${s} bad magic.`); process.exit(1); }
  const sName = str(surfOff + 8, 64) || `surface${s}`;
  const sFrames = dv.getInt32(surfOff + 72, true), nShaders = dv.getInt32(surfOff + 76, true);
  const nVerts = dv.getInt32(surfOff + 80, true), nTris = dv.getInt32(surfOff + 84, true);
  const ofsTris = dv.getInt32(surfOff + 88, true), ofsShaders = dv.getInt32(surfOff + 92, true);
  const ofsST = dv.getInt32(surfOff + 96, true), ofsXYZ = dv.getInt32(surfOff + 100, true);
  const ofsEnd = dv.getInt32(surfOff + 104, true);
  need(surfOff + ofsEnd, 0, `surface ${s}`);
  // why skip whole frames except N: MD3 repeats every vert per frame; reading only the wanted
  // frame keeps memory flat on animation-heavy files
  const triBase = surfOff + ofsTris, stBase = surfOff + ofsST;
  const xyzBase = surfOff + ofsXYZ + o.frame * nVerts * 8;
  need(triBase, nTris * 12, `surface ${s} triangles`);
  need(stBase, nVerts * 8, `surface ${s} texcoords`);
  need(xyzBase, nVerts * 8, `surface ${s} frame ${o.frame} verts`);
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i < nVerts; i++) {
    pos.push(dv.getInt16(xyzBase + i * 8, true) / 64, dv.getInt16(xyzBase + i * 8 + 2, true) / 64, dv.getInt16(xyzBase + i * 8 + 4, true) / 64);
    // why this trig: MD3 packs normals as 8-bit latitude/longitude, not xyz — decode to unit vector
    const packed = dv.getUint16(xyzBase + i * 8 + 6, true);
    const lat = ((packed >> 8) & 255) * (2 * Math.PI / 255), lng = (packed & 255) * (2 * Math.PI / 255);
    nor.push(Math.cos(lat) * Math.sin(lng), Math.sin(lat) * Math.sin(lng), Math.cos(lng));
    uv.push(dv.getFloat32(stBase + i * 8, true), dv.getFloat32(stBase + i * 8 + 4, true));
  }
  for (let i = 0; i < nTris; i++) idx.push(dv.getInt32(triBase + i * 12, true), dv.getInt32(triBase + i * 12 + 4, true), dv.getInt32(triBase + i * 12 + 8, true));
  if (idx.some((v) => v < 0 || v >= nVerts)) { console.error(`Surface ${s} has out-of-range triangle indices.`); process.exit(1); }
  const mat = skinMap.get(sName.toLowerCase()) || sName;
  prims.push({ pos, nor, uv, idx, mat });
  console.log(` surface '${sName}': ${nVerts} verts, ${nTris} tris → material '${mat}'${sFrames !== numFrames ? ` (warn: ${sFrames} frames, expected ${numFrames})` : ''}.`);
  surfOff += ofsEnd;
}
if (!prims.length || !prims.some((p) => p.idx.length)) { console.error('MD3 yielded no mesh (empty surfaces).'); process.exit(1); }

// --- SCALE (shared convention) ---
let sc = (o.units ? UNITS[o.units] : 1) * o.scale;
{
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) for (let i = 0; i < p.pos.length; i += 3)
    for (let d = 0; d < 3; d++) { if (p.pos[i + d] < mn[d]) mn[d] = p.pos[i + d]; if (p.pos[i + d] > mx[d]) mx[d] = p.pos[i + d]; }
  const size = mx.map((v, i) => v - mn[i]);
  if (o.targetMax > 0) {
    const m = Math.max(...size);
    if (m > 0) sc *= o.targetMax / (m * sc);
    else console.log('Scale: degenerate bbox, skip auto-fit.');
  }
  const tx = o.center ? -(mn[0] + mx[0]) / 2 * sc : 0;
  const ty = o.ground ? -mn[1] * sc : (o.center ? -(mn[1] + mx[1]) / 2 * sc : 0);
  const tz = o.center ? -(mn[2] + mx[2]) / 2 * sc : 0;
  for (const p of prims) for (let i = 0; i < p.pos.length; i += 3) { p.pos[i] = p.pos[i] * sc + tx; p.pos[i + 1] = p.pos[i + 1] * sc + ty; p.pos[i + 2] = p.pos[i + 2] * sc + tz; }
  console.log(`Scale: x${sc} offset [${[tx, ty, tz].map((v) => v.toFixed(3))}] (size ${size.map((v) => (v * sc).toFixed(3)).join(' x ')}m)`);
}

// --- pack GLB: one primitive per surface, one material each ---
const parts = [], bufferViews = [], accessors = [];
let byteOffset = 0, ai = 0;
const pushVB = (data, count, type, comp, target) => {
  bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length, target });
  accessors.push({ bufferView: bufferViews.length - 1, byteOffset: 0, componentType: comp, count, type });
  parts.push(data);
  byteOffset += data.length; return ai++;
};
const bounds = (arr, stride) => {
  const min = Array(stride).fill(Infinity), max = Array(stride).fill(-Infinity);
  for (let i = 0; i < arr.length; i++) { const k = i % stride; if (arr[i] < min[k]) min[k] = arr[i]; if (arr[i] > max[k]) max[k] = arr[i]; }
  return { min, max };
};
const seen = new Map(), materials = [];
const matIdx = (name) => {
  if (!seen.has(name)) {
    seen.set(name, materials.length);
    materials.push({ name, pbrMetallicRoughness: { baseColorFactor: o.color, metallicFactor: o.metal, roughnessFactor: o.rough } });
  }
  return seen.get(name);
};
const gprims = prims.map((p) => {
  const posArr = new Float32Array(p.pos), norArr = new Float32Array(p.nor), uvArr = new Float32Array(p.uv);
  const idxArr = p.pos.length / 3 > 65535 ? new Uint32Array(p.idx) : new Uint16Array(p.idx);
  const pi = pushVB(Buffer.from(posArr.buffer), posArr.length / 3, 'VEC3', 5126, 34962);
  Object.assign(accessors[pi], bounds(posArr, 3));
  const ni = pushVB(Buffer.from(norArr.buffer), norArr.length / 3, 'VEC3', 5126, 34962);
  const ti = pushVB(Buffer.from(uvArr.buffer), uvArr.length / 2, 'VEC2', 5126, 34962);
  const ii = pushVB(Buffer.from(idxArr.buffer), idxArr.length, 'SCALAR', idxArr instanceof Uint32Array ? 5125 : 5123, 34963);
  return { attributes: { POSITION: pi, NORMAL: ni, TEXCOORD_0: ti }, indices: ii, material: matIdx(p.mat) };
});
const json = {
  asset: { version: '2.0', generator: 'threejs-converters md3-to-glb' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: basename(o.in) }],
  meshes: [{ name: basename(o.in), primitives: gprims }],
  materials,
  buffers: [{ byteLength: byteOffset }], bufferViews, accessors,
};
const pad = (n) => (4 - (n % 4)) % 4;
let jsonBuf = Buffer.from(JSON.stringify(json));
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad(jsonBuf.length), 0x20)]);
let binBuf = Buffer.concat(parts.map((p) => p));
binBuf = Buffer.concat([binBuf, Buffer.alloc(pad(binBuf.length), 0)]);
const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
let off = 12;
out.writeUInt32LE(jsonBuf.length, off); out.writeUInt32LE(0x4E4F534A, off + 4); jsonBuf.copy(out, off + 8); off += 8 + jsonBuf.length;
out.writeUInt32LE(binBuf.length, off); out.writeUInt32LE(0x004E4942, off + 4); binBuf.copy(out, off + 8);
writeFileSync(o.out, out);
const tris = prims.reduce((s, p) => s + p.idx.length / 3, 0);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size / 1024).toFixed(1)} KB) — ${tris} tris, ${prims.length} surface(s)`);
