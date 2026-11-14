# 0002. TypeScript full stack

- Status: Accepted
- Date: 2026-11-14

## Context

Rust was considered for the backend. Rust has faster runtime performance;
TypeScript has faster development. For this application the user-perceived
latency is dominated by:

- the TeX engine (C), during compilation;
- CodeMirror and PDF.js in the browser (TypeScript regardless of backend);
- network latency, during sync.

The server language has little effect on these. The project is developed
mostly by one person, with one more collaborator later. Sharing code between
browser and server is simpler in one language than across a WASM boundary.

## Decision

Use TypeScript for the frontend and the server.

Components where native performance matters (e.g. the incremental compile
engine, ADR 0006) sit behind explicit interfaces and may be written in Rust or
C, running as separate processes.

## Consequences

- One language for domain logic (document model, annotations, parser) shared by
  browser and server.
- A desktop app remains possible (Tauri with the server as a sidecar, or
  Electron); not decided now.
- Tooling (package manager, runtime, frameworks, test runner) is decided in a
  separate ADR.
