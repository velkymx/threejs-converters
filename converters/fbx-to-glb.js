#!/usr/bin/env node
// fbx-to-glb.js — .fbx (Mixamo, Sketchfab, Blender export) -> .glb. Single file. BEST-EFFORT.
// Why best-effort: FBX is proprietary; this uses three.js headless loaders. Geometry + rig + anims convert.
//   Textures do NOT (no canvas in Node) → stripped by default, reattach via texture-convert.js, or use Blender path.
// Blender path (rock solid for textured/complex rigs): File → Export → glTF 2.0 (.glb),
//   +Y Up, Apply Modifiers, UVs + Normals checked → then glb-optimize.js.
// Usage:
//   node converters/fbx-to-glb.js <in.fbx> [--out out.glb] [--units cm] [--scale 1] [--target-max 1.8]
//     [--z-up] [--keep-textures] [--no-center] [--no-ground]
// Deps: three (npm i three)
import { readFileSync, writeFileSync, statSync } from 'node:fs';
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
  console.log(`fbx-to-glb.js — FBX to three.js GLB (best-effort, geometry+rig+anims; textures stripped headless)
Usage:
  node converters/fbx-to-glb.js <in.fbx> [--out out.glb] [--units cm] [--target-max 1.8] [--z-up]
Example:
  node converters/download.js https://…/mixamo.fbx --out-dir ./assets
  node converters/fbx-to-glb.js ./assets/mixamo.fbx --units cm --target-max 1.8
  node converters/rig-report.js ./assets/mixamo.glb && node converters/glb-optimize.js ./assets/mixamo.glb
Units: Mixamo = cm. Blender default export = m (use --z-up only for Z-up authored files).`);
  process.exit(args.length ? 0 : 1);
}
function parse(argv) {
  const o = { in: null, out: null, scale: 1, units: null, targetMax: 0, targetHeight: 0,
    zUp: false, keepTex: false, center: true, ground: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--scale') o.scale = Number(argv[++i]);
    else if (a === '--units') o.units = argv[++i];
    else if (a === '--target-max') o.targetMax = Number(argv[++i]);
    else if (a === '--target-height') o.targetHeight = Number(argv[++i]);
    else if (a === '--z-up') o.zUp = true;
    else if (a === '--keep-textures') o.keepTex = true;
    else if (a === '--no-center') o.center = false;
    else if (a === '--no-ground') o.ground = false;
    else if (!a.startsWith('--') && !o.in) o.in = a;
    else { console.error(`Unknown: ${a}`); process.exit(1); }
  }
  if (!o.in) { console.error('Missing input.'); process.exit(1); }
  if (o.units && !UNITS[o.units]) { console.error(`Bad --units.`); process.exit(1); }
  if (!o.out) o.out = o.in.replace(/\.fbx$/i, '.glb');
  return o;
}
const o = parse(args);

const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

let fbx;
try {
  const data = readFileSync(o.in);
  fbx = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), resolve(o.in));
} catch (e) { console.error(`FBX parse failed: ${e.message}\nFallback: Blender → Export glTF (.glb) → glb-optimize.js`); process.exit(1); }

// --- strip texture maps (no canvas headless); keep colors/factors ---
let stripped = 0;
if (!o.keepTex) {
  fbx.traverse((n) => {
    const mats = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
    for (const m of mats) for (const k of Object.keys(m)) {
      if (m[k]?.isTexture) { m[k] = null; stripped++; }
    }
  });
  if (stripped) console.log(`Stripped ${stripped} texture map(s) (no canvas in Node). Reattach via texture-convert.js outputs.`);
} else console.log('Keep-textures: will likely fail headless (canvas). If so, rerun without flag or use Blender path.');

// --- normalize: optional Z-up fix, then scale wrapper (same convention as glb-optimize) ---
let content = fbx;
if (o.zUp) {
  const rz = new THREE.Group(); rz.name = 'ZUP_FIX'; rz.rotation.x = -Math.PI / 2; rz.add(fbx); content = rz;
  console.log('Z-up → Y-up (-90° X).');
}
content.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(content);
if (box.isEmpty()) { console.error('Empty scene (no geometry).'); process.exit(1); }
const size = new THREE.Vector3(); box.getSize(size);
const ctr = new THREE.Vector3(); box.getCenter(ctr);
let s = (o.units ? UNITS[o.units] : 1) * o.scale;
const dimsM = size.toArray().map((v) => v * s); // units first, auto-fit in meters (no double-scale)
if (o.targetMax > 0) s *= o.targetMax / Math.max(...dimsM);
else if (o.targetHeight > 0) s *= o.targetHeight / dimsM[1];
const root = new THREE.Group(); root.name = 'SCALE_ROOT';
root.scale.setScalar(s);
root.position.set(o.center ? -ctr.x * s : 0, o.ground ? -box.min.y * s : (o.center ? -ctr.y * s : 0), o.center ? -ctr.z * s : 0);
root.add(content);
const scene = new THREE.Scene(); scene.add(root);
console.log(`BBox raw: ${size.toArray().map((v) => v.toFixed(3))} → factor x${Number(s.toPrecision(6))}`);

const nMesh = [], nBone = [];
scene.traverse((n) => { if (n.isMesh || n.isSkinnedMesh) nMesh.push(n); if (n.isBone) nBone.push(n); });
console.log(`Scene: ${nMesh.length} mesh(es), ${nBone.length} bone(s), ${fbx.animations?.length || 0} animation(s).`);
if (nBone.length) console.log('Next: rig-report.js on output (check influences), then rig-normalize.js if flagged.');

const out = await new Promise((res, rej) => {
  new GLTFExporter().parse(scene, res, (e) => rej(e instanceof Error ? e : new Error(String(e))), { binary: true, animations: fbx.animations || [] });
}).catch((e) => { console.error(`Export failed: ${e.message}\nFallback: Blender → Export glTF (.glb).`); process.exit(1); });
const outBuf = Buffer.isBuffer(out) ? out : Buffer.from(out);
writeFileSync(o.out, outBuf);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size/1024).toFixed(1)} KB)`);
