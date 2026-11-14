# Architecture Decision Records

Each ADR records one decision: its context, the decision, and its consequences.
ADRs are immutable once accepted; a change of mind is a new ADR that supersedes the old one.

Status values: `Proposed`, `Accepted`, `Superseded by NNNN`.

| ADR                                                  | Title                                     | Status   |
| ---------------------------------------------------- | ----------------------------------------- | -------- |
| [0001](0001-build-from-scratch.md)                   | Build from scratch, reuse libraries       | Accepted |
| [0002](0002-typescript-full-stack.md)                | TypeScript full stack                     | Accepted |
| [0003](0003-license-agpl.md)                         | License: AGPL-3.0                         | Accepted |
| [0004](0004-collaboration-and-sync.md)               | Collaboration and sync model              | Accepted |
| [0005](0005-comments-and-suggestions.md)             | Comments and suggestions model            | Accepted |
| [0006](0006-compilation.md)                          | Compilation architecture                  | Accepted |
| [0007](0007-ai-agents-as-actors.md)                  | AI agents as collaborators                | Accepted |
| [0008](0008-toolchain.md)                            | Toolchain                                 | Accepted |
| [0009](0009-module-boundaries.md)                    | Module boundaries: ports and adapters     | Accepted |
| [0010](0010-projects-storage-and-compile-service.md) | Projects, storage and the compile service | Accepted |
| [0011](0011-compile-on-host-and-fast-compiles.md)    | Compile on the host; fast compiles (L1)   | Accepted |
| [0012](0012-live-preview-with-texpresso.md)          | Live preview with a patched TeXpresso     | Accepted |

Template: copy [0000-template.md](0000-template.md).
