import type { ProjectPath } from '@myleaf/project';

export interface SourceUpdate {
  readonly path: ProjectPath;
  readonly text: string;
}

/**
 * Carries editor changes to the live preview without re-rendering the
 * workspace on every keystroke.
 */
export class LiveChannel {
  readonly #listeners = new Set<(update: SourceUpdate) => void>();

  publish(update: SourceUpdate): void {
    for (const listener of this.#listeners) listener(update);
  }

  subscribe(listener: (update: SourceUpdate) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
