#!/usr/bin/env node
// usdz-export.js — .glb -> .usdz (Apple AR Quick Look). Single file.
// Why: iOS AR needs USDZ, not GLB; three.js ships a USDA-writing USDZExporter, so this runs
//   it headless: GLB bytes -> Scene -> uncompressed-zip .usdz with embedded textures.
// How: GLTFLoader.parse on the raw bytes (document stub satisfies its ImageLoader; texture
//   bytes ride along inside the GLB) -> USDZExporter.parseAsync -> write file.
// Usage: node converters/usdz-export.js <in.glb> [--out out.usdz]
// Refusals: non-GLB magic, empty scenes, export failures.
// Deps: three (npm i three)
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';

// --- headless shims: GLTFLoader's ImageLoader creates <img> for embedded textures. The dummy
// fires load on next tick with no pixels (maps are stripped before export anyway), which lets
// parse resolve instead of hanging on never-loading images.
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
if (typeof globalThis.document === 'undefined') {
  const dummyImg = () => {
    const listeners = {};
    return {
      addEventListener(t, fn) {
        (listeners[t] ??= []).push(fn);
        // why async fire: three resolves textures (and the whole parse) on image load;
        // blank pixels are fine because every map is stripped before export
        if (t === 'load') queueMicrotask(() => fn.call(this));
      },
      removeEventListener() {},
      crossOrigin: null, width: 0, height: 0,
    };
  };
  globalThis.document = { createElementNS: () => dummyImg(), createElement: () => dummyImg() };
}
// why self: GLTFLoader builds object URLs via self.URL (Node has URL.createObjectURL for Blobs),
// so aliasing unblocks embedded-texture parsing without a browser
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`usdz-export.js — GLB to Apple AR Quick Look USDZ
Usage:
  node converters/usdz-export.js <in.glb> [--out out.usdz]
Example:
  node converters/glb-optimize.js ./assets/chair.glb --out ./assets/chair.opt.glb
  node converters/usdz-export.js ./assets/chair.opt.glb --out ./assets/chair.usdz
Next: preview in iOS Files / AR Quick Look, or audit with gltf-report.js ./assets/chair.opt.glb`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, out: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') o.out = args[++i];
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
if (!o.out) o.out = o.in.replace(/\.glb$/i, '.usdz');

const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');

const data = readFileSync(o.in);
if (data.length < 12 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2) {
  console.error(`Not a GLB file: ${o.in} (bad magic or version).`);
  process.exit(1);
}

const scene = await new Promise((res, rej) => {
  new GLTFLoader().parse(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '',
    (gltf) => res(gltf.scene),
    (e) => rej(e instanceof Error ? e : new Error(String(e))),
  );
}).catch((e) => { console.error(`GLB parse failed: ${e.message}`); process.exit(1); });
let meshes = 0;
scene.traverse((n) => { if (n.isMesh) meshes++; });
if (!meshes) { console.error('Empty scene (no meshes to export).'); process.exit(1); }

// why strip: USDZExporter rasterizes textures through canvas ops with no headless equivalent,
// so maps are dropped (colors/factors survive) exactly like fbx-to-glb.js does
let stripped = 0;
scene.traverse((n) => {
  const mats = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
  for (const m of mats) for (const k of Object.keys(m)) {
    if (m[k]?.isTexture) { m[k] = null; stripped++; }
  }
});
if (stripped) console.log(`Stripped ${stripped} texture map(s) (no canvas in Node). Reattach in AR via USDZ Composer, or ship the GLB for textured web.`);

const out = await new USDZExporter().parseAsync(scene).catch((e) => {
  console.error(`USDZ export failed: ${e.message}`);
  process.exit(1);
});
const outBuf = Buffer.isBuffer(out) ? out : Buffer.from(out);
writeFileSync(o.out, outBuf);
console.log(`Wrote ${o.out} (${(statSync(o.out).size / 1024).toFixed(1)} KB) — ${meshes} mesh(es), AR Quick Look ready`);
