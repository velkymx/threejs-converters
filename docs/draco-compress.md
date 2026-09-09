# draco-compress

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Loading the Result](#loading-the-result)
- [See Also](#see-also)

## Introduction

draco-compress shrinks triangle geometry with Draco mesh compression (`KHR_draco_mesh_compression`) using the gltf-transform `draco()` transform and the draco3dgltf wasm encoder. No native toolchain, no Blender. Output stays a plain `.glb` that three.js decodes with DRACOLoader. It needs `@gltf-transform` plus `draco3dgltf` (`npm install` covers both).

## Usage

```bash
node converters/draco-compress.js <in.glb> [--out out.drc.glb] [--method edgebreaker|sequential]
  [--level 7] [--quant 14]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.drc.glb` | Output path. |
| `--method` | `edgebreaker` | Entropy method. `sequential` sometimes wins on tiny meshes. |
| `--level` | `7` | 0..10 compression effort. Higher is smaller and slower. |
| `--quant` | `14` | POSITION bits, 1..16 (normals 10, UVs 12, same as glb-optimize). |

## Examples

```bash
node converters/draco-compress.js ./assets/chair.opt.glb --out ./assets/chair.drc.glb
# Wrote ./assets/chair.drc.glb (28.4 KB, was 41.3 KB) — 31.2% smaller
# Load in three.js: GLTFLoader + DRACOLoader (draco decoder path) required.
```

## Loading the Result

Compression is lossy through quantization, and vanilla GLTFLoader cannot read it alone:

```js
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
loader.setDRACOLoader(draco);
```

## See Also

- [glb-optimize](glb-optimize.md): shrink first (draco stacks on top of clean geometry).
- [gltf-report](gltf-report.md): audit the source; report reads compressed files too.
