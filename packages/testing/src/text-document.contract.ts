import { InvalidRangeError } from '@myleaf/doc-model';
import type { TextDocument } from '@myleaf/doc-model';
import { describe, expect, it } from 'vitest';

/**
 * Behaviour every TextDocument implementation must provide. Run it from each
 * adapter's test suite:
 *
 *   describeTextDocumentContract('YjsTextDocument', () => createYjsTextDocument());
 */
export function describeTextDocumentContract(name: string, create: () => TextDocument): void {
  const withText = (text: string): TextDocument => {
    const doc = create();
    doc.insert(0, text);
    return doc;
  };

  describe(`TextDocument contract: ${name}`, () => {
    describe('text editing', () => {
      it('starts empty', () => {
        const doc = create();
        expect(doc.length).toBe(0);
        expect(doc.getText()).toBe('');
      });

      it('inserts and deletes', () => {
        const doc = withText('hello world');
        doc.insert(5, ',');
        doc.delete(0, 1);
        doc.insert(0, 'H');
        expect(doc.getText()).toBe('Hello, world');
        expect(doc.length).toBe(12);
      });

      it('rejects out-of-range operations', () => {
        const doc = withText('abc');
        expect(() => doc.insert(4, 'x')).toThrow(InvalidRangeError);
        expect(() => doc.insert(-1, 'x')).toThrow(InvalidRangeError);
        expect(() => doc.delete(2, 2)).toThrow(InvalidRangeError);
        expect(() => doc.setMark(0, 4, 'k', true)).toThrow(InvalidRangeError);
        expect(() => doc.createAnchor(4, 'left')).toThrow(InvalidRangeError);
      });

      it('applies a transaction', () => {
        const doc = withText('abc');
        doc.transact(() => {
          doc.delete(0, 1);
          doc.insert(2, 'd');
        });
        expect(doc.getText()).toBe('bcd');
      });
    });

    describe('marks', () => {
      it('returns maximal runs per value', () => {
        const doc = withText('abcdef');
        doc.setMark(0, 2, 'k', 'x');
        doc.setMark(2, 1, 'k', 'x');
        doc.setMark(4, 2, 'k', { id: 's1', kind: 'deletion' });
        expect(doc.getMarkedRanges('k')).toEqual([
          { offset: 0, length: 3, value: 'x' },
          { offset: 4, length: 2, value: { id: 's1', kind: 'deletion' } },
        ]);
        expect(doc.getMarkedRanges('other')).toEqual([]);
      });

      it('removes a mark with null and keeps other keys', () => {
        const doc = withText('abcd');
        doc.setMark(0, 4, 'a', 1);
        doc.setMark(0, 4, 'b', 2);
        doc.setMark(1, 2, 'a', null);
        expect(doc.getMarkedRanges('a')).toEqual([
          { offset: 0, length: 1, value: 1 },
          { offset: 3, length: 1, value: 1 },
        ]);
        expect(doc.getMarkedRanges('b')).toEqual([{ offset: 0, length: 4, value: 2 }]);
      });

      it('inserts text with exactly the given marks', () => {
        const doc = withText('ad');
        doc.insert(1, 'bc', { k: 'v' });
        expect(doc.getMarkedRanges('k')).toEqual([{ offset: 1, length: 2, value: 'v' }]);
      });

      it('does not let unmarked text inherit marks from neighbours', () => {
        const doc = create();
        doc.insert(0, 'mm', { k: 'v' });
        doc.insert(2, 'after');
        doc.insert(1, 'inside');
        doc.insert(0, 'before');
        expect(doc.getText()).toBe('beforeminsidemafter');
        expect(doc.getMarkedRanges('k')).toEqual([
          { offset: 6, length: 1, value: 'v' },
          { offset: 13, length: 1, value: 'v' },
        ]);
      });
    });

    describe('anchors', () => {
      it('places right-bias anchors after, and left-bias anchors before, text inserted at them', () => {
        const doc = withText('abcd');
        const right = doc.createAnchor(2, 'right');
        const left = doc.createAnchor(2, 'left');
        doc.insert(2, 'XY');
        expect(doc.resolveAnchor(right)).toBe(4);
        expect(doc.resolveAnchor(left)).toBe(2);
      });

      it('resolves anchors at document boundaries', () => {
        const doc = withText('abc');
        const startRight = doc.createAnchor(0, 'right');
        const startLeft = doc.createAnchor(0, 'left');
        const endRight = doc.createAnchor(3, 'right');
        const endLeft = doc.createAnchor(3, 'left');
        doc.insert(3, 'Z');
        doc.insert(0, 'A');
        expect(doc.resolveAnchor(startRight)).toBe(1);
        expect(doc.resolveAnchor(startLeft)).toBe(0);
        expect(doc.resolveAnchor(endRight)).toBe(5);
        expect(doc.resolveAnchor(endLeft)).toBe(4);
      });

      it('resolves an anchor on a deleted character to the deletion point', () => {
        const doc = withText('abcdef');
        const right = doc.createAnchor(3, 'right');
        const left = doc.createAnchor(3, 'left');
        doc.delete(2, 2);
        expect(doc.getText()).toBe('abef');
        expect(doc.resolveAnchor(right)).toBe(2);
        expect(doc.resolveAnchor(left)).toBe(2);
      });

      it('keeps a [right, left] range from growing at its boundaries', () => {
        const doc = withText('one two three');
        const start = doc.createAnchor(4, 'right');
        const end = doc.createAnchor(7, 'left');
        doc.insert(7, '!');
        doc.insert(4, '>');
        doc.insert(6, 'w');
        expect(doc.getText()).toBe('one >twwo! three');
        const from = doc.resolveAnchor(start);
        const to = doc.resolveAnchor(end);
        expect(from).toBe(5);
        expect(to).toBe(9);
        expect(doc.getText().slice(from ?? 0, to ?? 0)).toBe('twwo');
      });

      it('collapses a range whose text is deleted', () => {
        const doc = withText('one two three');
        const start = doc.createAnchor(4, 'right');
        const end = doc.createAnchor(7, 'left');
        doc.delete(3, 4);
        expect(doc.resolveAnchor(start)).toBe(3);
        expect(doc.resolveAnchor(end)).toBe(3);
      });

      it('does not resolve anchors from another document', () => {
        const anchor = withText('abc').createAnchor(1, 'right');
        expect(withText('abc').resolveAnchor(anchor)).toBeNull();
      });
    });
  });
}
