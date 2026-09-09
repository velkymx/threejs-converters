# collision-proxy

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Using Proxies in three.js](#using-proxies-in-threejs)
- [Why No Hull](#why-no-hull)
- [See Also](#see-also)

## Introduction

collision-proxy builds cheap physics colliders from render meshes. Render geometry is heavy and concave; physics engines like Rapier or cannon-es want convex boxes. The tool reads POSITION bounds per mesh with world transforms applied, then emits one box per mesh plus one combined scene box into a tiny `.proxy.glb` beside the visual. It is zero-dependency and runs with plain Node.

Boxes are axis-aligned in world pose (matching `Box3.setFromObject`). For rotating bodies, re-fit the boxes at runtime instead of trusting the authored pose.

## Usage

```bash
node converters/collision-proxy.js <in.glb> [--out proxy.glb] [--type box] [--snippet]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.proxy.glb` | Output path. |
| `--type` | `box` | Only `box` is supported. Anything else exits with the Blender path. |
| `--snippet` | off | Print three.js + Rapier loader lines for the proxy file. |

Meshes without measurable POSITION min/max (or quantized positions, whose bounds are unreadable statically) are skipped. If nothing is measurable, the tool exits 1.

## Examples

```bash
node converters/collision-proxy.js ./assets/chair.glb --out ./assets/chair.proxy.glb --snippet
# Boxes in ./assets/chair.glb:
#  - chair: size 0.620 x 0.940 x 0.580m
#  - SCENE: size 0.620 x 0.940 x 0.580m
# Wrote ./assets/chair.proxy.glb (1.3 KB) — 2 proxies
# --- three.js snippet ---
# const proxy = await loader.load('chair.proxy.glb'); proxy.visible = false; scene.add(proxy);
# // rapier: proxy.updateWorldMatrix(true,true); for each child: size = new Vector3().setFromMatrixScale(child.matrixWorld), pos = child.getWorldPosition() → cuboid(size.x/2,size.y/2,size.z/2) at pos
```

## Using Proxies in three.js

Load the proxy invisibly beside the visual, then derive one cuboid per child. Each child node carries its box as scale + translation, so world size and position come straight from the matrix:

```js
const proxy = await loader.loadAsync('chair.proxy.glb');
proxy.visible = false;
scene.add(proxy);

proxy.updateWorldMatrix(true, true);
for (const child of proxy.children) {
    const size = new THREE.Vector3().setFromMatrixScale(child.matrixWorld);
    const pos = child.getWorldPosition(new THREE.Vector3());
    // cuboid(size.x / 2, size.y / 2, size.z / 2) at pos
}
```

## Why No Hull

True convex hulls need native code (a quickhull implementation) that has no pure-Node home here. The Blender path covers it: select the mesh → Mesh → Convex Hull → export a proxy `.glb` → use it beside the visual exactly as above.

## See Also

- [gltf-report](gltf-report.md): verify the proxy's world bounds match the visual.
- [budget-gate](budget-gate.md): proxies are tiny; gate the visual instead.
