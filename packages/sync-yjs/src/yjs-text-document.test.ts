import { describeTextDocumentContract } from '@myleaf/testing';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { YjsTextDocument } from './yjs-text-document.js';

const TEXT_NAME = 'content';

const createDocument = (doc = new Y.Doc()): YjsTextDocument =>
  new YjsTextDocument(doc.getText(TEXT_NAME));

/** Exchanges all missing updates between two replicas. */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describeTextDocumentContract('YjsTextDocument', () => createDocument());

describe('YjsTextDocument replication', () => {
  it('rejects a Y.Text that is not part of a Y.Doc', () => {
    expect(() => new YjsTextDocument(new Y.Text())).toThrow();
  });

  it('resolves an anchor on a replica that received the update', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = createDocument(docA);
    const b = createDocument(docB);
    a.insert(0, 'shared text');
    sync(docA, docB);

    const anchor = a.createAnchor(7, 'right');
    expect(b.resolveAnchor(anchor)).toBe(7);
  });

  it('keeps anchored ranges and marks consistent under concurrent edits', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = createDocument(docA);
    const b = createDocument(docB);
    a.insert(0, 'one two three');
    sync(docA, docB);

    const start = a.createAnchor(4, 'right');
    const end = a.createAnchor(7, 'left');
    a.setMark(4, 3, 'k', 'v');
    b.insert(0, 'zero ');
    b.insert(b.length, ' four');
    sync(docA, docB);

    for (const replica of [a, b]) {
      expect(replica.getText()).toBe('zero one two three four');
      expect(replica.resolveAnchor(start)).toBe(9);
      expect(replica.resolveAnchor(end)).toBe(12);
      expect(replica.getMarkedRanges('k')).toEqual([{ offset: 9, length: 3, value: 'v' }]);
    }
  });
});
