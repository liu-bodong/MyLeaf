# 0008. Toolchain

- Status: Accepted
- Date: 2026-11-14

## Decision

| Concern                | Choice                                                    |
| ---------------------- | --------------------------------------------------------- |
| Runtime                | Node.js 22 LTS (`.nvmrc`, `engines`)                      |
| Package manager        | pnpm workspaces, pinned via `packageManager` and corepack |
| Dependency versions    | pnpm catalog in `pnpm-workspace.yaml` (one version each)  |
| Language               | TypeScript 6.0, strict                                    |
| Server framework       | Fastify                                                   |
| Frontend               | React + Vite                                              |
| Unit tests             | Vitest                                                    |
| End-to-end tests       | Playwright (added when there is UI to test)               |
| Lint / format          | ESLint (typescript-eslint, type-aware) + Prettier         |
| Continuous integration | GitHub Actions                                            |

TypeScript is held at 6.0 because typescript-eslint 8.72 supports
`typescript >=4.8.4 <6.1.0`; TypeScript 7 is not yet supported by it.

### Package conventions

- Every package is ESM and exports its public API from `src/index.ts`.
- `exports` has a `@myleaf/source` condition pointing at `src/index.ts`.
  Type checking, Vitest and Vite use it, so no build is needed during
  development. Published output (`dist/`) is built with `tsconfig.build.json`,
  which disables that condition.
- Tests are colocated as `src/**/*.test.ts` and excluded from builds.

## Consequences

- `pnpm check` runs everything CI runs.
- Upgrading a shared dependency is a one-line catalog change.
