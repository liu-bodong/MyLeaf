# MyLeaf

An open-source, self-hostable collaborative LaTeX editor.

"MyLeaf" (and the `@myleaf/*` package scope) is a working name.

Licensed under [AGPL-3.0](LICENSE). Design decisions: [docs/adr](docs/adr/README.md).

## Development

Requirements:

- Node.js 22 (see `.nvmrc`) and corepack (bundled with Node.js).
- TeX Live with `latexmk` and `synctex` on `PATH`, for compiling.

```bash
corepack enable
pnpm install
pnpm dev          # server on 127.0.0.1:3000, web app on http://localhost:5173
pnpm check        # format, lint, typecheck, test, build (as CI)
pnpm e2e          # end-to-end browser test (after `pnpm build`)
pnpm bench        # compile-time benchmark (ADR 0011)
```

Server configuration (environment variables):

| Variable                   | Default     | Purpose                                                    |
| -------------------------- | ----------- | ---------------------------------------------------------- |
| `HOST`                     | `127.0.0.1` | Address to listen on                                       |
| `PORT`                     | `3000`      | Port to listen on                                          |
| `MYLEAF_DATA_DIR`          | `./data`    | Project files (`projects/`) and builds (`builds/`)         |
| `MYLEAF_TEXPRESSO`         | (unset)     | Patched TeXpresso binary; enables live preview (see below) |
| `MYLEAF_LIVE_MAX_SESSIONS` | `4`         | Live previews open at once (~250 MB each)                  |
| `MYLEAF_LIVE_IDLE_MINUTES` | `10`        | Inactivity before a live preview is closed                 |

Live preview (optional, Linux/macOS, ADR 0012) needs the patched TeXpresso:
install the packages listed in `vendor/texpresso/README.md`, then

```bash
vendor/texpresso/build.sh
```

```bash
MYLEAF_TEXPRESSO=$PWD/vendor/texpresso/build/bin/texpresso pnpm dev
```

There is no authentication yet, and compilation is hardened but not
sandboxed (see [ADR 0010](docs/adr/0010-projects-storage-and-compile-service.md)).
Only expose the server to people you trust.

| Path                       | Layer   | Purpose                                                   |
| -------------------------- | ------- | --------------------------------------------------------- |
| `packages/doc-model`       | Domain  | Ids, actors, `TextDocument` port (text, marks, anchors)   |
| `packages/annotations`     | Domain  | Comment threads, suggestions (track changes), projections |
| `packages/project`         | Domain  | Project paths and files, `ProjectStore` port              |
| `packages/compile`         | Domain  | `CompileBackend` port, SyncTeX types, log diagnostics     |
| `packages/api`             | Domain  | HTTP routes and DTO types shared by server and web        |
| `packages/sync-yjs`        | Adapter | `TextDocument` on Yjs                                     |
| `packages/storage-fs`      | Adapter | `ProjectStore` on the filesystem                          |
| `packages/compile-texlive` | Adapter | `CompileBackend` on latexmk + synctex                     |
| `packages/live-preview`    | Domain  | `LivePreviewBackend` port                                 |
| `packages/live-texpresso`  | Adapter | `LivePreviewBackend` on patched TeXpresso                 |
| `packages/testing`         | Testing | Port contract suites and in-memory test doubles           |
| `apps/server`              | App     | Fastify HTTP server                                       |
| `apps/web`                 | App     | React web client (CodeMirror, PDF.js)                     |

Layering rules: [ADR 0009](docs/adr/0009-module-boundaries.md).

## Goals (by priority)

1. **Collaboration**: anchored comment threads with @mentions, Google-Docs-style
   suggestions (track changes) with review and resolution.
2. **AI agents as collaborators**: agents comment and suggest through the same
   API as people, exposed over MCP.
3. **Visual modes**: a readable source mode, and a clean mode that hides
   comments and renders LaTeX inline.
4. **Fast compilation**: near-instant preview.
5. **Tables**: spreadsheet-style editing and CSV import.
6. **File and component navigation** for large projects.
7. **Configurable behavior** (e.g. auto-compile triggers).

## Non-goals

- Operating a hosted service. The project provides what is needed for local,
  self-, and third-party hosting.

## Roadmap

| Phase | Scope                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------ |
| 0     | Repository skeleton, tooling, CI, data model for documents, anchors and annotations                    |
| 1     | Single user: files, editor, compile (L1), PDF viewer, SyncTeX navigation                               |
| 2     | Multi-user: auth, real-time sync, presence                                                             |
| 3     | Comments, threads, suggestions                                                                         |
| 4     | AI actors and MCP server                                                                               |
| 5     | Visual modes, instant in-editor rendering (L2)                                                         |
| 6     | Tables, navigation, configuration                                                                      |
| —     | Configurable from the UI: engine choice, compile settings, resource limits (now environment variables) |
| —     | Live preview (L3) with TeXpresso: first version done (ADR 0012)                                        |
| —     | Desktop app                                                                                            |
