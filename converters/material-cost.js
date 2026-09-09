#!/usr/bin/env node
// material-cost.js — audit PBR feature cost for mobile GPUs. Zero deps. Pure Node.
// Why: MeshPhysical features (transmission, clearcoat, sheen, iridescence) silently multiply
//   shader cost; a model that is cheap on desktop can tank a phone. This names every cost
//   driver per material so you can strip what the art does not need.
// How: raw GLB JSON read (magic gate, no dependencies) -> per-material scan of factors,
//   extensions, alpha mode, and texture count -> CHEAP / MODERATE / EXPENSIVE with reasons.
//   Costs are relative ranks for triage, not measured milliseconds.
// Usage: node converters/material-cost.js <in.glb> [--json]
// Cuts while keeping looks usually live in material-normalize.js; cost cuts (dropping clearcoat
// or transmission) change the look and stay a human call, so this tool only advises (exit 0).
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`material-cost.js — PBR feature cost audit for mobile GPUs
Usage:
  node converters/material-cost.js <model.glb> [--json]
Ranks each material CHEAP (plain PBR), MODERATE (extra shading lobes), or EXPENSIVE
(transmission/volume passes). Advisory only — exit 0 either way.`);
  process.exit(args.length ? 0 : 1);
}
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('Missing input file.'); process.exit(1); }
if (!existsSync(file)) { console.error(`No such file: ${file}`); process.exit(1); }
const asJson = args.includes('--json');

let bytes;
try { bytes = readFileSync(file); }
catch { console.error(`Cannot read ${file}.`); process.exit(1); }
if (file.toLowerCase().endsWith('.glb')) {
  if (bytes.length < 12 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
    console.error(`Not a GLB file: ${file} (bad magic or version).`);
    process.exit(1);
  }
}
let json;
try {
  json = file.toLowerCase().endsWith('.glb')
    ? JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'))
    : JSON.parse(bytes.toString('utf8'));
} catch { console.error(`Cannot parse ${file} (not valid glTF/GLB).`); process.exit(1); }

const ext = (m, name) => (m.extensions || {})[name] || null;
const num = (v, dflt) => (Number.isFinite(v) ? v : dflt);
const results = [];
for (const [i, m] of (json.materials || []).entries()) {
  const name = m.name || `material${i}`;
  const reasons = [];
  let score = 0; // 0 cheap, 1 moderate, 2 expensive; max wins
  const pbr = m.pbrMetallicRoughness || {};
  const bump = (why, s) => { reasons.push(why); if (s > score) score = s; };

  const tr = ext(m, 'KHR_materials_transmission');
  if (num(tr?.transmissionFactor, 0) > 0) bump(`transmission ${tr.transmissionFactor} (extra scene pass)`, 2);
  const vol = ext(m, 'KHR_materials_volume');
  if (vol && (num(vol.thicknessFactor, 0) > 0 || vol.thicknessTexture)) bump('volume/thickness (raymarched look)', 2);
  if (num(ext(m, 'KHR_materials_clearcoat')?.clearcoatFactor, 0) > 0) bump('clearcoat (second specular lobe)', 1);
  if (num(ext(m, 'KHR_materials_sheen')?.sheenRoughnessFactor, 0) > 0 || (ext(m, 'KHR_materials_sheen')?.sheenColorFactor || []).some((v) => v > 0)) bump('sheen (fabric lobe)', 1);
  if (num(ext(m, 'KHR_materials_iridescence')?.iridescenceFactor, 0) > 0) bump('iridescence (thin-film math)', 1);
  if (ext(m, 'KHR_materials_anisotropy') && num(ext(m, 'KHR_materials_anisotropy').anisotropyStrength, 0) > 0) bump('anisotropy (directional highlights)', 1);
  if (ext(m, 'KHR_materials_specular') && num(ext(m, 'KHR_materials_specular').specularFactor, 1) !== 1) bump('custom specular (non-default F0)', 1);
  if (ext(m, 'KHR_materials_unlit')) bump('unlit (free shading, flat look)', 0);
  if ((m.extensions || {})['KHR_materials_pbrSpecularGlossiness']) bump('legacy spec-gloss (normalize it)', 1);
  if ((m.alphaMode || 'OPAQUE') === 'BLEND') bump('BLEND transparency (sorting + overdraw)', 1);
  if (m.alphaMode === 'MASK' && num(m.alphaCutoff, 0.5) < 0.5) bump('loose alpha cutoff (more discard testing)', 0);
  if (m.doubleSided) bump('double-sided (2x fragment shading)', 1);
  const texCount = ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'occlusionTexture', 'emissiveTexture'].filter((t) => pbr[t] || m[t]).length;
  if (texCount >= 4) bump(`${texCount} textures (sampler pressure)`, 1);
  const emissive = m.emissiveFactor || [0, 0, 0];
  if (emissive.some((v) => v > 0) && !m.emissiveTexture) bump('flat emissive (free glow, no bloom pass)', 0);

  const verdict = ['CHEAP', 'MODERATE', 'EXPENSIVE'][score];
  results.push({ name, verdict, score, reasons });
}
const worst = results.length ? Math.max(...results.map((r) => r.score)) : 0;
const fileVerdict = ['CHEAP', 'MODERATE', 'EXPENSIVE'][worst];
if (asJson) {
  console.log(JSON.stringify({ file, verdict: fileVerdict, materials: results }, null, 2));
} else {
  console.log(`Cost ${file}: ${results.length} material(s) → ${fileVerdict}`);
  for (const r of results) {
    console.log(` ${r.verdict} ${r.name}${r.reasons.length ? ` — ${r.reasons.join('; ')}` : ' (plain PBR)'}`);
  }
  if (!results.length) console.log(' (no materials)');
  if (worst > 0) console.log('Fix: drop unneeded lobes in a DCC, or split costly parts to desktop-only variants.');
}
