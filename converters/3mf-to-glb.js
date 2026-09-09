#!/usr/bin/env node
// 3mf-to-glb.js — .3mf (3D manufacturing: Cura, PrusaSlicer, print repos) -> .glb. Single file.
// Why: slicers and print sites trade 3MF, games need GLB; three.js ships a 3MFLoader that unzips
//   the OPC package and walks the model XML, so this runs it headless.
// How: 3MFLoader.parse (bundled fflate unzip + tag-tree DOM shim) -> SCALE_ROOT wrapper ->
//   GLTFExporter binary. 3MF spec units default to millimeters, so --units does too.
// Usage: node converters/3mf-to-glb.js <in.3mf> [--out out.glb] [--units mm] [--scale 1]
//     [--target-max 0.3] [--no-center] [--no-ground]
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
// 3MFLoader needs DOMParser: same tag-tree shim as dae-to-glb.js (one-file convention), plus
// indexed attributes (modelNode.attributes[i].name) and tag-name querySelector, which its
// namespace scan uses
if (typeof globalThis.DOMParser === 'undefined') {
  const parseTag = (src) => {
    const stack = [];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([A-Za-z0-9_.:-]+)\s*>|<([A-Za-z0-9_.:-]+)((?:\s+[A-Za-z0-9_.:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
    let m;
    const collect = (el, tags, r) => {
      for (const c of el.childNodes) {
        if (c.nodeType !== 1) continue;
        if (tags.includes(c.tagName) || tags.includes(c.localName)) r.push(c);
        collect(c, tags, r);
      }
      return r;
    };
    // why descendant matching: 3MFLoader queries 'vertices vertex' and 'triangles triangle';
    // each part must match an ancestor chain in order, ending at the element itself
    const collectCompound = (el, parts, r) => {
      const last = parts[parts.length - 1];
      const walk = (n, ancestors) => {
        for (const c of n.childNodes) {
          if (c.nodeType !== 1) continue;
          if (c.tagName === last || c.localName === last) {
            let ok = true, ai = ancestors.length - 1;
            for (let pi = parts.length - 2; pi >= 0 && ok; pi--) {
              while (ai >= 0 && ancestors[ai] !== parts[pi]) ai--;
              if (ai < 0) ok = false; else ai--;
            }
            // why ancestor tags, not nodes: tag names are all the selector carries
            if (ok) r.push(c);
          }
          walk(c, [...ancestors, c.tagName, c.localName]);
        }
      };
      walk(el, []);
      return r;
    };
    const select = (el, sel) => {
      const out = [];
      for (const group of String(sel).split(',')) {
        const parts = group.trim().split(/\s+/).filter(Boolean);
        if (!parts.length) continue;
        if (parts.length === 1) collect(el, parts, out);
        else collectCompound(el, parts, out);
      }
      return out;
    };
    const indexAttrs = (el) => {
      // why indexed: 3MFLoader reads modelNode.attributes.length + [i].name for xmlns scan;
      // plain objects have neither, so mirror entries as indexed {name, value} pairs
      const keys = Object.keys(el.attributes);
      Object.defineProperty(el.attributes, 'length', { value: keys.length });
      keys.forEach((k, i) => { el.attributes[i] = { name: k, value: el.attributes[k] }; });
    };
    const mkEl = (tag, attrSrc) => {
      const attrs = {};
      const ar = /(?:^|\s)([A-Za-z0-9_.:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
      let am;
      while ((am = ar.exec(attrSrc || ''))) {
        let v = am[2] ?? '';
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        attrs[am[1]] = v;
      }
      const el = { nodeType: 1, nodeName: tag, tagName: tag, localName: tag.includes(':') ? tag.split(':').pop() : tag,
        attributes: attrs, childNodes: [], parentNode: null, textContent: '',
        getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
        hasAttribute(k) { return k in this.attributes; },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        // why namespace-blind: 3MFLoader only uses NS variants for the optional beam-lattice
        // extension; matching the local name is exact for every namespaced-or-not document
        getAttributeNS(ns, name) {
          for (const k of Object.keys(this.attributes)) {
            if (k === name || k.split(':').pop() === name) return this.attributes[k];
          }
          return null;
        },
        getElementsByTagNameNS(ns, local) { return collect(this, [local], []); },
        get children() { return this.childNodes.filter((c) => c.nodeType === 1); },
        querySelector(sel) {
          const a = /^\[([A-Za-z0-9_.:-]+)="([^"]*)"\]$/.exec(sel || '');
          if (a) {
            const walk = (n) => {
              for (const c of n.childNodes) {
                if (c.nodeType !== 1) continue;
                if (c.getAttribute(a[1]) === a[2]) return c;
                const hit = walk(c);
                if (hit) return hit;
              }
              return null;
            };
            return walk(this);
          }
          const hit = select(this, sel);
          return hit[0] || null;
        },
        querySelectorAll(sel) { return select(this, sel); },
        getElementsByTagName(t) { return collect(this, [t], []); } };
      indexAttrs(el);
      return el;
    };
    const root = mkEl('#document', '');
    root.nodeType = 9;
    Object.defineProperty(root, 'children', { get() { return this.childNodes.filter((c) => c.nodeType === 1); } });
    root.getElementsByTagName = function (t) { return collect(this, [t], []); };
    root.querySelector = function (sel) { const h = select(this, sel); return h[0] || null; };
    root.querySelectorAll = function (sel) { return select(this, sel); };
    stack.push(root);
    let last = 0;
    while ((m = re.exec(src))) {
      const text = src.slice(last, m.index);
      if (text && text.trim()) {
        const top = stack[stack.length - 1];
        top.childNodes.push({ nodeType: 3, nodeName: '#text', textContent: text, parentNode: top });
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
    parseFromString(src) {
      const doc = parseTag(String(src));
      doc.documentElement = doc.childNodes.find((c) => c.nodeType === 1) || null;
      return doc;
    }
  };
}
// document stub: three's ImageLoader creates <img> while composing materials. Loads never
// complete headless, which is fine because texture maps are stripped right after parse.
if (typeof globalThis.document === 'undefined') {
  const dummyImg = () => ({ addEventListener() {}, removeEventListener() {}, crossOrigin: null });
  globalThis.document = { createElementNS: () => dummyImg(), createElement: () => dummyImg() };
}

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 };
const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`3mf-to-glb.js — 3D manufacturing 3MF to three.js GLB (best-effort geometry; textures stripped headless)
Usage:
  node converters/3mf-to-glb.js <in.3mf> [--out out.glb] [--units mm] [--target-max 0.3]
Example:
  node converters/3mf-to-glb.js ./assets/bracket.3mf --out ./assets/bracket.glb --target-max 0.3
  node converters/gltf-report.js ./assets/bracket.glb
Units: the 3MF spec defaults to millimeters, so --units does too.`);
  process.exit(args.length ? 0 : 1);
}
function parse(argv) {
  const o = { in: null, out: null, scale: 1, units: 'mm', targetMax: 0, targetHeight: 0, center: true, ground: true };
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
  if (!o.out) o.out = o.in.replace(/\.3mf$/i, '.glb');
  return o;
}
const o = parse(args);

const THREE = await import('three');
const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

const data = readFileSync(o.in);
if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) {
  console.error('Not 3MF (bad ZIP magic). For plain zips use pk3-to-dir.js.');
  process.exit(1);
}

let group;
try {
  group = new ThreeMFLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
} catch (e) { console.error(`3MF parse failed: ${e.message}\nFallback: slicer/CAD → Export 3MF cleanly, or STL → stl-to-glb.js`); process.exit(1); }
let content = group;
if (!content || content.children.length === 0) { console.error('Empty scene (no geometry).'); process.exit(1); }

// --- strip texture maps (no canvas headless); keep colors/factors ---
let stripped = 0;
content.traverse((n) => {
  const mats = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
  for (const m of mats) for (const k of Object.keys(m)) {
    if (m[k]?.isTexture) { m[k] = null; stripped++; }
  }
});
if (stripped) console.log(`Stripped ${stripped} texture map(s) (no canvas in Node). Reattach via texture-convert.js outputs.`);

// --- normalize: scale wrapper (same convention as stl-to-glb, millimeter world) ---
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

const nMesh = [];
scene.traverse((n) => { if (n.isMesh) nMesh.push(n); });
console.log(`Scene: ${nMesh.length} mesh(es).`);

const out = await new Promise((res, rej) => {
  new GLTFExporter().parse(scene, res, (e) => rej(e instanceof Error ? e : new Error(String(e))), { binary: true, animations: [] });
}).catch((e) => { console.error(`Export failed: ${e.message}`); process.exit(1); });
const outBuf = Buffer.isBuffer(out) ? out : Buffer.from(out);
writeFileSync(o.out, outBuf);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size/1024).toFixed(1)} KB)`);
