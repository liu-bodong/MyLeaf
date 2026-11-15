import type { ProjectId } from '@myleaf/doc-model';
import type {
  LiveEngine,
  LivePreviewBackend,
  LivePreviewEvent,
  LivePreviewRequest,
  LivePreviewSession,
} from '@myleaf/live-preview';

export interface LiveSessionPoolOptions {
  /** Most sessions open at once; each costs ~250 MB (ADR 0012). */
  readonly maxSessions: number;
  /** A session without activity for this long is closed. */
  readonly idleMs: number;
}

/** An open session, as seen by the connection that owns it. */
export interface LiveSessionHandle {
  readonly projectId: ProjectId;
  readonly session: LivePreviewSession;
  /** Records activity, restarting the idle timer. */
  touch(): void;
  close(): Promise<void>;
}

/**
 * Limits live-preview sessions server-wide and closes idle ones. One session
 * per connection; `forProject` lets other routes (e.g. uploads) reach them.
 */
export class LiveSessionPool {
  readonly #backend: LivePreviewBackend;
  readonly #options: LiveSessionPoolOptions;
  readonly #handles = new Set<LiveSessionHandle>();
  /** Slots taken by sessions that are still opening. */
  #opening = 0;

  constructor(backend: LivePreviewBackend, options: LiveSessionPoolOptions) {
    this.#backend = backend;
    this.#options = options;
  }

  /** The engine of the backend's live pages. */
  get engine(): LiveEngine {
    return this.#backend.engine;
  }

  get size(): number {
    return this.#handles.size;
  }

  /**
   * Opens a session, or returns `null` when the pool is full. `onIdle` runs
   * after the session was closed for inactivity.
   */
  async open(
    request: LivePreviewRequest,
    onEvent: (event: LivePreviewEvent) => void,
    onIdle: () => void,
  ): Promise<LiveSessionHandle | null> {
    if (this.#handles.size + this.#opening >= this.#options.maxSessions) {
      return null;
    }
    this.#opening++;
    let session: LivePreviewSession;
    try {
      session = await this.#backend.open(request, onEvent);
    } finally {
      this.#opening--;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const handle: LiveSessionHandle = {
      projectId: request.projectId,
      session,
      touch: () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void handle.close().then(onIdle);
        }, this.#options.idleMs);
      },
      close: async () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        this.#handles.delete(handle);
        await session.close();
      },
    };
    this.#handles.add(handle);
    handle.touch();
    return handle;
  }

  forProject(projectId: ProjectId): LiveSessionHandle[] {
    return [...this.#handles].filter((handle) => handle.projectId === projectId);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#handles].map((handle) => handle.close()));
  }
}
