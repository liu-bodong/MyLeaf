import { ActorId, FileId } from '@myleaf/doc-model';
import { InMemoryTextDocument } from '@myleaf/testing';
import { describe, expect, it } from 'vitest';
import { AnnotationError } from './errors.js';
import { SuggestionId } from './ids.js';
import {
  SuggestionConflictError,
  createSuggestion,
  decideSuggestion,
  getSuggestionRanges,
  projectText,
  suggestDeletion,
  suggestInsertion,
  suggestReplacement,
} from './suggestions.js';

const alice = ActorId('alice');
const bob = ActorId('bob');
const s1 = SuggestionId('s1');
const s2 = SuggestionId('s2');
const s3 = SuggestionId('s3');

const pending = (id = s1) =>
  createSuggestion({ id, fileId: FileId('main.tex'), authorId: alice, reviewerIds: [bob], at: 1 });

const views = (doc: InMemoryTextDocument) => ({
  text: doc.getText(),
  accepted: projectText(doc, 'accepted'),
  proposed: projectText(doc, 'proposed'),
});

describe('suggested insertion', () => {
  it('is visible in the text but excluded from the accepted view', () => {
    const doc = new InMemoryTextDocument('Hello world');
    suggestInsertion(doc, s1, 5, ' big');
    expect(views(doc)).toEqual({
      text: 'Hello big world',
      accepted: 'Hello world',
      proposed: 'Hello big world',
    });
    expect(getSuggestionRanges(doc)).toEqual([
      { offset: 5, length: 4, mark: { id: s1, kind: 'insertion' } },
    ]);
  });

  it('keeps the text when accepted and removes it when rejected', () => {
    const accepted = new InMemoryTextDocument('Hello world');
    suggestInsertion(accepted, s1, 5, ' big');
    decideSuggestion(accepted, pending(), 'accepted', bob, 2);
    expect(views(accepted)).toEqual({
      text: 'Hello big world',
      accepted: 'Hello big world',
      proposed: 'Hello big world',
    });

    const rejected = new InMemoryTextDocument('Hello world');
    suggestInsertion(rejected, s1, 5, ' big');
    decideSuggestion(rejected, pending(), 'rejected', bob, 2);
    expect(rejected.getText()).toBe('Hello world');
    expect(getSuggestionRanges(rejected)).toEqual([]);
  });
});

describe('suggested deletion', () => {
  it('keeps the text but excludes it from the proposed view', () => {
    const doc = new InMemoryTextDocument('Hello big world');
    suggestDeletion(doc, s1, 5, 4);
    expect(views(doc)).toEqual({
      text: 'Hello big world',
      accepted: 'Hello big world',
      proposed: 'Hello world',
    });
  });

  it('removes the text when accepted and unmarks it when rejected', () => {
    const accepted = new InMemoryTextDocument('Hello big world');
    suggestDeletion(accepted, s1, 5, 4);
    decideSuggestion(accepted, pending(), 'accepted', bob, 2);
    expect(accepted.getText()).toBe('Hello world');

    const rejected = new InMemoryTextDocument('Hello big world');
    suggestDeletion(rejected, s1, 5, 4);
    decideSuggestion(rejected, pending(), 'rejected', bob, 2);
    expect(rejected.getText()).toBe('Hello big world');
    expect(getSuggestionRanges(rejected)).toEqual([]);
  });

  it('removes text inserted by the same suggestion outright', () => {
    const doc = new InMemoryTextDocument('ab');
    suggestInsertion(doc, s1, 1, 'XYZ');
    suggestDeletion(doc, s1, 0, 3);
    expect(doc.getText()).toBe('aZb');
    expect(getSuggestionRanges(doc)).toEqual([
      { offset: 0, length: 1, mark: { id: s1, kind: 'deletion' } },
      { offset: 1, length: 1, mark: { id: s1, kind: 'insertion' } },
    ]);
  });

  it('keeps an existing deletion mark from another suggestion', () => {
    const doc = new InMemoryTextDocument('abcd');
    suggestDeletion(doc, s1, 1, 2);
    suggestDeletion(doc, s2, 0, 4);
    expect(getSuggestionRanges(doc)).toEqual([
      { offset: 0, length: 1, mark: { id: s2, kind: 'deletion' } },
      { offset: 1, length: 2, mark: { id: s1, kind: 'deletion' } },
      { offset: 3, length: 1, mark: { id: s2, kind: 'deletion' } },
    ]);
  });

  it('refuses to overlap text inserted by other suggestions, changing nothing', () => {
    const doc = new InMemoryTextDocument('abc');
    suggestInsertion(doc, s1, 1, 'X');
    suggestInsertion(doc, s3, 3, 'Y');
    expect(() => suggestDeletion(doc, s2, 0, 5)).toThrow(
      expect.objectContaining({ suggestionId: s2, conflictingIds: [s1, s3] }),
    );
    expect(() => suggestDeletion(doc, s2, 0, 5)).toThrow(SuggestionConflictError);
    expect(doc.getText()).toBe('aXbYc');
    expect(getSuggestionRanges(doc).map((r) => r.mark.kind)).toEqual(['insertion', 'insertion']);
  });

  it('removes text inserted by other suggestions when overriding conflicts', () => {
    const doc = new InMemoryTextDocument('ab');
    suggestInsertion(doc, s1, 1, 'XY');
    suggestDeletion(doc, s2, 0, 2, { overrideConflicts: true });
    expect(views(doc)).toEqual({ text: 'aYb', accepted: 'ab', proposed: 'Yb' });
    expect(getSuggestionRanges(doc)).toEqual([
      { offset: 0, length: 1, mark: { id: s2, kind: 'deletion' } },
      { offset: 1, length: 1, mark: { id: s1, kind: 'insertion' } },
    ]);
  });
});

describe('suggested replacement', () => {
  it('pairs a deletion and an insertion under one suggestion', () => {
    const doc = new InMemoryTextDocument('a red fox');
    suggestReplacement(doc, s1, 2, 3, 'brown');
    expect(views(doc)).toEqual({
      text: 'a redbrown fox',
      accepted: 'a red fox',
      proposed: 'a brown fox',
    });

    decideSuggestion(doc, pending(), 'accepted', bob, 2);
    expect(doc.getText()).toBe('a brown fox');
    expect(getSuggestionRanges(doc)).toEqual([]);
  });
});

describe('decisions', () => {
  it('records the decision and refuses to decide twice', () => {
    const doc = new InMemoryTextDocument('Hello world');
    suggestInsertion(doc, s1, 5, '!');
    const decided = decideSuggestion(doc, pending(), 'accepted', bob, 7);
    expect(decided).toMatchObject({ status: 'accepted', decision: { by: bob, at: 7 } });
    expect(() => decideSuggestion(doc, decided, 'rejected', bob, 8)).toThrow(AnnotationError);
  });

  it('only affects the decided suggestion', () => {
    const doc = new InMemoryTextDocument('one two three');
    suggestDeletion(doc, s1, 0, 4);
    suggestInsertion(doc, s2, 13, ' four');
    decideSuggestion(doc, pending(s2), 'rejected', bob, 2);
    expect(views(doc)).toEqual({
      text: 'one two three',
      accepted: 'one two three',
      proposed: 'two three',
    });
  });
});
