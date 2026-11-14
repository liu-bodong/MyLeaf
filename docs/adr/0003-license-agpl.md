# 0003. License: AGPL-3.0

- Status: Accepted
- Date: 2026-11-14

## Context

The project will not be run as a hosted business, but it will support
self-hosting and third-party hosting. Without a network copyleft clause, a
third party could host a modified closed version.

## Decision

License the project under the GNU Affero General Public License v3.0
(see `LICENSE`).

## Consequences

- Anyone who hosts a modified version must offer its source to its users.
- Dependencies must be AGPL-3.0-compatible. MIT, BSD, Apache-2.0, GPL-3.0 and
  AGPL-3.0 dependencies are compatible; GPL-2.0-only dependencies are not.
