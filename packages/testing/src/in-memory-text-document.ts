import { assertRange, markValuesEqual } from '@myleaf/doc-model';
import type {
  Anchor,
  AnchorBias,
  MarkValue,
  MarkedRange,
  Marks,
  TextDocument,
} from '@myleaf/doc-model';

interface Item {
  readonly id: number;
  readonly char: string;
  deleted: boolean;
  marks: Map<string, MarkValue>;
}

/** `start`/`end` are the document boundaries; a number is an item id. */
type AnchorTarget = number | 'start' | 'end';

interface AnchorData {
  readonly doc: number;
  readonly target: AnchorTarget;
  readonly bias: AnchorBias;
}

let nextDocumentId = 0;

/**
 * Single-replica reference implementation of the TextDocument port, used as a
 * test double for domain code. Deleted characters are kept as tombstones so
 * anchors attached to them stay resolvable, mirroring CRDT behaviour.
 */
export class InMemoryTextDocument implements TextDocument {
  readonly #documentId = nextDocumentId++;
  readonly #items: Item[] = [];
  #nextItemId = 0;

  constructor(initialText = '') {
    this.insert(0, initialText);
  }

  get length(): number {
    return this.#visible().length;
  }

  getText(): string {
    return this.#visible()
      .map((item) => item.char)
      .join('');
  }

  insert(offset: number, text: string, marks: Marks = {}): void {
    assertRange(offset, 0, this.length);
    const visible = this.#visible();
    const next = visible[offset];
    const index = next === undefined ? this.#items.length : this.#items.indexOf(next);
    const created = Array.from(text, (char): Item => ({
      id: this.#nextItemId++,
      char,
      deleted: false,
      marks: new Map(Object.entries(marks)),
    }));
    this.#items.splice(index, 0, ...created);
  }

  delete(offset: number, length: number): void {
    assertRange(offset, length, this.length);
    for (const item of this.#visible().slice(offset, offset + length)) {
      item.deleted = true;
    }
  }

  setMark(offset: number, length: number, key: string, value: MarkValue | null): void {
    assertRange(offset, length, this.length);
    for (const item of this.#visible().slice(offset, offset + length)) {
      if (value === null) {
        item.marks.delete(key);
      } else {
        item.marks.set(key, value);
      }
    }
  }

  getMarkedRanges(key: string): readonly MarkedRange[] {
    const ranges: MarkedRange[] = [];
    let current: { offset: number; length: number; value: MarkValue } | undefined;
    this.#visible().forEach((item, offset) => {
      const value = item.marks.get(key);
      if (current !== undefined && value !== undefined && markValuesEqual(current.value, value)) {
        current.length += 1;
        return;
      }
      if (current !== undefined) {
        ranges.push(current);
      }
      current = value === undefined ? undefined : { offset, length: 1, value };
    });
    if (current !== undefined) {
      ranges.push(current);
    }
    return ranges;
  }

  createAnchor(offset: number, bias: AnchorBias): Anchor {
    assertRange(offset, 0, this.length);
    const visible = this.#visible();
    const neighbour = bias === 'right' ? visible[offset] : visible[offset - 1];
    const target: AnchorTarget = neighbour?.id ?? (bias === 'right' ? 'end' : 'start');
    const data: AnchorData = { doc: this.#documentId, target, bias };
    return JSON.stringify(data) as Anchor;
  }

  resolveAnchor(anchor: Anchor): number | null {
    const data = JSON.parse(anchor) as AnchorData;
    if (data.doc !== this.#documentId) {
      return null;
    }
    if (data.target === 'start') {
      return 0;
    }
    if (data.target === 'end') {
      return this.length;
    }
    const index = this.#items.findIndex((item) => item.id === data.target);
    const item = this.#items[index];
    if (item === undefined) {
      return null;
    }
    const visibleBefore = this.#items.slice(0, index).filter((i) => !i.deleted).length;
    return data.bias === 'left' && !item.deleted ? visibleBefore + 1 : visibleBefore;
  }

  transact(fn: () => void): void {
    fn();
  }

  #visible(): Item[] {
    return this.#items.filter((item) => !item.deleted);
  }
}
