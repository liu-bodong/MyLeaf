# 0015. Comments and suggestions: storage, sync, API and editor

- Status: Proposed
- Date: 2026-11-14
- Refines: ADR 0004 (sync), ADR 0005 (model), ADR 0007 (agents)

## Context

ADR 0005 defines the model, implemented in `@myleaf/annotations` on the
`TextDocument` port (`@myleaf/doc-model`, Yjs adapter in `@myleaf/sync-yjs`):
threads of comments anchored to text, suggestions as marked text, and the
blocking warning when editing another suggestion's text. None of it is
wired up: the editor saves whole files with `PUT`, files exist only as bytes
on disk, and there are no users.

Anchors only work if every edit goes through the document that created them,
and agents (ADR 0007) must be able to comment and suggest without a browser.
So the server has to hold the documents.

## Decision

### Documents live on the server

- Each UTF-8 text file of a project (`.tex`, `.bib`, `.sty`, ...) has a Yjs
  document on the server, persisted as a Yjs update log in the project's data
  directory. Binary files stay as they are.
- Files get stable ids (`FileId`): threads anchor to a file id, so renaming a
  file keeps its comments. The project keeps the path → id map.
- The plain file on disk becomes a **projection** of the document, written
  shortly after each change, so compile, live preview, upload and download
  keep working unchanged. Projection: all pending suggestions applied
  (suggested insertions in, suggested deletions out). See question 2.
- Replacing a text file from outside (upload, `PUT`) updates the document
  with a minimal diff, so anchors outside the changed region survive.

### Sync

- One WebSocket per open project (`/api/projects/:id/sync`) carries the Yjs
  sync protocol for the open file and for the project's annotations. The
  editor no longer saves whole files; the save indicator shows sync state.
- Single host for now, so the server is the only relay; the same channel
  later serves several users (Phase 2).

### Annotations

- Threads, comments and suggestion records are stored per project in a Yjs
  map (one more document on the same channel), so they sync live and
  persist the same way as text. Domain functions from `@myleaf/annotations`
  stay the only way records are created or changed.
- REST endpoints expose the same operations (start thread, reply, resolve,
  reopen, accept, reject, suggest) for agents and the future MCP server
  (ADR 0007).

### People (no accounts yet)

- A server-wide list of people (name, colour) in the data directory. The
  browser asks "who are you?" once and remembers it; @mentions pick from the
  list. No passwords: same trust model as today (trusted network only). See
  question 1. Accounts come with Phase 2 and replace the picker.

### Editor

- A MyLeaf binding between CodeMirror and the document (not
  `y-codemirror.next`, whose inserts inherit neighbouring marks; ADR 0005,
  "Editor binding"). In suggest mode it turns typing into
  `suggestInsertion` / `suggestDeletion` and shows the blocking warning on
  `SuggestionConflictError`.
- Decorations: comment ranges highlighted; suggested insertions underlined
  and coloured per author; suggested deletions struck through.
- A review panel beside the editor lists threads and suggestions of the open
  file: reply (nested), resolve / reopen, accept / reject, filter resolved.
- Comment on the selection from the editor's context menu and a shortcut.
- PDF presentation stays deferred (ADR 0005, Open).

### Milestones

1. **Server documents and sync.** No visible feature; editing must behave
   exactly as before. Largest risk, so it lands and settles first.
2. **Comments:** threads, nested replies, resolve, review panel, highlights,
   people picker, @mentions.
3. **Suggestions:** suggest mode, accept / reject, conflict warning.
4. **Mentions inbox:** threads that mention you, in the app (no e-mail).

## Questions for the owner

1. **People without accounts:** is a name picker (no passwords, trusted
   network) acceptable until Phase 2?
2. **What compiles:** pending suggestions applied (proposed; what you see
   minus struck-through text), or accepted text only, or a switch?
3. **Where the suggest-mode switch goes:** the editor toolbar has only
   undo/redo and Code/Visual by your choice. Proposed: in the review panel's
   header.
4. **Order:** milestones 1→4 as listed, or comments without suggestions
   first and stop there for feedback?

## Consequences

- The server holds every open document in memory (Yjs), and projects get a
  data format beyond plain files (update logs, annotation map, file ids).
  Existing projects are migrated on first open: each text file becomes a
  document with its current content.
- Edits from the browser arrive as Yjs updates, not through the domain API,
  so permissions (ADR 0007) cannot yet be enforced per edit; acceptable while
  there is one trusted host, to be revisited with accounts.
- Moves MyLeaf onto the Phase 2 sync path early; accounts, presence and
  several users build on it.
