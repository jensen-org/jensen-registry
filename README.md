# jensen-registry

The one catalog Jensen reads for developer tools, skills, MCP servers and integrations. Everything is
a static file on `main`, with a checksum, so a client verifies what it fetched and caches it on disk.
There is no hosted service and no seed copy anywhere else. Jensen's code holds no catalog: what you
publish here is what Jensen offers.

## Layout

There are five folders. Each holds its entries, the assets generated from them, and the code that
checks them.

| Folder | Entries | Assets | Code |
|---|---|---|---|
| `tools/` | `overrides.yaml` (the start lines we write by hand), `installers.yaml` (how to install and launch what Mason lists), `tools.yaml` (generated, plus the `grammars` section `grammars/` writes, schema in `jensen-org/jensen`), `upstreams.yaml` (the pinned Mason release and where clients fetch it) | | `track.mjs`, `generate.mjs`, `upstream.mjs`, `validate.mjs` |
| `grammars/` | `sources.yaml`: the crates.io release each tree-sitter grammar is built from, and the CLI version that builds it | `wasm/<id>-<version>.wasm`: the built grammars | `track.mjs`, `validate.mjs` |
| `skills/` | `<id>.yaml`: the repo, path and ref a skill tracks | | `schema.json`, `track.mjs`, `validate.mjs` |
| `mcp/` | `<id>.yaml`: a server's package or url, its env, its auth, and the integrations it `serves` | `locks/<id>/`: the lockfile a stdio server installs from | `schema.json`, `track.mjs`, `checks.mjs`, `validate.mjs` |
| `integrations/` | `<id>.yaml`: a service Jensen connects to | `icons/<name>.svg` | `schema.json`, `track.mjs`, `checks.mjs`, `validate.mjs`, `icons.mjs` |

At the root: `index.yaml` (generated, never hand edited), `checksums.txt`, `registry.mjs` (runs the
five folders), `lib.mjs` (shared helpers), `package.json`, and the two legacy copies below.

- `index.yaml`: every entry resolved and pinned. Skills carry the commit, each file's url and sha256 and a content hash. Stdio servers carry an exact version and a hashed lockfile. Every server lists the env it needs and the tools captured from it. Every integration lists the servers that serve it and its pinned icon.
- `checksums.txt`: `<sha256>  <file>` for `index.yaml`, the tools files and their legacy copies. A client checks it before trusting a fetched file.
- `tools.yaml` and `upstreams.yaml` at the root are byte copies of the files in `tools/`, written by `track`, because released Jensen builds still fetch them from the root. Remove them once those builds are gone.

## Tools

`tools/tools.yaml` mirrors the Mason registry. `track` pins the latest Mason release in `tools/upstreams.yaml`
(tag and sha256) and turns every language server and linter Mason lists into a tool, so Jensen offers
what Mason offers. A server gets `--stdio` and a linter gets `{path}` unless `tools/overrides.yaml` says
otherwise. A formatter or debug adapter needs a start line, so it is listed only when `overrides.yaml`
has one.

`tools/overrides.yaml` is where we write what Mason cannot say:

- `languages`: the languages Jensen knows, with their file extensions. A Mason language not listed here is added without extensions.
- `tools`: entries for tools Mason does not ship (gofmt, rustfmt, clippy) and patches for Mason tools, keyed by `package` and `kind`. A patch sets `args`, a linter `parser`, `settings`, `root_markers`, `priority` and the like.
- `exclude`: Mason tools we do not offer.
- `prefer`: tools that win over generated ones for a language. Generated tools have priority -10.

A package is left out when Jensen cannot install it (its source has no entry in `tools/installers.yaml`), cannot launch it (its bin needs a launcher `installers.yaml` lacks), or has no language. `track` prints how many were left out and why.

`tools/installers.yaml` holds the install commands for the package managers Jensen runs from data, and the launchers that start a tool through an interpreter (`node`, `java -jar` and so on).

## Grammars

Jensen reads imports through tree-sitter grammars and holds none itself. When a project holds a
language, Jensen installs that language's grammar from here: it downloads
`grammars/wasm/<id>-<version>.wasm`, checks it against the sha256 in the `grammars` section of
`tools/tools.yaml`, and loads it into a sandboxed wasm runtime. Nothing native is loaded.

`grammars/sources.yaml` pins each grammar to a crates.io release, whose checksum `track` verifies
against what crates.io publishes, and pins the `tree-sitter` CLI version that builds it. To add or
update a grammar, change `sources.yaml` and run `npm run track` with that CLI version installed. It
builds only the files that are missing, records every file's sha256 in `tools/tools.yaml` below the
generated marker, and refreshes the legacy copy and `checksums.txt`. A file under `grammars/wasm/`
is never rewritten, because released clients pin it by hash. `validate` checks that every source has
a wasm file, that the file is a wasm module, and that the recorded entries match the files. The build
is not byte reproducible, so `validate` never rebuilds.

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
