# gltf-pack

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [What Gets Packed](#what-gets-packed)
- [Refusals](#refusals)
- [See Also](#see-also)

## Introduction

gltf-pack turns a split `.gltf` (JSON plus sidecar `.bin` buffers and loose images) into a single self-contained `.glb`. Exporters and pipelines emit the split form; games and loaders want one file. It is zero-dependency and runs with plain Node, and it rewrites nothing but offsets: all other JSON stays byte-identical.

## Usage

```bash
node converters/gltf-pack.js <in.gltf> [--out out.glb]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | same name, `.glb` | Output path. |

Passing a `.glb` input exits 1. There is nothing to pack.

## Examples

```bash
node converters/gltf-pack.js ./assets/model.gltf --out ./assets/model.glb
# Packed ./assets/model.gltf (+1 buffer(s), 2 image(s)) → ./assets/model.glb (184.2 KB)
```

## What Gets Packed

1. Every external buffer URI (resolved relative to the `.gltf`) and every embedded `data:` URI is read into memory.
2. Loose images referenced by `uri` become new buffer views with inferred `mimeType` (png/jpg/webp by extension); already-packed images are untouched.
3. All buffer views are relaid into one BIN chunk with fresh offsets against buffer 0; the file ends with a single buffer entry.

## Refusals

- **Missing sidecars** exit 1 naming the expected path. The split export is incomplete.
- **Remote `http(s)` URIs** exit 1. Fetch them beside the `.gltf` with [download](download.md) first.
- **Overflowing buffer views** and totals over the 4 GB GLB limit exit 1 instead of writing a corrupt file.

## See Also

- [download](download.md): fetch remote sidecars before packing.
- [gltf-report](gltf-report.md): verify the packed result.
