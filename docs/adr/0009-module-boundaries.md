# 0009. Module boundaries: ports and adapters

- Status: Accepted
- Date: 2026-11-14

## Context

The project must not become locked to a single library or stack. The core
model (documents, anchors, comments, suggestions) is expected to outlive any
particular sync library, database, server framework or UI framework.

## Decision

Packages are organized in three layers. Dependencies point inward only.

| Layer    | Packages (current)         | May depend on                         |
| -------- | -------------------------- | ------------------------------------- |
| Domain   | `doc-model`, `annotations` | Other domain packages only            |
| Adapters | `sync-yjs`                 | Domain packages, third-party libs     |
| Apps     | `server`, `web`            | Anything; they wire adapters to ports |

1. **Ports** are TypeScript interfaces defined in domain packages (e.g.
   `TextDocument` in `doc-model`). Domain code uses only ports.
2. **Adapters** implement ports on top of a specific library (e.g.
   `YjsTextDocument`). Library types never appear in a port's signature.
3. **Contract suites** in `@myleaf/testing` define the behaviour of each port.
   Every adapter runs the suite for the ports it implements, so a replacement
   adapter can be verified against the same tests.
4. **Test doubles** (e.g. `InMemoryTextDocument`) also pass the contract and
   let domain tests run without any adapter.
5. **Enforcement:**
   - ESLint `no-restricted-imports` rejects non-domain imports in domain
     packages (`eslint.config.js`).
   - Domain packages are built (`tsconfig.build.json`, production code only)
     with `types: []`, so platform globals (Node or DOM) are unavailable to
     them. Their tests may use Node types.
   - pnpm's strict `node_modules` rejects imports of undeclared dependencies.

## Consequences

- Replacing Yjs, Fastify, React or the database is a new adapter or app
  change, not a domain rewrite.
- Adding a port costs an interface, a contract suite and a test double.
- A new domain package must be added to `DOMAIN_PACKAGES` in
  `eslint.config.js`.
