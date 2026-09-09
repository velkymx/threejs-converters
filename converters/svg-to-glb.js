#!/usr/bin/env node
// svg-to-glb.js — .svg vector art -> extruded .glb. Single file.
// Why: logos and icons ship as SVG; games need meshes. three.js parses SVG paths and extrudes
//   them with pure math, so this runs headless: paths -> shapes -> ExtrudeGeometry per fill
//   color -> y-flip to three.js space -> GLB.
// How: SVGLoader.parse (needs no DOM for path data) -> toShapes per path -> one extruded mesh
//   per distinct fill -> scale(1,-1,1) with winding fix (SVG y runs down) -> SCALE_ROOT wrapper.
// Usage: node converters/svg-to-glb.js <in.svg> [--out out.glb] [--depth 10]
//     [--units px] [--scale 1] [--target-max 1] [--no-center] [--no-ground]
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

const UNITS = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, px: 1 };

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`svg-to-glb.js — SVG vector art to extruded three.js GLB
Usage:
  node converters/svg-to-glb.js <in.svg> [--out out.glb] [--depth 10]
    [--units px] [--scale 1] [--target-max 1] [--no-center] [--no-ground]
  SVG units are pixels; --depth is in the same units before --units/--scale apply.
Example:
  node converters/svg-to-glb.js ./assets/logo.svg --out ./assets/logo.glb --target-max 1
Next: node converters/glb-optimize.js ./assets/logo.glb`);
  process.exit(args.length ? 0 : 1);
}

function parse(argv) {
  const o = { in: null, out: null, depth: 10, scale: 1, units: null, targetMax: 0, targetHeight: 0, center: true, ground: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--depth') o.depth = Number(argv[++i]);
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
  if (o.units && !UNITS[o.units]) { console.error(`Bad --units (want ${Object.keys(UNITS).join('|')}).`); process.exit(1); }
  if (!(o.scale > 0) || ![o.targetMax, o.targetHeight].every((v) => Number.isFinite(v) && v >= 0)) {
    console.error('Bad --scale/--target-max/--target-height.'); process.exit(1);
  }
  if (!Number.isFinite(o.depth) || o.depth <= 0) { console.error('Bad --depth (want positive).'); process.exit(1); }
  if (!o.out) o.out = o.in.replace(/\.svg$/i, '.glb');
  return o;
}
const o = parse(args);

// SVGLoader needs DOMParser: same light tag-tree shim as dae-to-glb.js (one-file convention),
// plus querySelectorAll for comma-separated tag selectors (linearGradient, radialGradient, stop)
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
        querySelectorAll(sel) { return collect(this, String(sel).split(',').map((s) => s.trim()), []); },
        getElementsByTagName(t) { return collect(this, [t], []); } };
    };
    const root = mkEl('#document', '');
    root.nodeType = 9;
    Object.defineProperty(root, 'children', { get() { return this.childNodes.filter((c) => c.nodeType === 1); } });
    root.getElementsByTagName = function (t) { return collect(this, [t], []); };
    root.querySelectorAll = function (sel) { return collect(this, String(sel).split(',').map((s) => s.trim()), []); };
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
      // why here: SVGLoader starts at xml.documentElement; the tag tree has none natively
      doc.documentElement = doc.childNodes.find((c) => c.nodeType === 1) || null;
      return doc;
    }
  };
}

const THREE = await import('three');
const { SVGLoader } = await import('three/examples/jsm/loaders/SVGLoader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

const text = readFileSync(o.in, 'utf8');
if (!/<svg[\s>]/.test(text)) { console.error('Not SVG (no <svg> root).'); process.exit(1); }
let paths;
try {
  paths = new SVGLoader().parse(text).paths;
} catch (e) { console.error(`SVG parse failed: ${e.message}`); process.exit(1); }
// why group by fill: one material per color keeps draws low; unfilled paths are strokes
// with no area and would extrude to nothing, so they are skipped with a count
const byFill = new Map();
let skipped = 0;
for (const path of paths) {
  const fill = path.userData?.style?.fill;
  if (!fill || fill === 'none') { skipped++; continue; }
  const shapes = path.toShapes(true);
  if (!shapes.length) { skipped++; continue; }
  if (!byFill.has(fill)) byFill.set(fill, []);
  byFill.get(fill).push(...shapes);
}
if (!byFill.size) { console.error('SVG has no filled shapes (strokes only?).'); process.exit(1); }
if (skipped) console.log(`Skipped ${skipped} unfilled/stroked path(s) (no area to extrude).`);

const content = new THREE.Group();
for (const [fill, shapes] of byFill) {
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: o.depth, bevelEnabled: false, curveSegments: 12 });
  // why flip here: SVG y runs down, three.js y runs up — mirror, then repair the winding
  // the mirror inverts so front faces stay front, then recompute normals for the new pose
  geo.scale(1, -1, 1);
  const idx = geo.index;
  if (idx) { const a = idx.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } }
  else {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      for (const name of ['position', 'normal', 'uv']) {
        const attr = geo.attributes[name];
        if (!attr) continue;
        const itemSize = attr.itemSize;
        for (let c = 0; c < itemSize; c++) {
          const tmp = attr.array[(i + 1) * itemSize + c];
          attr.array[(i + 1) * itemSize + c] = attr.array[(i + 2) * itemSize + c];
          attr.array[(i + 2) * itemSize + c] = tmp;
        }
      }
    }
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(fill), metalness: 0, roughness: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `fill_${fill.replace('#', '')}`;
  content.add(mesh);
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
console.log(`Shapes: ${[...byFill.values()].reduce((n, s) => n + s.length, 0)} shape(s) in ${byFill.size} fill(s), depth ${o.depth}.`);
console.log(`BBox raw: ${size.toArray().map((v) => v.toFixed(3))} → factor x${Number(s.toPrecision(6))}`);

const out = await new Promise((res, rej) => {
  new GLTFExporter().parse(scene, res, (e) => rej(e instanceof Error ? e : new Error(String(e))), { binary: true, animations: [] });
}).catch((e) => { console.error(`Export failed: ${e.message}`); process.exit(1); });
const outBuf = Buffer.isBuffer(out) ? out : Buffer.from(out);
writeFileSync(o.out, outBuf);
console.log(`Wrote ${resolve(o.out)} (${(statSync(o.out).size/1024).toFixed(1)} KB)`);
