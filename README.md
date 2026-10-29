# jensen-registry

The one catalog Jensen reads for developer tools, skills, MCP servers and integrations. Everything is
a static file on `main`, with a checksum, so a client verifies what it fetched and caches it on disk.
There is no hosted service and no seed copy anywhere else. Jensen's code holds no catalog: what you
publish here is what Jensen offers.

## Layout

There are six folders. Each holds its entries, the assets generated from them, and the code that
checks them.

| Folder | Entries | Assets | Code |
|---|---|---|---|
| `tools/` | `upstreams.yaml` (the pins), `overrides/<kind>/<id>.yaml` (policy upstream cannot say) | generated: `packages.yaml`, `servers.yaml`, `formatters.yaml`, `linters.yaml`, `debuggers.yaml`, `filetypes.yaml`, with schemas in `schema/` | `track.mjs`, `generate.mjs`, `validate.mjs`, `lua.mjs`, `patterns.mjs`, `sources/` |
| `clients/` | `<id>.yaml`: how to install a package of one type, or launch a binary through one runtime | | `schema.json`, `validate.mjs` |
| `grammars/` | `sources.yaml`: the crates.io release each tree-sitter grammar is built from, and the CLI version that builds it | `grammars.yaml` (generated), `wasm/<id>-<version>.wasm`: the built grammars | `track.mjs`, `validate.mjs` |
| `skills/` | `<id>.yaml`: the repo, path and ref a skill tracks | | `schema.json`, `track.mjs`, `validate.mjs` |
| `mcp/` | `<id>.yaml`: a server's package or url, its env, its auth, and the integrations it `serves` | `locks/<id>/`: the lockfile a stdio server installs from | `schema.json`, `track.mjs`, `checks.mjs`, `validate.mjs` |
| `integrations/` | `<id>.yaml`: a service Jensen connects to | `icons/<name>.svg` | `schema.json`, `track.mjs`, `checks.mjs`, `validate.mjs`, `icons.mjs` |

At the root: `index.yaml` (generated, never hand edited), `checksums.txt`, `registry.mjs` (runs the
folders), `lib.mjs` (shared helpers) and `package.json`.

- `index.yaml`: every entry resolved and pinned. Skills carry the commit, each file's url and sha256 and a content hash. Stdio servers carry an exact version and a hashed lockfile. Every server lists the env it needs. Tools are not captured: a server lists them itself once it is connected. Every integration lists the servers that serve it and its pinned icon.
- `checksums.txt`: `<sha256>  <file>` for `index.yaml`, `grammars/grammars.yaml`, every file under `tools/` that clients read, and every file in `clients/`. A client checks it before trusting a fetched file.

## Tools

Nothing in `tools/` is written by hand except the pins and the overrides. `track` reads each upstream
at the commit or release pinned in `tools/upstreams.yaml`, with no Lua runtime and no download of any
tool, and writes generic YAML. Every file has `schema_version: 2`, an `upstream` block naming the pin it
was generated from, and a JSON schema under `tools/schema/`. Ids are sorted and keys are in a fixed
order, so `node registry.mjs validate --online` regenerates everything from the pins and requires the
same bytes.

| File | Source | Entry |
|---|---|---|
| `packages.yaml` | the Mason registry release (`registry.json.zip`, checked against its pinned sha256 and the checksum Mason publishes) | one package: `source` (the purl type), `coordinate`, `version`, `description`, `homepage`, `languages` (Mason's names), `filetypes` (the Neovim filetypes those map to), `categories`, `lspconfig`, `bin` (each name with its `client` and `target`), `share`, `opt`, and `artifacts` |
| `servers.yaml` | nvim-lspconfig `lsp/*.lua` | `cmd`, `filetypes`, `root_markers`, `settings`, `init_options`, joined to its package through Mason's `lspconfig` name |
| `formatters.yaml` | conform.nvim | `command`, `args`, `range_args`, `stdin`, `cwd_markers`, `require_cwd`, `exit_codes`, `env`, joined to the package that ships `command` |
| `linters.yaml` | nvim-lint | `cmd`, `args`, `stdin`, `append_file`, `stream`, `ignore_exitcode`, `env`, and `parser` |
| `debuggers.yaml` | mason-nvim-dap | the adapter (`bin` names a package binary), its `filetypes` and its `configurations` |
| `filetypes.yaml` | Neovim `runtime/lua/vim/filetype.lua` | a filetype id with its `extensions` and `filenames` |

Filetype ids are Neovim's (`sh`, `cs`, `typescriptreact`). A formatter, linter or debugger takes its
`filetypes` from the languages of its package: a Mason language name is looked up in GitHub Linguist
by name or alias, and its extensions and filenames are matched against `filetypes.yaml`.

### Placeholders in tool entries

`{file}` is the file being processed, `{dir}` its folder and `{relative_file}` its path from the
project root. conform's `$FILENAME`, `$DIRNAME` and `$RELATIVE_FILEPATH` become these. A function
argument that returns the buffer path becomes `{file}`.

### Parsers

A linter `parser` is `kind: regex`, with `patterns` (plain regexes with the named groups `path`,
`line`, `column`, `end_line`, `end_column`, `severity`, `code` and `message`, line and column numbers
1 based as the tool prints them), an optional `severity` map and optional `defaults`; or `kind: json`,
which an override supplies. nvim-lint's Lua patterns and errorformats are translated at track time,
and any that cannot be are left out and reported, never guessed.

### What `track` cannot read

Lua is read statically: literal tables, string concatenation, a short list of helpers
(`root_pattern`, `root_file`, `from_node_modules`, `exepath`, `from_pattern`, `from_errorformat`)
and functions that only return the buffer path. A field set by any other function is skipped and
counted, and `npm run track` prints the count for each kind. A `cmd` function is read when it only
starts an rpc client with a literal command, or falls back to a literal binary. An entry still missing
a required field (a server `cmd`, a formatter `command`, a linter `cmd` or `parser`, a debugger
`adapter`) stays in its file with `runnable: false`, and `npm run track` prints how many each kind has. A host must skip an entry marked `runnable: false`; an override completes it.

### Overrides

`tools/overrides/<kind>/<id>.yaml`, with `kind` one of `server`, `formatter`, `linter` or `debugger`,
is deep merged over the generated entry. It may hold Jensen policy upstream knows nothing of:
`config` (the files a tool reads, with `executes` and `code_keys` for files that run code), `priority`,
`root_strategy` and `remedies`. It may also supply a field that upstream sets with a function and
`track` could not read. `validate` rejects an override that names no generated entry, repeats a value
the generated entry already has, sets a field upstream provides, or sets a field outside the schema.

### Hashes

A GitHub release asset carries the sha256 GitHub publishes for it. Every other download carries none,
which is the trust Mason itself offers, and a client should say so before it installs one. `track` reuses
a recorded sha256 while the url is unchanged.

## Clients

A client file says how to install one kind of package or launch one kind of binary. They are the only
install logic: a host that can run argv lists, download, extract and write a shim can install every
package in `packages.yaml`, and holds no per package manager code.

- `kind: package-manager` with a `source`: npm, pypi, cargo, golang, gem, nuget, composer, luarocks,
  opam, openvsx, github and generic. A package's `source` picks the client.
- `kind: builder`: `shell`, which runs a build script. A package with `runs_script: true` is
  installed through it, after the user agrees to run the script.
- `kind: launcher`: how a `bin` entry whose `client` is `node`, `python`, `ruby`, `php`, `dotnet`,
  `java-jar`, `pyvenv` or `path` is started. A launcher writes a shim in the package's `bin_root`
  that runs the `target` through its `interpreter`.

A client has `requires` (a `program` and an optional `probe` that must succeed), a `bin_root` per
platform (where its binaries land, relative to the package folder), an optional `env` set whenever its
binaries run, and `install` steps. A step is one of:

- `run`: an argv with no shell, with optional `env`, `cwd`, `platform`, `when` and `unless`.
- `download` and `to`: fetch a url.
- `extract` and `to`: unpack an archive.
- `download_files` and `extract_files`: fetch, and unpack, each file of the chosen artifact, checking
  `sha256` when the file has one. A file named `name:dest` unpacks into `dest`.

Placeholders are filled strictly and an unknown one is an error: `{dir}` (the package folder), `{name}`
(the package id), `{version}`, `{coordinate}`, `{namespace}` and `{leaf}` (the parts of the coordinate),
`{target}` and `{rest}` (a bin entry's target), `{url}`, `{file}`, `{script}`, `{bin_root}`,
`{bin_root:<client>}`, `{qualifier.<key>}` and `{extra_packages}`, which expands to nothing or to
several arguments. A step with `when: qualifier.<key>` runs only when the package has that qualifier,
and one with `unless` only when it does not.

An artifact is one Mason `asset`, `download` or `build` entry, listing the `targets` it applies to
(`linux_x64_gnu`, `darwin_arm64`, `win`, `unix` and so on). A host picks the artifact whose target
matches the machine, installs its `files`, and finds each binary at `artifact.bin[name]`.
Package level strings that Mason makes depend on the platform are resolved for non Windows machines.

## Grammars

Jensen reads imports through tree-sitter grammars and holds none itself. When a project holds a
language, Jensen installs that language's grammar from here: it downloads
`grammars/wasm/<id>-<version>.wasm`, checks it against the sha256 in `grammars/grammars.yaml`, and
loads it into a sandboxed wasm runtime. Nothing native is loaded.

`grammars/sources.yaml` pins each grammar to a crates.io release, whose checksum `track` verifies
against what crates.io publishes, and pins the `tree-sitter` CLI version that builds it. To add or
update a grammar, change `sources.yaml` and run `npm run track` with that CLI version installed. It
builds only the files that are missing, records every file's sha256 in `grammars/grammars.yaml`, and
refreshes `checksums.txt`. A file under `grammars/wasm/` is never rewritten, because released clients
pin it by hash. `validate` checks that every source has a wasm file, that the file is a wasm module,
and that the recorded entries match the files. The build is not byte reproducible, so `validate` never
rebuilds.

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
2. Run `npm ci && npm run track` (needs `uv` for pypi servers). It rewrites `index.yaml`, the lockfiles, the icons and `checksums.txt`.
3. Open a pull request. `npm test` runs the unit tests and `node registry.mjs validate --online` regenerates the tool catalogs from their pins and checks every entry against its folder's `schema.json`, that `index.yaml` matches them, that every hash matches its file, and that every skill file still downloads to its pinned sha256.

## Staying current

`track` runs daily. It re-resolves each `ref` head and each package's latest version, moves every pin
in `tools/upstreams.yaml` to the newest Mason release and the head of each Lua project, regenerates the
tool catalogs, re-pins, and opens a bump pull request against `develop`. Nothing merges without review: the code owner approves every change to a
trusted path.
