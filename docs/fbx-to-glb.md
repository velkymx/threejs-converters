# fbx-to-glb

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Best-Effort Limits](#best-effort-limits)
- [Blender Path](#blender-path)
- [See Also](#see-also)

## Introduction

fbx-to-glb converts FBX finds (Mixamo characters, Sketchfab downloads, Blender exports) into GLB files using headless three.js loaders. Geometry, rigs, and animations come across; a `SCALE_ROOT` wrapper applies the usual meter normalization. It needs the `three` dependency (`npm install` covers it).

## Usage

```bash
node converters/fbx-to-glb.js <in.fbx> [--out out.glb] [--units cm] [--scale 1]
  [--target-max 1.8] [--target-height 1.7] [--z-up] [--keep-textures] [--no-center] [--no-ground]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |
| `--units` | meters | Source units: `mm\|cm\|m\|km\|in\|ft\|yd`. Mixamo files are centimeters. |
| `--scale` | `1` | Extra explicit multiplier, combined with `--units`. |
| `--target-max` | off | Auto-fit the longest bbox side to M meters. |
| `--target-height` | off | Auto-fit the bbox Y height to M meters. Ideal for characters. |
| `--z-up` | off | Apply a −90° X rotation first. Only for Z-up authored files. |
| `--keep-textures` | off | Attempt to keep embedded textures. Usually fails headless (see below). |
| `--no-center` | off | Keep the original XZ offset. |
| `--no-ground` | off | Keep the original Y offset. |

## Examples

Convert a Mixamo dancer into a 1.7 m character:

```bash
node converters/fbx-to-glb.js ./assets/mixamo.fbx --units cm --target-height 1.7
# BBox raw: 194.685,180.473,36.427 → factor x0.00941967
# Scene: 2 mesh(es), 119 bone(s), 2 animation(s).
# Next: rig-report.js on output (check influences), then rig-normalize.js if flagged.
# Wrote assets/mixamo.glb (9721.5 KB)
```

Then audit the rig before anything else:

```bash
node converters/rig-report.js ./assets/mixamo.glb
```

## Best-Effort Limits

FBX is proprietary, so this tool is honest about what it cannot do:

- **Textures are stripped by default.** Node has no canvas, so texture maps are set to `null` (colors and factors survive). Reattach game textures converted with [texture-convert](texture-convert.md), or use the Blender path.
- **`--keep-textures` will likely fail headless** for the same reason. If it does, rerun without the flag.
- Parse or export failures print the Blender path and exit 1 rather than writing a corrupt file.

## Blender Path

For textured or complex rigs, the most rock-solid route is Blender: File → Export → glTF 2.0 (`.glb`), +Y Up, Apply Modifiers, UVs + Normals checked. Then continue with [glb-optimize](glb-optimize.md) as usual.

## See Also

- [rig-report](rig-report.md): always audit a converted rig.
- [rig-normalize](rig-normalize.md): fix whatever the audit flags.
- [anim-trim](anim-trim.md): cut the converted clips down to game loops.
