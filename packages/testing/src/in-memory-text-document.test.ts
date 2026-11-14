import { InMemoryTextDocument } from './in-memory-text-document.js';
import { describeTextDocumentContract } from './text-document.contract.js';

describeTextDocumentContract('InMemoryTextDocument', () => new InMemoryTextDocument());
