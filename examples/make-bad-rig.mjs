import { Document, NodeIO } from '@gltf-transform/core';
// Fixture generator for examples (NOT a converter): hostile rigged quad.
// 6 influences/vert, weights sum 1.4, JOINTS_1 second set, no IBM, one detached joint.
const doc = new Document();
doc.createBuffer('b');
const pos = doc.createAccessor('p'); pos.setType('VEC3'); pos.setArray(new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0]));
const j0 = doc.createAccessor('j0'); j0.setType('VEC4'); j0.setArray(new Uint8Array([0,1,2,3, 0,1,2,3, 0,1,2,3, 0,1,2,3]));
const w0 = doc.createAccessor('w0'); w0.setType('VEC4'); w0.setArray(new Float32Array(16).fill(0.3));
const j1 = doc.createAccessor('j1'); j1.setType('VEC4'); j1.setArray(new Uint8Array([4,5,0,0, 4,5,0,0, 4,5,0,0, 4,5,0,0]));
const w1 = doc.createAccessor('w1'); w1.setType('VEC4'); w1.setArray(new Float32Array([.1,.1,0,0, .1,.1,0,0, .1,.1,0,0, .1,.1,0,0]));
const idx = doc.createAccessor('ix'); idx.setType('SCALAR'); idx.setArray(new Uint16Array([0,1,2, 0,2,3]));
const prim = doc.createPrimitive();
prim.setAttribute('POSITION', pos); prim.setAttribute('JOINTS_0', j0); prim.setAttribute('WEIGHTS_0', w0);
prim.setAttribute('JOINTS_1', j1); prim.setAttribute('WEIGHTS_1', w1); prim.setIndices(idx);
const mesh = doc.createMesh('m'); mesh.addPrimitive(prim);
const scene = doc.createScene('s');
const joints = [];
for (let i = 0; i < 5; i++) { const j = doc.createNode('j' + i); joints.push(j); scene.addChild(j); }
const skin = doc.createSkin('sk'); joints.forEach((j) => skin.addJoint(j));
skin.addJoint(doc.createNode('ghost')); // detached: never added to scene
const holder = doc.createNode('mesh'); holder.setMesh(mesh); holder.setSkin(skin); scene.addChild(holder);
await new NodeIO().write(process.argv[2] || 'examples-out/bad-rig.glb', doc);
console.log('bad-rig fixture ok');
