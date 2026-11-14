# MyLeaf

An open-source, self-hostable collaborative LaTeX editor.

Licensed under [AGPL-3.0](LICENSE). Design decisions: [docs/adr](docs/adr/README.md).

## Development

Requirements: Node.js 22 (see `.nvmrc`) and corepack (bundled with Node.js).

```bash
corepack enable
pnpm install
pnpm check        # format, lint, typecheck, test, build (same as CI)
```

| Path                   | Layer   | Purpose                                                   |
| ---------------------- | ------- | --------------------------------------------------------- |
| `packages/doc-model`   | Domain  | Ids, actors, `TextDocument` port (text, marks, anchors)   |
| `packages/annotations` | Domain  | Comment threads, suggestions (track changes), projections |
| `packages/sync-yjs`    | Adapter | `TextDocument` on Yjs                                     |
| `packages/testing`     | Testing | Port contract suites and in-memory test doubles           |
| `apps/server`          | App     | Fastify server                                            |
| `apps/web`             | App     | React web client                                          |

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

| Phase | Scope                                                                               |
| ----- | ----------------------------------------------------------------------------------- |
| 0     | Repository skeleton, tooling, CI, data model for documents, anchors and annotations |
| 1     | Single user: files, editor, compile (L1), PDF viewer, SyncTeX navigation            |
| 2     | Multi-user: auth, real-time sync, presence                                          |
| 3     | Comments, threads, suggestions                                                      |
| 4     | AI actors and MCP server                                                            |
| 5     | Visual modes, instant in-editor rendering (L2)                                      |
| 6     | Tables, navigation, configuration                                                   |
| —     | Research track: incremental compilation (L3, TeXpresso)                             |
| —     | Desktop app                                                                         |
