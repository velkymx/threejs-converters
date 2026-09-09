#!/usr/bin/env node
// dae-to-glb.js — .dae (COLLADA: old Sketchfab / warehouse finds) -> .glb. Single file. BEST-EFFORT.
// Why best-effort: COLLADA is sprawling; this uses three.js headless ColladaLoader. Geometry + rig + anims convert.
//   Textures do NOT (no canvas in Node) → stripped by default, reattach via texture-convert.js, or use Blender path.
// Blender path (rock solid for textured/complex rigs): File → Import .dae → Export glTF 2.0 (.glb),
//   +Y Up, Apply Modifiers, UVs + Normals checked → then glb-optimize.js.
// Usage:
//   node converters/dae-to-glb.js <in.dae> [--out out.glb] [--units cm] [--scale 1] [--target-max 1.8]
//     [--target-height 1.7] [--z-up] [--keep-textures] [--no-center] [--no-ground]
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
// ColladaLoader needs DOMParser: light tag-tree shim (elements, attrs, text, query by tag).
// Covers geometry/material/scene subset the loader walks; exotic extensions fall back to Blender path.
if (typeof globalThis.DOMParser === 'undefined') {
  const parseTag = (src, out) => {
    const stack = [];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([A-Za-z0-9_.:-]+)\s*>|<([A-Za-z0-9_.:-]+)((?:\s+[A-Za-z0-9_.:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
    let m;
    const mkEl = (tag, attrSrc) => {
      const attrs = {};
      const ar = /(?:^|\s)([A-Za-z0-9_.:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
      let am;
      while ((am = ar.exec(attrSrc || ''))) {
        let v = am[2] ?? '';
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        attrs[am[1]] = v;
      }
      return { nodeType: 1, nodeName: tag, tagName: tag, localName: tag.includes(':') ? tag.split(':').pop() : tag,
        attributes: attrs, childNodes: [], parentNode: null, textContent: '',
        getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
        hasAttribute(k) { return k in this.attributes; },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        get children() { return this.childNodes.filter((c) => c.nodeType === 1); },
        querySelector(sel) {
          const m = /^\[([A-Za-z0-9_.:-]+)="([^"]*)"\]$/.exec(sel || '');
          if (!m) return null;
          const walk = (n) => {
            for (const c of n.childNodes) {
              if (c.nodeType !== 1) continue;
              if (c.getAttribute(m[1]) === m[2]) return c;
              const hit = walk(c);
              if (hit) return hit;
            }
            return null;
          };
          return walk(this);
        },
        getElementsByTagName(t) {
          const r = [];
          const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; if (c.tagName === t || c.localName === t) r.push(c); walk(c); } };
          walk(this); return r;
        } };
    };
    const root = mkEl('#document', '');
    root.nodeType = 9;
    Object.defineProperty(root, 'children', { get() { return this.childNodes.filter((c) => c.nodeType === 1); } });
    root.getElementsByTagName = function (t) {
      const r = [];
      const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; if (c.tagName === t || c.localName === t) r.push(c); walk(c); } };
      walk(this); return r;
    };
    stack.push(root);
    let last = 0;
    while ((m = re.exec(src))) {
      const text = src.slice(last, m.index);
      if (text && text.trim()) {
        const top = stack[stack.length - 1];
        const tn = { nodeType: 3, nodeName: '#text', textContent: text, parentNode: top };
        top.childNodes.push(tn);
        top.textContent += (top.textContent ? ' ' : '') + text.trim();
      }
      last = re.lastIndex;
      if (m[1]) stack.pop();
      else if (m[2]) {
        const el = mkEl(m[2], m[3]);
        el.parentNode = stack[stack.length - 1];
        stack[stack.length - 1].childNodes.push(el);
        if (!m[4]) stack.push(el);
      }
    }
    return root;
  };
  globalThis.DOMParser = class {
    parseFromString(src) { return parseTag(String(src), null); }
  };
}

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };
const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`dae-to-glb.js — COLLADA to three.js GLB (best-effort, geometry+rig+anims; textures stripped headless)
Usage:
  node converters/dae-to-glb.js <in.dae> [--out out.glb] [--units cm] [--target-max 1.8] [--z-up]
Example:
  node converters/download.js https://…/model.dae --out-dir ./assets
  node converters/dae-to-glb.js ./assets/model.dae --out ./assets/model.glb --target-max 2
  node converters/gltf-report.js ./assets/model.glb
Units: Sketchfab-era DAEs are usually m or cm — check gltf-report output, then set --units.`);
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
  if (!o.out) o.out = o.in.replace(/\.dae$/i, '.glb');
  return o;
}
const o = parse(args);

const THREE = await import('three');
const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

let dae;
try {
  const text = readFileSync(o.in, 'utf8');
  dae = new ColladaLoader().parse(text, resolve(o.in));
} catch (e) { console.error(`DAE parse failed: ${e.message}\nFallback: Blender → Import .dae → Export glTF (.glb) → glb-optimize.js`); process.exit(1); }
let content = dae.scene;
if (!content || content.children.length === 0) { console.error('Empty scene (no geometry).\nFallback: Blender → Import .dae → Export glTF (.glb).'); process.exit(1); }

// --- strip texture maps (no canvas headless); keep colors/factors ---
let stripped = 0;
if (!o.keepTex) {
  content.traverse((n) => {
    const mats = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
    for (const m of mats) for (const k of Object.keys(m)) {
      if (m[k]?.isTexture) { m[k] = null; stripped++; }
    }
  });
  if (stripped) console.log(`Stripped ${stripped} texture map(s) (no canvas in Node). Reattach via texture-convert.js outputs.`);
} else console.log('Keep-textures: will likely fail headless (canvas). If so, rerun without flag or use Blender path.');

// --- normalize: optional Z-up fix, then scale wrapper (same convention as fbx-to-glb) ---
if (o.zUp) {
  const rz = new THREE.Group(); rz.name = 'ZUP_FIX'; rz.rotation.x = -Math.PI / 2; rz.add(content); content = rz;
  console.log('Z-up → Y-up (-90° X).');
}
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
console.log(`BBox raw: ${size.toArray().map((v) => v.toFixed(3))} → factor x${Number(s.toPrecision(6))}`);

const nMesh = [], nBone = [];
scene.traverse((n) => { if (n.isMesh || n.isSkinnedMesh) nMesh.push(n); if (n.isBone) nBone.push(n); });
console.log(`Scene: ${nMesh.length} mesh(es), ${nBone.length} bone(s), ${dae.animations?.length || 0} animation(s).`);
if (nBone.length) console.log('Next: rig-report.js on output (check influences), then rig-normalize.js if flagged.');

const out = await new Promise((res, rej) => {
  new GLTFExporter().parse(scene, res, (e) => rej(e instanceof Error ? e : new Error(String(e))), { binary: true, animations: dae.animations || [] });
}).catch((e) => { console.error(`Export failed: ${e.message}\nFallback: Blender → Import .dae → Export glTF (.glb).`); process.exit(1); });
const outBuf = Buffer.isBuffer(out) ? out : Buffer.from(out);
writeFileSync(o.out, outBuf);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size/1024).toFixed(1)} KB)`);
