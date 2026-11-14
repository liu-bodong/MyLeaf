import type { ActorId, EpochMillis, FileId, MarkValue, TextDocument } from '@myleaf/doc-model';
import { AnnotationError } from './errors.js';
import type { SuggestionId } from './ids.js';

/**
 * Suggested changes live in the text as per-character marks (ADR 0005):
 * - insertion: the text is present and marked; rejecting removes it.
 * - deletion: the text stays present and marked; accepting removes it.
 *
 * Invariants: a character carries at most one suggestion mark, and marks
 * exist only for pending suggestions.
 */
export const SUGGESTION_MARK_KEY = 'suggestion';

export type SuggestionKind = 'insertion' | 'deletion';

export interface SuggestionMark {
  readonly id: SuggestionId;
  readonly kind: SuggestionKind;
}

export interface SuggestionRange {
  readonly offset: number;
  readonly length: number;
  readonly mark: SuggestionMark;
}

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

export interface Suggestion {
  readonly id: SuggestionId;
  readonly fileId: FileId;
  readonly authorId: ActorId;
  readonly reviewerIds: readonly ActorId[];
  readonly createdAt: EpochMillis;
  readonly status: SuggestionStatus;
  readonly decision: { readonly by: ActorId; readonly at: EpochMillis } | null;
}

/**
 * Which text to produce, e.g. for compilation.
 * - accepted: pending suggestions are ignored (as if all were rejected).
 * - proposed: pending suggestions are applied (as if all were accepted).
 */
export type ProjectionView = 'accepted' | 'proposed';

/**
 * Thrown when a suggested deletion overlaps text inserted by other pending
 * suggestions. The caller is expected to warn the user and, if they confirm,
 * retry with `overrideConflicts: true`.
 */
export class SuggestionConflictError extends AnnotationError {
  readonly suggestionId: SuggestionId;
  readonly conflictingIds: readonly SuggestionId[];

  constructor(suggestionId: SuggestionId, conflictingIds: readonly SuggestionId[]) {
    super(
      `Suggestion ${suggestionId} overlaps text inserted by suggestion(s) ${conflictingIds.join(', ')}`,
    );
    this.name = 'SuggestionConflictError';
    this.suggestionId = suggestionId;
    this.conflictingIds = conflictingIds;
  }
}

export interface DeletionOptions {
  /**
   * Remove text inserted by other pending suggestions instead of refusing.
   * That text is taken out of those suggestions. Default: `false`.
   */
  readonly overrideConflicts?: boolean;
}

export function createSuggestion(input: {
  readonly id: SuggestionId;
  readonly fileId: FileId;
  readonly authorId: ActorId;
  readonly reviewerIds: readonly ActorId[];
  readonly at: EpochMillis;
}): Suggestion {
  return {
    id: input.id,
    fileId: input.fileId,
    authorId: input.authorId,
    reviewerIds: [...new Set(input.reviewerIds)],
    createdAt: input.at,
    status: 'pending',
    decision: null,
  };
}

export function getSuggestionRanges(doc: TextDocument): SuggestionRange[] {
  return doc.getMarkedRanges(SUGGESTION_MARK_KEY).map(({ offset, length, value }) => ({
    offset,
    length,
    mark: parseSuggestionMark(value),
  }));
}

export function suggestInsertion(
  doc: TextDocument,
  id: SuggestionId,
  offset: number,
  text: string,
): void {
  doc.insert(offset, text, { [SUGGESTION_MARK_KEY]: toMarkValue({ id, kind: 'insertion' }) });
}

/**
 * Marks `[offset, offset + length)` as suggested for deletion. Text that this
 * same suggestion inserted is removed outright (like backspacing over your
 * own typing); text already suggested for deletion keeps its existing mark.
 *
 * @throws SuggestionConflictError if the range contains text inserted by
 *   other pending suggestions and `overrideConflicts` is not set. Nothing is
 *   changed in that case.
 */
export function suggestDeletion(
  doc: TextDocument,
  id: SuggestionId,
  offset: number,
  length: number,
  options: DeletionOptions = {},
): void {
  markDeletion(doc, id, offset, length, options);
}

/**
 * A deletion of `[offset, offset + length)` followed by the inserted `text`,
 * as one suggestion. Conflicts are handled as in {@link suggestDeletion}.
 */
export function suggestReplacement(
  doc: TextDocument,
  id: SuggestionId,
  offset: number,
  length: number,
  text: string,
  options: DeletionOptions = {},
): void {
  doc.transact(() => {
    const remaining = markDeletion(doc, id, offset, length, options);
    suggestInsertion(doc, id, offset + remaining, text);
  });
}

/** Accepts or rejects a pending suggestion, updating the text accordingly. */
export function decideSuggestion(
  doc: TextDocument,
  suggestion: Suggestion,
  decision: Exclude<SuggestionStatus, 'pending'>,
  by: ActorId,
  at: EpochMillis,
): Suggestion {
  if (suggestion.status !== 'pending') {
    throw new AnnotationError(`Suggestion ${suggestion.id} is already ${suggestion.status}`);
  }
  const ranges = getSuggestionRanges(doc).filter((range) => range.mark.id === suggestion.id);
  doc.transact(() => {
    // Back to front, so removing text does not shift ranges still to visit.
    for (const { offset, length, mark } of ranges.reverse()) {
      const removeText = (mark.kind === 'insertion') === (decision === 'rejected');
      if (removeText) {
        doc.delete(offset, length);
      } else {
        doc.setMark(offset, length, SUGGESTION_MARK_KEY, null);
      }
    }
  });
  return { ...suggestion, status: decision, decision: { by, at } };
}

export function projectText(doc: TextDocument, view: ProjectionView): string {
  const excludedKind: SuggestionKind = view === 'accepted' ? 'insertion' : 'deletion';
  const text = doc.getText();
  let result = '';
  let cursor = 0;
  for (const { offset, length, mark } of getSuggestionRanges(doc)) {
    if (mark.kind === excludedKind) {
      result += text.slice(cursor, offset);
      cursor = offset + length;
    }
  }
  return result + text.slice(cursor);
}

/** @returns the length of the range that remains in the document. */
function markDeletion(
  doc: TextDocument,
  id: SuggestionId,
  offset: number,
  length: number,
  { overrideConflicts = false }: DeletionOptions,
): number {
  const end = offset + length;
  const overlapping = getSuggestionRanges(doc)
    .map((range) => ({
      mark: range.mark,
      offset: Math.max(range.offset, offset),
      end: Math.min(range.offset + range.length, end),
    }))
    .filter((range) => range.offset < range.end);

  const conflictingIds = [
    ...new Set(
      overlapping
        .filter(({ mark }) => mark.kind === 'insertion' && mark.id !== id)
        .map(({ mark }) => mark.id),
    ),
  ];
  if (conflictingIds.length > 0 && !overrideConflicts) {
    throw new SuggestionConflictError(id, conflictingIds);
  }

  // Segments of the range, in document order, with their existing mark (if any).
  const segments: { offset: number; end: number; mark: SuggestionMark | null }[] = [];
  let cursor = offset;
  for (const range of overlapping) {
    if (cursor < range.offset) {
      segments.push({ offset: cursor, end: range.offset, mark: null });
    }
    segments.push(range);
    cursor = range.end;
  }
  if (cursor < end) {
    segments.push({ offset: cursor, end, mark: null });
  }

  let removed = 0;
  doc.transact(() => {
    for (const segment of segments.reverse()) {
      const segmentLength = segment.end - segment.offset;
      if (segment.mark === null) {
        doc.setMark(
          segment.offset,
          segmentLength,
          SUGGESTION_MARK_KEY,
          toMarkValue({ id, kind: 'deletion' }),
        );
      } else if (segment.mark.kind === 'insertion') {
        doc.delete(segment.offset, segmentLength);
        removed += segmentLength;
      }
    }
  });
  return length - removed;
}

function toMarkValue(mark: SuggestionMark): MarkValue {
  return { id: mark.id, kind: mark.kind };
}

function parseSuggestionMark(value: MarkValue): SuggestionMark {
  if (
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    (value.kind === 'insertion' || value.kind === 'deletion')
  ) {
    return { id: value.id as SuggestionId, kind: value.kind };
  }
  throw new AnnotationError(`Malformed suggestion mark: ${JSON.stringify(value)}`);
}
