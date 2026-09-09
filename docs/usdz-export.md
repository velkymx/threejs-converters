# usdz-export

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Textures](#textures)
- [Verify the Package](#verify-the-package)
- [See Also](#see-also)

## Introduction

usdz-export converts a `.glb` into `.usdz` for Apple AR Quick Look using the headless three.js `USDZExporter`. GLB bytes parse into a Scene, the exporter writes USDA plus geometry into an uncompressed zip, and out comes an AR-ready package. It needs the `three` dependency (`npm install` covers it).

## Usage

```bash
node converters/usdz-export.js <in.glb> [--out out.usdz]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.usdz` | Output path. |

## Examples

```bash
node converters/glb-optimize.js ./assets/chair.glb --out ./assets/chair.opt.glb
node converters/usdz-export.js ./assets/chair.opt.glb --out ./assets/chair.usdz
# Wrote ./assets/chair.usdz (412.6 KB), 1 mesh(es), AR Quick Look ready
```

## Textures

Texture maps are stripped with a printed count. The exporter rasterizes through canvas ops with no headless equivalent, so colors and factors survive but maps do not. Same contract as [fbx-to-glb](fbx-to-glb.md): geometry converts, textures need another path.

## Verify the Package

A USDZ is an uncompressed zip, so [pk3-to-dir](pk3-to-dir.md) inspects it:

```bash
node converters/pk3-to-dir.js ./assets/chair.usdz --out-dir ./assets/chair-usdz --list
#  store        1584 model.usda
```

## See Also

- [glb-optimize](glb-optimize.md): optimize before exporting.
- [gltf-report](gltf-report.md): audit the source GLB.
- [pk3-to-dir](pk3-to-dir.md): list package contents.
