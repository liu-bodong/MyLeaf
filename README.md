# MyLeaf

An open-source, self-hostable collaborative LaTeX editor.

Licensed under [AGPL-3.0](LICENSE). Design decisions: [docs/adr](docs/adr/README.md).

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

| Phase | Scope |
|---|---|
| 0 | Repository skeleton, tooling, CI, data model for documents, anchors and annotations |
| 1 | Single user: files, editor, compile (L1), PDF viewer, SyncTeX navigation |
| 2 | Multi-user: auth, real-time sync, presence |
| 3 | Comments, threads, suggestions |
| 4 | AI actors and MCP server |
| 5 | Visual modes, instant in-editor rendering (L2) |
| 6 | Tables, navigation, configuration |
| — | Research track: incremental compilation (L3, TeXpresso) |
| — | Desktop app |
