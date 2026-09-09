# pk3-to-dir

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [Safety Rules](#safety-rules)
- [See Also](#see-also)

## Introduction

pk3-to-dir unpacks Quake 3 `.pk3` files — renamed ZIPs carrying models, textures, and scripts — into a directory tree. Everything downstream (md3-to-glb, textures) needs loose files first, so this is step zero of the Q3 pipeline. It is zero-dependency and runs with plain Node, using `node:zlib` for inflate.

## Usage

```bash
node converters/pk3-to-dir.js <in.pk3|in.zip> [--out-dir dir] [--list] [--max-mb 512]
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out-dir` | input name minus extension | Extraction root, created if missing. |
| `--list` | off | Print the archive tree without extracting. |
| `--max-mb` | `512` | Refuse when total uncompressed bytes exceed this (zip-bomb guard). |

## Examples

```bash
node converters/pk3-to-dir.js ./assets/pak0.pk3 --out-dir ./assets/pak0
#  inflate      1234 models/arena.md3
#  store          21 models/arena.skin
# Wrote 2 file(s), 1 dir(s) → ./assets/pak0
```

Preview first with `--list` — it walks the same central directory, minus writes.

## Safety Rules

Archives are untrusted input. The tool refuses or skips instead of guessing:

- Non-ZIP magic, missing End-of-central-directory, and multi-disk archives exit 1.
- `..` traversal, absolute paths, and drive-letter paths are skipped — nothing ever writes outside `--out-dir`.
- Encrypted entries, data descriptors, and non-store/deflate methods are skipped with the reason.
- Truncated entries (central directory or local header overruns) exit 1.
- Zero files extracted exits 1, so hostile-or-empty archives never pass silently in a pipeline.

## See Also

- [md3-to-glb](md3-to-glb.md) — convert the extracted models next.
- [texture-convert](texture-convert.md) — convert the extracted textures.
