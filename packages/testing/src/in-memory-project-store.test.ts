import { InMemoryProjectStore } from './in-memory-project-store.js';
import { describeProjectStoreContract } from './project-store.contract.js';

describeProjectStoreContract('InMemoryProjectStore', () =>
  Promise.resolve(new InMemoryProjectStore()),
);
