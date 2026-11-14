import type { Brand } from './brand.js';

/**
 * A serialized position in a text document that follows the surrounding text
 * through local and remote edits. Opaque: only the TextDocument
 * implementation that created it can resolve it.
 */
export type Anchor = Brand<string, 'Anchor'>;

/**
 * Which neighbouring character an anchor at an offset attaches to.
 *
 * - `right`: attaches to the character after the offset. Text inserted at the
 *   anchor's position ends up before the anchor.
 * - `left`: attaches to the character before the offset. Text inserted at the
 *   anchor's position ends up after the anchor.
 *
 * A range `[start, end)` that must not grow when text is typed at its
 * boundaries uses `right` for start and `left` for end.
 */
export type AnchorBias = 'left' | 'right';

export type MarkScalar = string | number | boolean;

/** Per-character metadata value. Flat so implementations can compare values cheaply. */
export type MarkValue = MarkScalar | Readonly<Record<string, MarkScalar>>;

export type Marks = Readonly<Record<string, MarkValue>>;

/** A maximal run of consecutive characters carrying the same value for one mark key. */
export interface MarkedRange {
  readonly offset: number;
  readonly length: number;
  readonly value: MarkValue;
}

/**
 * Port: a collaboratively edited plain-text document with anchors and
 * per-character marks. Offsets are UTF-16 code unit indices, matching
 * JavaScript strings and CodeMirror.
 *
 * Domain code depends on this interface only; sync libraries are adapters.
 * Every implementation must pass the contract suite in `@myleaf/testing`.
 */
export interface TextDocument {
  readonly length: number;

  getText(): string;

  /**
   * Inserts text carrying exactly `marks` (none when omitted). Inserted text
   * never inherits marks from neighbouring characters.
   */
  insert(offset: number, text: string, marks?: Marks): void;

  delete(offset: number, length: number): void;

  /** Sets (or with `null`, removes) one mark key on a range. */
  setMark(offset: number, length: number, key: string, value: MarkValue | null): void;

  /** Ranges carrying `key`, in document order. */
  getMarkedRanges(key: string): readonly MarkedRange[];

  createAnchor(offset: number, bias: AnchorBias): Anchor;

  /**
   * Current offset of an anchor. If the attached character was deleted, the
   * anchor resolves to where that character used to be. Returns `null` if the
   * anchor cannot be resolved in this document.
   */
  resolveAnchor(anchor: Anchor): number | null;

  /** Runs `fn` as one atomic change; observers and peers see a single update. */
  transact(fn: () => void): void;
}

export class InvalidRangeError extends RangeError {
  constructor(offset: number, length: number, documentLength: number) {
    super(`Range [${offset}, ${offset + length}) is outside document of length ${documentLength}`);
    this.name = 'InvalidRangeError';
  }
}

/** Shared argument validation for TextDocument implementations. */
export function assertRange(offset: number, length: number, documentLength: number): void {
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > documentLength
  ) {
    throw new InvalidRangeError(offset, length, documentLength);
  }
}

/** Equality for mark values: scalars by identity, records by their (flat) entries. */
export function markValuesEqual(a: MarkValue, b: MarkValue): boolean {
  if (typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }
  const keysA = Object.keys(a);
  return keysA.length === Object.keys(b).length && keysA.every((key) => a[key] === b[key]);
}
