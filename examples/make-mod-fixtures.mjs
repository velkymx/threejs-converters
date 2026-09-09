// make-mod-fixtures.mjs — generate tiny mod-format fixtures under assets/.
// Run: node examples/make-mod-fixtures.mjs
// Covers formats with no hand-writable form: MD3 (binary), VOX (chunked), MD2 (binary).
// (PK3 fixtures reuse assets/cube.obj at demo time; Minecraft JSON is trivially hand-written.)
import { writeFileSync } from 'node:fs';

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
