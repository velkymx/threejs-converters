#!/usr/bin/env node
// vox-to-glb.js — .vox (MagicaVoxel art, voxel mods) -> .glb. Single file.
// Why: voxel editors export only .vox; games need meshes. three.js ships a greedy-meshing VOXLoader,
//   so this runs it headless: voxels -> vertex-colored mesh -> GLB.
// How: VOXLoader.parse (returns scene graph or nothing) -> SCALE_ROOT wrapper (shared meter
//   convention) -> GLTFExporter binary. Vertex colors survive as COLOR_0.
// Usage: node converters/vox-to-glb.js <in.vox> [--out out.glb] [--units m] [--scale 1]
//     [--target-max 1] [--target-height 1] [--no-center] [--no-ground]
// Note: voxels are unitless — a 32-wide model at 1 unit/voxel is 32 m. --target-max is the
//   usual fix (e.g. --target-max 1 for a 1 m prop).
// Deps: three (npm i three)
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// --- headless shims: GLTFExporter needs FileReader (buffer + image paths), never DOM for geometry ---
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    constructor() { this.result = null; this.onloadend = null; this.onerror = null; }
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(
        (b) => { this.result = b; this.onloadend?.(); },
        (e) => this.onerror?.(e),
      );
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then(
        (b) => { this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.(); },
        (e) => this.onerror?.(e),
      );
    }
  };
}

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };
const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`vox-to-glb.js — MagicaVoxel VOX to three.js GLB (greedy-meshed, vertex colors kept)
Usage:
  node converters/vox-to-glb.js <in.vox> [--out out.glb] [--units m] [--target-max 1]
Example:
  node converters/vox-to-glb.js ./assets/sword.vox --out ./assets/sword.glb --target-max 1
  node converters/gltf-report.js ./assets/sword.glb`);
  process.exit(args.length ? 0 : 1);
}
function parse(argv) {
  const o = { in: null, out: null, scale: 1, units: null, targetMax: 0, targetHeight: 0, center: true, ground: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--scale') o.scale = Number(argv[++i]);
    else if (a === '--units') o.units = argv[++i];
    else if (a === '--target-max') o.targetMax = Number(argv[++i]);
    else if (a === '--target-height') o.targetHeight = Number(argv[++i]);
    else if (a === '--no-center') o.center = false;
    else if (a === '--no-ground') o.ground = false;
    else if (!a.startsWith('--') && !o.in) o.in = a;
    else { console.error(`Unknown: ${a}`); process.exit(1); }
  }
  if (!o.in) { console.error('Missing input.'); process.exit(1); }
  if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
  if (o.units && !UNITS[o.units]) { console.error(`Bad --units.`); process.exit(1); }
  if (!(o.scale > 0) || ![o.targetMax, o.targetHeight].every((v) => Number.isFinite(v) && v >= 0)) {
    console.error('Bad --scale/--target-max/--target-height.'); process.exit(1);
  }
  if (!o.out) o.out = o.in.replace(/\.vox$/i, '.glb');
  return o;
}
const o = parse(args);

const THREE = await import('three');
const { VOXLoader, buildMesh } = await import('three/examples/jsm/loaders/VOXLoader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

const data = readFileSync(o.in);
// why pre-check magic+version: the loader logs and returns undefined on bad input, which would
// surface later as a confusing empty-scene error — refuse here with the cause instead
if (data.length < 8 || data.subarray(0, 4).toString('ascii') !== 'VOX ') {
  console.error('Not VOX (bad magic). MagicaVoxel files start with "VOX ".');
  process.exit(1);
}
const voxVer = data.readInt32LE(4);
if (voxVer !== 150 && voxVer !== 200) { console.error(`Unsupported VOX version ${voxVer} (need 150/200).`); process.exit(1); }

let result;
try {
  result = new VOXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
} catch (e) { console.error(`VOX parse failed: ${e.message}`); process.exit(1); }
if (!result || (!result.scene && !(result.chunks || []).some((c) => c.data?.length))) {
  console.error('Empty scene (no voxel models).');
  process.exit(1);
}
// why fallback: node-less files (old exporters) parse to chunks but no scene graph —
// mesh the models directly instead of refusing a valid file
let content = result.scene;
if (!content || content.children.length === 0) {
  content = new THREE.Group();
  content.name = 'vox_models';
  for (const chunk of result.chunks || []) {
    if (chunk.data?.length) content.add(buildMesh(chunk));
  }
  console.log('Note: no scene graph — meshed models directly.');
}

// --- normalize: scale wrapper (same convention as fbx-to-glb) ---
content.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(content);
if (box.isEmpty()) { console.error('Empty scene (no geometry).'); process.exit(1); }
const size = new THREE.Vector3(); box.getSize(size);
const ctr = new THREE.Vector3(); box.getCenter(ctr);
let s = (o.units ? UNITS[o.units] : 1) * o.scale;
const dimsM = size.toArray().map((v) => v * s);
if (o.targetMax > 0) s *= o.targetMax / Math.max(...dimsM);
else if (o.targetHeight > 0) s *= o.targetHeight / dimsM[1];
const root = new THREE.Group(); root.name = 'SCALE_ROOT';
root.scale.setScalar(s);
root.position.set(o.center ? -ctr.x * s : 0, o.ground ? -box.min.y * s : (o.center ? -ctr.y * s : 0), o.center ? -ctr.z * s : 0);
root.add(content);
const scene = new THREE.Scene(); scene.add(root);
console.log(`BBox raw: ${size.toArray().map((v) => v.toFixed(3))} voxels → factor x${Number(s.toPrecision(6))}`);

const nMesh = [];
scene.traverse((n) => { if (n.isMesh) nMesh.push(n); });
console.log(`Scene: ${nMesh.length} mesh(es), vertex colors kept.`);

const out = await new Promise((res, rej) => {
  new GLTFExporter().parse(scene, res, (e) => rej(e instanceof Error ? e : new Error(String(e))), { binary: true, animations: [] });
}).catch((e) => { console.error(`Export failed: ${e.message}`); process.exit(1); });
const outBuf = Buffer.isBuffer(out) ? out : Buffer.from(out);
writeFileSync(o.out, outBuf);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size/1024).toFixed(1)} KB)`);
