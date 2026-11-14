import type { ActorId } from './ids.js';

/**
 * Anyone who can read or change a project. Humans and AI agents are both
 * actors and go through the same domain operations (ADR 0007).
 */
export interface Actor {
  readonly id: ActorId;
  readonly kind: 'human' | 'agent';
  readonly displayName: string;
}
