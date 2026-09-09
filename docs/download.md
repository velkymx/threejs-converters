# download

- [Introduction](#introduction)
- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
- [See Also](#see-also)

## Introduction

download fetches online finds to disk so the rest of the pipeline can work on local files. It follows redirects, shows progress, and skips files you already have unless you pass `--force`. It is zero-dependency and runs with plain Node.

You may pass any number of URLs. For model + material pairs (OBJ + MTL), pass both URLs together so they land side by side in the same directory.

## Usage

```bash
node converters/download.js <url...> [--out file] [--out-dir dir] [--timeout ms] [--force]
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `--out` | — | Exact output path. Only valid for a single URL. |
| `--out-dir` | `assets` | Directory for downloads. Created if missing; filenames come from the URL path. |
| `--timeout` | `30000` | Per-request timeout in milliseconds. |
| `--force` | off | Re-download even if the destination file already exists. |

Behavior notes:

- Up to 5 redirects are followed; anything more fails with `Too many redirects`.
- Any non-200 response fails that URL with `HTTP <code>` and moves on; the exit code is set to 1 if any download failed.
- Existing files are skipped with a `Skip exists` message unless `--force` is given.

## Examples

Fetch a single model to a chosen path:

```bash
node converters/download.js https://example.com/chair.obj --out ./assets/chair.obj
# GET https://example.com/chair.obj
#  -> assets/chair.obj
# Saved 48.2 KB
```

Fetch a model with its material file into a directory:

```bash
node converters/download.js https://example.com/chair.obj https://example.com/chair.mtl --out-dir ./assets
```

> [!WARNING]
> `--out` only works with a single URL. With several URLs you must use `--out-dir`, otherwise the tool exits with an error instead of guessing.

## See Also

- [obj-to-glb](obj-to-glb.md) — convert the downloaded OBJ next.
- [fbx-to-glb](fbx-to-glb.md) — convert a downloaded FBX next.
