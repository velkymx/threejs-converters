// make-mod-fixtures.mjs — generate tiny mod-format fixtures under assets/.
// Run: node examples/make-mod-fixtures.mjs
// Covers formats with no hand-writable form: MD3 (binary), VOX (chunked), MD2 (binary),
// 3MF (OPC zip), EXR (scanline structs).
// (PK3 fixtures reuse assets/cube.obj at demo time; Minecraft JSON is trivially hand-written.)
import { writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

const enc = (s, n) => { const b = Buffer.alloc(n); b.write(s, 0, 'ascii'); return b; };

// --- test.md3: 1 frame, 1 surface, 1 tri; verts at 64 units = 1.0 m after /64 ---
{
  const head = Buffer.alloc(108);
  head.write('IDP3', 0, 'ascii'); head.writeInt32LE(15, 4);
  head.writeInt32LE(1, 76); head.writeInt32LE(0, 80); head.writeInt32LE(1, 84); head.writeInt32LE(0, 88);
  head.writeInt32LE(108, 92); head.writeInt32LE(108, 96); head.writeInt32LE(164, 100);
  const frame = Buffer.alloc(56);
  enc('first', 16).copy(frame, 40);
  const sh = Buffer.alloc(108);
  sh.write('IDP3', 0, 'ascii'); enc('body', 64).copy(sh, 8);
  sh.writeInt32LE(1, 72); sh.writeInt32LE(1, 76); sh.writeInt32LE(3, 80); sh.writeInt32LE(1, 84);
  sh.writeInt32LE(108, 88); sh.writeInt32LE(120, 92); sh.writeInt32LE(188, 96); sh.writeInt32LE(212, 100);
  const tris = Buffer.alloc(12);
  tris.writeInt32LE(0, 0); tris.writeInt32LE(1, 4); tris.writeInt32LE(2, 8);
  const shader = Buffer.concat([enc('models/armor.tga', 64), Buffer.alloc(4)]);
  const st = Buffer.alloc(24);
  st.writeFloatLE(0, 0); st.writeFloatLE(0, 4); st.writeFloatLE(1, 8); st.writeFloatLE(0, 12); st.writeFloatLE(0, 16); st.writeFloatLE(1, 20);
  const xyz = Buffer.alloc(24);
  [[0, 0, 0], [64, 0, 0], [0, 64, 0]].forEach((v, i) => {
    xyz.writeInt16LE(v[0], i * 8); xyz.writeInt16LE(v[1], i * 8 + 2); xyz.writeInt16LE(v[2], i * 8 + 4); xyz.writeUInt16LE(0, i * 8 + 6);
  });
  const surfEnd = 108 + 12 + 68 + 24 + 24;
  head.writeInt32LE(108 + 56 + surfEnd, 104);
  writeFileSync('assets/test.md3', Buffer.concat([head, frame, sh, tris, shader, st, xyz]));
  writeFileSync('assets/test.skin', 'body,models/armor.tga\n');
  console.log('assets/test.md3 + test.skin ok');
}

// --- test.vox: MAIN > SIZE 2x2x2 + XYZI 2 voxels + node graph (what MagicaVoxel writes) ---
{
  const chunk = (id, content, kids) => {
    const h = Buffer.alloc(12);
    h.write(id, 0, 'ascii'); h.writeInt32LE(content.length, 4); h.writeInt32LE(kids.reduce((s, k) => s + k.length, 0), 8);
    return Buffer.concat([h, content, ...kids]);
  };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v, 0); return b; };
  const size = Buffer.alloc(12); size.writeInt32LE(2, 0); size.writeInt32LE(2, 4); size.writeInt32LE(2, 8);
  const xyzi = Buffer.alloc(4 + 8);
  xyzi.writeInt32LE(2, 0);
  xyzi.writeUInt8(0, 4); xyzi.writeUInt8(0, 5); xyzi.writeUInt8(0, 6); xyzi.writeUInt8(1, 7);
  xyzi.writeUInt8(1, 8); xyzi.writeUInt8(1, 9); xyzi.writeUInt8(1, 10); xyzi.writeUInt8(2, 11);
  const dict0 = Buffer.alloc(4);
  const neg1 = Buffer.alloc(4); neg1.writeInt32LE(-1, 0);
  const ntrn = Buffer.concat([u32(0), dict0, u32(1), neg1, u32(0), u32(1), dict0]);
  const ngrp = Buffer.concat([u32(1), dict0, u32(1), u32(2)]);
  const nshp = Buffer.concat([u32(2), dict0, u32(1), u32(0), dict0]);
  const head = Buffer.alloc(8); head.write('VOX ', 0, 'ascii'); head.writeInt32LE(150, 4);
  writeFileSync('assets/test.vox', Buffer.concat([head, chunk('MAIN', Buffer.alloc(0),
    [chunk('SIZE', size, []), chunk('XYZI', xyzi, []), chunk('nTRN', ntrn, []), chunk('nGRP', ngrp, []), chunk('nSHP', nshp, [])])]));
  console.log('assets/test.vox ok');
}

// --- test.md2: 2 frames, 1 tri; uint8 verts at scale 0.5 (frame0 spans 1 m) ---
{
  const head = Buffer.alloc(68);
  head.writeInt32LE(844121161, 0); head.writeInt32LE(8, 4);
  head.writeInt32LE(64, 8); head.writeInt32LE(64, 12); head.writeInt32LE(52, 16);
  head.writeInt32LE(0, 20); head.writeInt32LE(3, 24); head.writeInt32LE(3, 28);
  head.writeInt32LE(1, 32); head.writeInt32LE(0, 36); head.writeInt32LE(2, 40);
  head.writeInt32LE(196, 44); head.writeInt32LE(68, 48); head.writeInt32LE(80, 52);
  head.writeInt32LE(92, 56); head.writeInt32LE(196, 60); head.writeInt32LE(196, 64);
  const st = Buffer.alloc(12);
  st.writeInt16LE(0, 0); st.writeInt16LE(0, 2); st.writeInt16LE(64, 4); st.writeInt16LE(0, 6); st.writeInt16LE(0, 8); st.writeInt16LE(64, 10);
  const tri = Buffer.alloc(12);
  tri.writeUInt16LE(0, 0); tri.writeUInt16LE(1, 2); tri.writeUInt16LE(2, 4);
  tri.writeUInt16LE(0, 6); tri.writeUInt16LE(1, 8); tri.writeUInt16LE(2, 10);
  const frame = (name, verts) => {
    const f = Buffer.alloc(52);
    f.writeFloatLE(0.5, 0); f.writeFloatLE(0.5, 4); f.writeFloatLE(0.5, 8);
    f.writeFloatLE(0, 12); f.writeFloatLE(0, 16); f.writeFloatLE(0, 20);
    f.write(name, 24, 'ascii');
    verts.forEach((v, i) => { f.writeUInt8(v[0], 40 + i * 4); f.writeUInt8(v[1], 40 + i * 4 + 1); f.writeUInt8(v[2], 40 + i * 4 + 2); f.writeUInt8(0, 40 + i * 4 + 3); });
    return f;
  };
  writeFileSync('assets/test.md2', Buffer.concat([head, st, tri,
    frame('frame0', [[0, 0, 0], [2, 0, 0], [0, 2, 0]]),
    frame('frame1', [[0, 0, 2], [2, 0, 2], [0, 2, 2]])]));
  console.log('assets/test.md2 ok');
}

// --- test.3mf: OPC zip (stored) with one triangle model in millimeters ---
{
  const entry = (name, data) => {
    const n = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.write('PK\x03\x04', 0, 'binary'); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(crc32(data) >>> 0, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    return { lh, n, data };
  };
  const types = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>', 'utf8');
  const rels = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>', 'utf8');
  const model = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" name="tri" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1000" y="0" z="0"/><vertex x="0" y="1000" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>', 'utf8');
  const parts = [entry('[Content_Types].xml', types), entry('_rels/.rels', rels), entry('3D/3dmodel.model', model)];
  const chunks = [], central = [];
  let off = 0;
  for (const p of parts) {
    chunks.push(p.lh, p.n, p.data);
    const cd = Buffer.alloc(46);
    cd.write('PK\x01\x02', 0, 'binary'); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(crc32(p.data) >>> 0, 16);
    cd.writeUInt32LE(p.data.length, 20); cd.writeUInt32LE(p.data.length, 24); cd.writeUInt16LE(p.n.length, 28);
    cd.writeUInt32LE(off, 42);
    central.push(cd, p.n);
    off += 30 + p.n.length + p.data.length;
  }
  const cdStart = off;
  for (const c of central) { chunks.push(c); off += c.length; }
  const end = Buffer.alloc(22);
  end.write('PK\x05\x06', 0, 'binary'); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(off - cdStart, 12); end.writeUInt32LE(cdStart, 16);
  chunks.push(end);
  writeFileSync('assets/test.3mf', Buffer.concat(chunks));
  console.log('assets/test.3mf ok');
}

// --- test.exr: 2x2 RGB float, all-red, uncompressed planar scanlines ---
{
  const str = (s) => Buffer.concat([Buffer.from(s, 'ascii'), Buffer.from([0])]);
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b; };
  const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b; };
  const ch = (name) => Buffer.concat([str(name), i32(2), Buffer.from([0, 0, 0, 0]), i32(1), i32(1)]);
  const attr = (name, type, value) => Buffer.concat([str(name), str(type), i32(value.length), value]);
  const head = Buffer.alloc(8); head.writeInt32LE(20000630, 0); head.writeInt32LE(2, 4);
  const attrs = Buffer.concat([
    attr('channels', 'chlist', Buffer.concat([ch('R'), ch('G'), ch('B'), Buffer.from([0])])),
    attr('compression', 'compression', Buffer.from([0])),
    attr('dataWindow', 'box2i', Buffer.concat([i32(0), i32(0), i32(1), i32(1)])),
    attr('displayWindow', 'box2i', Buffer.concat([i32(0), i32(0), i32(1), i32(1)])),
    attr('lineOrder', 'lineOrder', Buffer.from([0])),
    attr('pixelAspectRatio', 'float', f32(1)),
    attr('screenWindowCenter', 'v2f', Buffer.concat([f32(0), f32(0)])),
    attr('screenWindowWidth', 'float', f32(1)),
    Buffer.from([0]),
  ]);
  const off0 = 8 + attrs.length + 16;
  const scan = (y) => {
    const px = Buffer.alloc(2 * 3 * 4);
    for (let x = 0; x < 2; x++) for (let c = 0; c < 3; c++) px.writeFloatLE(c === 0 ? 4 : 0, (c * 2 + x) * 4);
    const h = Buffer.alloc(8); h.writeInt32LE(y, 0); h.writeUInt32LE(px.length, 4);
    return Buffer.concat([h, px]);
  };
  const s0 = scan(0), s1 = scan(1);
  const offs = Buffer.alloc(16);
  offs.writeBigUInt64LE(BigInt(off0), 0); offs.writeBigUInt64LE(BigInt(off0 + s0.length), 8);
  writeFileSync('assets/test.exr', Buffer.concat([head, attrs, offs, s0, s1]));
  console.log('assets/test.exr ok');
}
