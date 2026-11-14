# 0007. AI agents as collaborators

- Status: Accepted
- Date: 2026-11-14

## Context

AI agents should take part in collaboration the same way people do: read the
project, comment, reply, suggest edits, and be @mentioned.

## Decision

1. An AI agent is an **actor** with an identity and permissions, like a human
   user.
2. Humans and agents use the **same domain API** (comment, reply, suggest,
   resolve). No agent-only mutation paths.
3. The API is exposed over REST/WebSocket and as an **MCP server** so external
   agents can connect.
4. By default, agent edits are **suggestions** (ADR 0005), never direct writes.
5. Model providers are configured by the user (bring your own key).

## Consequences

- Every collaboration feature is automatically available to agents.
- Permissions must be enforced at the domain API, not in the UI.
