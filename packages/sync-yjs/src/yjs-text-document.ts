import { assertRange, markValuesEqual } from '@myleaf/doc-model';
import type {
  Anchor,
  AnchorBias,
  MarkValue,
  MarkedRange,
  Marks,
  TextDocument,
} from '@myleaf/doc-model';
import * as Y from 'yjs';

/** The shape `Y.Text#toDelta()` produces for a text without embeds. */
interface TextDeltaOp {
  readonly insert: string;
  readonly attributes?: Readonly<Record<string, MarkValue>>;
}

/** Yjs relative-position association: >= 0 attaches to the right item, < 0 to the left. */
const ASSOC: Record<AnchorBias, number> = { right: 0, left: -1 };

/**
 * TextDocument adapter over a `Y.Text`. Marks are Yjs formatting attributes;
 * anchors are serialized Yjs relative positions.
 */
export class YjsTextDocument implements TextDocument {
  readonly #text: Y.Text;
  readonly #doc: Y.Doc;

  constructor(text: Y.Text) {
    if (text.doc === null) {
      throw new Error('Y.Text must be integrated into a Y.Doc');
    }
    this.#text = text;
    this.#doc = text.doc;
  }

  get length(): number {
    return this.#text.length;
  }

  getText(): string {
    return this.#text.toJSON();
  }

  insert(offset: number, text: string, marks: Marks = {}): void {
    assertRange(offset, 0, this.length);
    // Y.Text#insert copies neighbouring formatting when attributes are
    // omitted, and mutates the object it is given: always pass a fresh one.
    this.#text.insert(offset, text, { ...marks });
  }

  delete(offset: number, length: number): void {
    assertRange(offset, length, this.length);
    this.#text.delete(offset, length);
  }

  setMark(offset: number, length: number, key: string, value: MarkValue | null): void {
    assertRange(offset, length, this.length);
    this.#text.format(offset, length, { [key]: value });
  }

  getMarkedRanges(key: string): readonly MarkedRange[] {
    const ranges: MarkedRange[] = [];
    let offset = 0;
    for (const op of this.#text.toDelta() as TextDeltaOp[]) {
      const value = op.attributes?.[key];
      const previous = ranges.at(-1);
      if (value !== undefined) {
        if (
          previous &&
          previous.offset + previous.length === offset &&
          markValuesEqual(previous.value, value)
        ) {
          ranges[ranges.length - 1] = { ...previous, length: previous.length + op.insert.length };
        } else {
          ranges.push({ offset, length: op.insert.length, value });
        }
      }
      offset += op.insert.length;
    }
    return ranges;
  }

  createAnchor(offset: number, bias: AnchorBias): Anchor {
    assertRange(offset, 0, this.length);
    const position = Y.createRelativePositionFromTypeIndex(this.#text, offset, ASSOC[bias]);
    return JSON.stringify(Y.relativePositionToJSON(position)) as Anchor;
  }

  resolveAnchor(anchor: Anchor): number | null {
    const position = Y.createRelativePositionFromJSON(JSON.parse(anchor));
    const absolute = Y.createAbsolutePositionFromRelativePosition(position, this.#doc);
    return absolute?.type === this.#text ? absolute.index : null;
  }

  transact(fn: () => void): void {
    this.#doc.transact(fn);
  }
}
