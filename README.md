# jensen-registry

The one catalog Jensen reads for developer tools, skills and MCP servers. Everything is a static
file on `main`, with a checksum, so a client verifies what it fetched and caches it on disk. There
is no hosted service and no seed copy anywhere else.

## Files

- `tools.yaml`: language servers, linters, formatters and debug adapters (`schema/tools.schema.json` in `jensen-org/jensen`).
- `upstreams.yaml`: third party sources Jensen reads through this registry, such as the Mason registry.
- `skills/<id>.yaml` and `mcp/<id>.yaml`: one hand written entry per item. A skill names the repo, path and ref it tracks. An MCP server names its package, or its url.
- `integrations/<id>.yaml`: a service Jensen connects to (GitHub, Jira, Sentry, Excalidraw). It names its auth methods and their fields, the MCP servers in `mcp/` that can serve it, its permissions and an optional native protocol. `default_on: true` turns it on without setup and is accepted only when no credential is needed and an MCP server is marked default.
- `icons/<slug>.svg`: one icon per integration, generated from the pinned `simple-icons` package by `track`, never hand edited. An integration with no Simple Icons slug supplies `icons/local/<id>.svg` in the same form. An icon is one `<path>` on a 24 by 24 canvas and nothing else: `track` rebuilds the file from the path data alone, `validate` refuses any byte that differs, and clients must check the sha256 in `index.yaml` and re-check the form before drawing it.
- `index.yaml`: generated, never hand edited. Every entry resolved and pinned: skills carry the commit, each file's url and sha256, and a content hash; stdio servers carry an exact version and a hashed lockfile; every server lists the env it needs and the tools captured from it.
- `locks/mcp/<id>/`: the lockfile each stdio server installs from. `package-lock.json` for npm, `requirements.txt` with hashes for pypi.
- `checksums.txt`: `<sha256>  <file>` for `tools.yaml`, `index.yaml` and `upstreams.yaml`. A client checks it before trusting a fetched file.

The content hash of a skill is the sha256 of its files' `path NUL sha256 NEWLINE` lines, sorted by path.

A client writes the npm manifest as `{"name":"jensen-mcp","private":true,"dependencies":{<name>:<version>}}`
and runs `npm ci --ignore-scripts` against the lockfile. For pypi it runs
`pip install --require-hashes --no-deps -r requirements.txt` in a fresh venv.

## Adding an item

1. Add `skills/<id>.yaml` or `mcp/<id>.yaml`.
2. Run `npm ci && node scripts/track.mjs` (needs `uv` for pypi servers). It rewrites `index.yaml`, the lockfiles and `checksums.txt`.
3. Open a pull request. `validate` checks the entries against `schema/registry.schema.json`, that `index.yaml` matches them, that every hash matches its file, and that every skill file still downloads to its pinned sha256.

## Staying current

`track` runs daily. It re-resolves each `ref` head and each package's latest version, re-pins, and opens a bump pull request. Nothing merges without review: the code owner approves every change to a trusted path.
