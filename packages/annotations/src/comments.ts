import type { ActorId, Anchor, EpochMillis, FileId, TextDocument } from '@myleaf/doc-model';
import { AnnotationError } from './errors.js';
import type { CommentId, SuggestionId, ThreadId } from './ids.js';

/** What a thread is about: a span of source text, or a suggestion. */
export type ThreadTarget =
  | {
      readonly kind: 'range';
      readonly fileId: FileId;
      readonly start: Anchor;
      readonly end: Anchor;
    }
  | {
      readonly kind: 'suggestion';
      readonly suggestionId: SuggestionId;
    };

export interface Resolution {
  readonly by: ActorId;
  readonly at: EpochMillis;
}

export interface CommentThread {
  readonly id: ThreadId;
  readonly target: ThreadTarget;
  readonly createdBy: ActorId;
  readonly createdAt: EpochMillis;
  readonly resolution: Resolution | null;
}

/** A comment in a thread. `parentId` makes threads trees (comments on comments). */
export interface Comment {
  readonly id: CommentId;
  readonly threadId: ThreadId;
  readonly parentId: CommentId | null;
  readonly authorId: ActorId;
  readonly body: string;
  readonly mentions: readonly ActorId[];
  readonly createdAt: EpochMillis;
}

export interface CommentInput {
  readonly commentId: CommentId;
  readonly authorId: ActorId;
  readonly body: string;
  readonly mentions: readonly ActorId[];
  readonly at: EpochMillis;
}

export interface CommentTreeNode {
  readonly comment: Comment;
  readonly replies: readonly CommentTreeNode[];
}

/**
 * Anchors `[offset, offset + length)` so that text typed at either boundary
 * stays outside the range, and text typed inside extends it.
 */
export function createRangeTarget(
  doc: TextDocument,
  fileId: FileId,
  offset: number,
  length: number,
): ThreadTarget {
  return {
    kind: 'range',
    fileId,
    start: doc.createAnchor(offset, 'right'),
    end: doc.createAnchor(offset + length, 'left'),
  };
}

/**
 * Current position of a range target. `length` is 0 when all of the anchored
 * text was deleted. Returns `null` if the anchors cannot be resolved in `doc`.
 */
export function resolveRangeTarget(
  doc: TextDocument,
  target: Extract<ThreadTarget, { kind: 'range' }>,
): { offset: number; length: number } | null {
  const start = doc.resolveAnchor(target.start);
  const end = doc.resolveAnchor(target.end);
  if (start === null || end === null) {
    return null;
  }
  return { offset: start, length: Math.max(0, end - start) };
}

export function startThread(
  input: CommentInput & { readonly threadId: ThreadId; readonly target: ThreadTarget },
): { thread: CommentThread; comment: Comment } {
  const thread: CommentThread = {
    id: input.threadId,
    target: input.target,
    createdBy: input.authorId,
    createdAt: input.at,
    resolution: null,
  };
  return { thread, comment: createComment(thread.id, null, input) };
}

/** Replies to `parent`, or to the thread itself when `parent` is `null`. */
export function reply(thread: CommentThread, parent: Comment | null, input: CommentInput): Comment {
  if (parent !== null && parent.threadId !== thread.id) {
    throw new AnnotationError(`Comment ${parent.id} does not belong to thread ${thread.id}`);
  }
  return createComment(thread.id, parent?.id ?? null, input);
}

export function resolveThread(thread: CommentThread, by: ActorId, at: EpochMillis): CommentThread {
  if (thread.resolution !== null) {
    throw new AnnotationError(`Thread ${thread.id} is already resolved`);
  }
  return { ...thread, resolution: { by, at } };
}

export function reopenThread(thread: CommentThread): CommentThread {
  if (thread.resolution === null) {
    throw new AnnotationError(`Thread ${thread.id} is not resolved`);
  }
  return { ...thread, resolution: null };
}

/** Arranges one thread's comments into reply trees, oldest first at every level. */
export function buildCommentTree(comments: readonly Comment[]): CommentTreeNode[] {
  const children = new Map<CommentId | null, Comment[]>();
  const sorted = [...comments].sort((a, b) => a.createdAt - b.createdAt);
  for (const comment of sorted) {
    const siblings = children.get(comment.parentId) ?? [];
    siblings.push(comment);
    children.set(comment.parentId, siblings);
  }
  const build = (comment: Comment): CommentTreeNode => ({
    comment,
    replies: (children.get(comment.id) ?? []).map(build),
  });
  return (children.get(null) ?? []).map(build);
}

function createComment(
  threadId: ThreadId,
  parentId: CommentId | null,
  input: CommentInput,
): Comment {
  if (input.body.trim() === '') {
    throw new AnnotationError('Comment body must not be empty');
  }
  return {
    id: input.commentId,
    threadId,
    parentId,
    authorId: input.authorId,
    body: input.body,
    mentions: [...new Set(input.mentions)],
    createdAt: input.at,
  };
}
