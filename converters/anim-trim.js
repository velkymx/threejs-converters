#!/usr/bin/env node
// anim-trim.js — list / cut / thin animations in a .glb. Single file.
// Why: Mixamo/store finds ship bloated clips at 30-60fps; games need one looped clip at ~30fps.
// What:
//   (no flags)           list clips: name, duration, keys, paths — pick --clip from this
//   --clip NAME          keep only animations whose name matches (substring, case-insensitive)
//   --trim S:E           keep time window [S,E] seconds, shift to start at 0
//   --fps N              thin LINEAR keyframes to ~N fps (median-dt estimate; STEP untouched,
//                        CUBICSPLINE untouched — thinning either corrupts tangents or pops)
// Usage: node converters/anim-trim.js <in.glb> [--clip run] [--trim 0:2.5] [--fps 30] [--out out.glb]
// Deps: @gltf-transform/core (npm i)
import { writeFileSync, statSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`anim-trim.js — cut animation bloat for three.js
Usage:
  node converters/anim-trim.js <in.glb> [--clip NAME] [--trim S:E] [--fps N] [--out out.glb]
  No flags = list clips only (no file written).
Examples:
  node converters/anim-trim.js ./assets/mixamo.glb
  node converters/anim-trim.js ./assets/mixamo.glb --clip "samba" --trim 0:2 --fps 30 --out ./assets/samba-loop.glb
three.js: play with AnimationMixer; trimmed clips start at t=0 so set loop = THREE.LoopRepeat directly.`);
  process.exit(args.length ? 0 : 1);
}

const o = { in: null, out: null, clip: null, trim: null, fps: 0 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') o.out = args[++i];
  else if (a === '--clip') o.clip = args[++i];
  else if (a === '--trim') {
    const m = (args[++i] || '').split(':').map(Number);
    if (m.length !== 2 || !m.every(Number.isFinite) || m[0] < 0 || m[1] <= m[0]) { console.error('Bad --trim (want S:E, e.g. 0:2.5).'); process.exit(1); }
    o.trim = m;
  }
  else if (a === '--fps') { o.fps = Number(args[++i]); if (!Number.isFinite(o.fps) || o.fps <= 0) { console.error('Bad --fps.'); process.exit(1); } }
  else if (!a.startsWith('--') && !o.in) o.in = a;
  else { console.error(`Unknown: ${a}`); process.exit(1); }
}
if (!o.in) { console.error('Missing input.'); process.exit(1); }
if (!existsSync(o.in)) { console.error(`No such file: ${o.in}`); process.exit(1); }
if (o.in.toLowerCase().endsWith('.glb')) {
  const b = readFileSync(o.in);
  if (b.length < 12 || b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2) {
    console.error(`Not a GLB file: ${o.in} (bad magic or version).`);
    process.exit(1);
  }
}

const io = new NodeIO();
let doc;
try { doc = await io.read(o.in); }
catch { console.error(`Cannot read ${o.in} (corrupt or unsupported glTF).`); process.exit(1); }
const root = doc.getRoot();
const anims = root.listAnimations();
if (!anims.length) { console.log('No animations found.'); process.exit(0); }

const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const summarize = (anim) => {
  let t0 = Infinity, t1 = -Infinity, keys = 0;
  const paths = new Set();
  for (const s of anim.listSamplers()) {
    const inp = s.getInput();
    if (!inp) continue;
    const t = inp.getArray();
    keys += inp.getCount();
    if (t.length) { if (t[0] < t0) t0 = t[0]; if (t[t.length - 1] > t1) t1 = t[t.length - 1]; }
  }
  for (const c of anim.listChannels()) paths.add(c.getTargetPath());
  return { dur: t1 >= t0 ? t1 - t0 : 0, keys, paths: [...paths].join(',') };
};
console.log(`Clips in ${o.in}:`);
for (const a of anims) {
  const s = summarize(a);
  console.log(` - "${a.getName() || '(unnamed)'}" dur ${s.dur.toFixed(2)}s keys ${s.keys} paths ${s.paths}`);
}
if (!o.clip && !o.trim && !o.fps) process.exit(0); // list-only

// --- CLIP: drop non-matching animations ---
if (o.clip) {
  const q = o.clip.toLowerCase();
  let kept = 0;
  for (const a of [...anims]) {
    if ((a.getName() || '').toLowerCase().includes(q)) { kept++; continue; }
    a.dispose();
  }
  if (!kept) { console.error(`No clip matches "${o.clip}".`); process.exit(1); }
  console.log(`Clip: kept ${kept} animation(s) matching "${o.clip}"`);
}

// --- TRIM + FPS per sampler ---
let trimmedKeys = 0, thinnedKeys = 0, keptKeys = 0;
for (const a of root.listAnimations()) {
  for (const s of a.listSamplers()) {
    const inp = s.getInput(), out = s.getOutput();
    if (!inp || !out) continue;
    const T = [...inp.getArray()], O = [...out.getArray()];
    const nComp = NC[out.getType()] || 3;
    const isSpline = s.getInterpolation() === 'CUBICSPLINE';
    const stride = isSpline ? nComp * 3 : nComp;
    let idx = T.map((_, i) => i);
    if (o.trim) {
      const [S, E] = o.trim;
      idx = idx.filter((i) => T[i] >= S - 1e-9 && T[i] <= E + 1e-9);
      if (!idx.length) continue; // sampler outside window: leave, prune later if orphaned
      trimmedKeys += T.length - idx.length;
    }
    if (o.fps && !isSpline && s.getInterpolation() !== 'STEP' && idx.length > 8) {
      const dts = [];
      for (let k = 1; k < idx.length; k++) dts.push(T[idx[k]] - T[idx[k - 1]]);
      dts.sort((x, y) => x - y);
      const med = dts[Math.floor(dts.length / 2)] || 0;
      const srcFps = med > 0 ? 1 / med : 0;
      if (srcFps > o.fps * 1.15) {
        const step = Math.max(1, Math.round(srcFps / o.fps));
        const ends = new Set([idx[0], idx[idx.length - 1]]);
        const before = idx.length;
        idx = idx.filter((_, k) => k % step === 0 || ends.has(idx[k]));
        thinnedKeys += before - idx.length;
      }
    }
    const base = o.trim ? o.trim[0] : 0;
    keptKeys += idx.length;
    const nT = new Float32Array(idx.length);
    const nO = new Float32Array(idx.length * stride);
    idx.forEach((si, k) => {
      nT[k] = T[si] - base;
      for (let c = 0; c < stride; c++) nO[k * stride + c] = O[si * stride + c];
    });
    inp.setArray(nT);
    out.setArray(nO);
  }
}
// drop channels whose sampler lost all keys
for (const a of root.listAnimations()) {
  for (const c of [...a.listChannels()]) {
    const s = c.getSampler();
    if (!s || !s.getInput() || s.getInput().getCount() === 0) c.dispose();
  }
  for (const s of [...a.listSamplers()]) if (!s.getInput() || s.getInput().getCount() === 0) s.dispose();
}
if (!root.listAnimations().length) { console.error('Trim removed everything — widen --trim window.'); process.exit(1); }
if (o.trim && keptKeys === 0) { console.error(`--trim ${o.trim[0]}:${o.trim[1]} matches no keys — widen window.`); process.exit(1); }
console.log(`Trim: cut ${trimmedKeys} key(s)${o.fps ? `, thinned ${thinnedKeys} key(s)` : ''}`);

if (!o.out) o.out = o.in.replace(/\.glb$/i, '.anim.glb');
try { mkdirSync(dirname(o.out) || '.', { recursive: true }); }
catch { console.error(`Cannot write to ${o.out} (bad path).`); process.exit(1); }
writeFileSync(o.out, Buffer.from(await io.writeBinary(doc)));
console.log(`Wrote ${o.out} (${(statSync(o.out).size / 1024).toFixed(1)} KB)`);
for (const a of root.listAnimations()) {
  const s = summarize(a);
  console.log(` - "${a.getName() || '(unnamed)'}" now ${s.dur.toFixed(2)}s keys ${s.keys}`);
}
