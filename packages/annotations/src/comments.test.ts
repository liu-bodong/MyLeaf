import { ActorId, FileId } from '@myleaf/doc-model';
import { InMemoryTextDocument } from '@myleaf/testing';
import { describe, expect, it } from 'vitest';
import {
  buildCommentTree,
  createRangeTarget,
  reopenThread,
  reply,
  resolveRangeTarget,
  resolveThread,
  startThread,
} from './comments.js';
import type { CommentInput, ThreadTarget } from './comments.js';
import { AnnotationError } from './errors.js';
import { CommentId, SuggestionId, ThreadId } from './ids.js';

const alice = ActorId('alice');
const bob = ActorId('bob');
const fileId = FileId('main.tex');
const suggestionTarget: ThreadTarget = { kind: 'suggestion', suggestionId: SuggestionId('s1') };

const input = (id: string, at: number, overrides: Partial<CommentInput> = {}): CommentInput => ({
  commentId: CommentId(id),
  authorId: alice,
  body: `comment ${id}`,
  mentions: [],
  at,
  ...overrides,
});

const newThread = () =>
  startThread({ ...input('c1', 1), threadId: ThreadId('t1'), target: suggestionTarget });

describe('range targets', () => {
  it('follow the commented text through edits', () => {
    const doc = new InMemoryTextDocument('The quick fox.');
    const target = createRangeTarget(doc, fileId, 4, 5);
    if (target.kind !== 'range') throw new Error('expected range target');

    doc.insert(4, 'very ');
    doc.insert(0, '>> ');
    doc.insert(18, 'brown ');

    const range = resolveRangeTarget(doc, target);
    expect(doc.getText()).toBe('>> The very quick brown fox.');
    expect(range).toEqual({ offset: 12, length: 5 });
  });

  it('collapse to length 0 when the commented text is deleted', () => {
    const doc = new InMemoryTextDocument('The quick fox.');
    const target = createRangeTarget(doc, fileId, 4, 5);
    if (target.kind !== 'range') throw new Error('expected range target');

    doc.delete(4, 6);

    expect(resolveRangeTarget(doc, target)).toEqual({ offset: 4, length: 0 });
  });
});

describe('threads', () => {
  it('starts a thread with its first comment', () => {
    const { thread, comment } = startThread({
      ...input('c1', 10, { mentions: [bob, bob] }),
      threadId: ThreadId('t1'),
      target: suggestionTarget,
    });
    expect(thread).toEqual({
      id: 't1',
      target: suggestionTarget,
      createdBy: alice,
      createdAt: 10,
      resolution: null,
    });
    expect(comment).toMatchObject({ threadId: 't1', parentId: null, mentions: [bob] });
  });

  it('rejects empty comment bodies', () => {
    const { thread } = newThread();
    expect(() => reply(thread, null, input('c2', 2, { body: '  ' }))).toThrow(AnnotationError);
  });

  it('rejects replies to a comment from another thread', () => {
    const { thread } = newThread();
    const other = startThread({
      ...input('x1', 1),
      threadId: ThreadId('t2'),
      target: suggestionTarget,
    });
    expect(() => reply(thread, other.comment, input('c2', 2))).toThrow(AnnotationError);
  });

  it('resolves and reopens', () => {
    const { thread } = newThread();
    const resolved = resolveThread(thread, bob, 5);
    expect(resolved.resolution).toEqual({ by: bob, at: 5 });
    expect(() => resolveThread(resolved, bob, 6)).toThrow(AnnotationError);
    expect(reopenThread(resolved).resolution).toBeNull();
    expect(() => reopenThread(thread)).toThrow(AnnotationError);
  });

  it('builds nested reply trees in chronological order', () => {
    const { thread, comment: root } = newThread();
    const late = reply(thread, root, input('c3', 30));
    const early = reply(thread, root, input('c2', 20));
    const nested = reply(thread, early, input('c4', 40, { authorId: bob }));
    const second = reply(thread, null, input('c5', 50));

    const tree = buildCommentTree([second, nested, late, root, early]);

    expect(tree.map((n) => n.comment.id)).toEqual(['c1', 'c5']);
    expect(tree[0]?.replies.map((n) => n.comment.id)).toEqual(['c2', 'c3']);
    expect(tree[0]?.replies[0]?.replies.map((n) => n.comment.id)).toEqual(['c4']);
  });
});
