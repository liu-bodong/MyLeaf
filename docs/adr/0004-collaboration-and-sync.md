# 0004. Collaboration and sync model

- Status: Accepted
- Date: 2026-11-14

## Context

There is no central hosted service. The MVP topology is "one person hosts,
others connect", but the codebase must allow other topologies later
(multi-host, peer-to-peer, offline-first) without rewriting the core.

## Decision

1. **Document sync uses a CRDT (Yjs).** A CRDT merges edits without a central
   authority deciding order, so the same document model works with a server
   relay, peer-to-peer transport, or offline sync. Yjs relative positions are
   the anchoring primitive for comments and suggestions (ADR 0005).
2. **Infrastructure sits behind interfaces**, with one implementation each in
   the MVP:

   | Interface       | MVP implementation            |
   | --------------- | ----------------------------- |
   | Storage         | SQLite + local filesystem     |
   | Auth            | Local accounts                |
   | Sync transport  | WebSocket via the host server |
   | Compile backend | Local TeX Live (ADR 0006)     |

3. **Core domain logic depends on interfaces only**, never on a concrete
   implementation.

## Consequences

- New topologies or backends are new implementations, not core rewrites.
- CRDT documents retain history metadata; storage growth needs compaction
  (to be designed).
- Git sync and Overleaf import/export are desirable but not required; they
  would be additional implementations at these boundaries.
