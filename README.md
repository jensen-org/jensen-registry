# jensen-registry

The one catalog Jensen reads for developer tools, skills, MCP servers and integrations. Everything is
a static file on `main`, with a checksum, so a client verifies what it fetched and caches it on disk.
There is no hosted service and no seed copy anywhere else. Jensen's code holds no catalog: what you
publish here is what Jensen offers.

## Layout

There are four folders. Each holds its entries, the assets generated from them, and the code that
checks them.

| Folder | Entries | Assets | Code |
|---|---|---|---|
| `tools/` | `tools.yaml` (language servers, linters, formatters, debug adapters, schema in `jensen-org/jensen`), `upstreams.yaml` (third party sources such as the Mason registry) | | `track.mjs`, `validate.mjs` |
| `skills/` | `<id>.yaml`: the repo, path and ref a skill tracks | | `schema.json`, `track.mjs`, `validate.mjs` |
| `mcp/` | `<id>.yaml`: a server's package or url, its env, its auth, and the integrations it `serves` | `locks/<id>/`: the lockfile a stdio server installs from | `schema.json`, `track.mjs`, `checks.mjs`, `validate.mjs` |
| `integrations/` | `<id>.yaml`: a service Jensen connects to | `icons/<name>.svg` | `schema.json`, `track.mjs`, `checks.mjs`, `validate.mjs`, `icons.mjs` |

At the root: `index.yaml` (generated, never hand edited), `checksums.txt`, `registry.mjs` (runs the
four folders), `lib.mjs` (shared helpers), `package.json`, and the two legacy copies below.

- `index.yaml`: every entry resolved and pinned. Skills carry the commit, each file's url and sha256 and a content hash. Stdio servers carry an exact version and a hashed lockfile. Every server lists the env it needs and the tools captured from it. Every integration lists the servers that serve it and its pinned icon.
- `checksums.txt`: `<sha256>  <file>` for `index.yaml`, the tools files and their legacy copies. A client checks it before trusting a fetched file.
- `tools.yaml` and `upstreams.yaml` at the root are byte copies of the files in `tools/`, written by `track`, because released Jensen builds still fetch them from the root. Remove them once those builds are gone.

## Binding an MCP server to an integration

An MCP server is a candidate for an integration when it lists that integration in `serves`. Adding a
server to `mcp/` is enough: it appears as a choice for the integrations it serves, and the integration
file does not change. An integration only names its `default_mcp`, which must be one of the servers
that serves it. `validate` rejects a server that no auth method of an integration can satisfy, a
`serves` entry that names no integration, and a `default_mcp` that does not serve it.

## Integrations

An integration names its auth methods and their fields, its permissions, and an optional native
protocol. `cli_login` is a bare flag and needs a native protocol: the entry never names a command to
run, only the protocol in Jensen's code knows which binary to ask. `default_on: true` turns an
integration on without setup, and is accepted only when no credential is needed and a `default_mcp`
is set.

Icons are one `<path>` on a 24 by 24 canvas and nothing else. `track` generates them from the pinned
`simple-icons` package, rebuilding each file from the path data alone, and `validate` refuses any byte
that differs. An integration with no Simple Icons slug supplies `integrations/icons/<id>.svg` in the
same form and sets `icon: { local: true, hex: ... }`. Clients must check the sha256 in `index.yaml`,
re-check the form, and draw the icon as an image or mask, never as inline markup.

## Values the machine supplies

A server run on this machine can have an optional, non secret env variable filled in by the client
for each launch, with `from`: `project_root` is the open project, `free_port` is a free local port,
and `loopback_url` is the loopback address of that port (it needs a `free_port` variable in the
same entry). A value the user sets wins. Nothing but those three is possible, so an entry cannot ask
the client to read anything else from the machine.

## How a client installs a server

The content hash of a skill is the sha256 of its files' `path NUL sha256 NEWLINE` lines, sorted by
path. A client writes the npm manifest as `{"name":"jensen-mcp","private":true,"dependencies":{<name>:<version>}}`
and runs `npm ci --ignore-scripts` against the lockfile. For pypi it runs
`pip install --require-hashes --no-deps -r requirements.txt` in a fresh venv.

## Adding an item

1. Add `skills/<id>.yaml`, `mcp/<id>.yaml` or `integrations/<id>.yaml`.
2. Run `npm ci && npm run track` (needs `uv` for pypi servers). It rewrites `index.yaml`, the lockfiles, the icons, the legacy copies and `checksums.txt`.
3. Open a pull request. `npm run validate` checks every entry against its folder's `schema.json`, that `index.yaml` matches them, that every hash matches its file, and that every skill file still downloads to its pinned sha256.

## Staying current

`track` runs daily. It re-resolves each `ref` head and each package's latest version, re-pins, and
opens a bump pull request. Nothing merges without review: the code owner approves every change to a
trusted path.
