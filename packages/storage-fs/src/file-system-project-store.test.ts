import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import { describeProjectStoreContract } from '@myleaf/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { FileSystemProjectStore } from './file-system-project-store.js';

const roots: string[] = [];

async function createStore(): Promise<FileSystemProjectStore> {
  const root = await mkdtemp(join(tmpdir(), 'myleaf-store-'));
  roots.push(root);
  return FileSystemProjectStore.open(root);
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describeProjectStoreContract('FileSystemProjectStore', createStore);

describe('FileSystemProjectStore', () => {
  it('treats ids that are not UUIDs as unknown projects', async () => {
    const store = await createStore();
    expect(await store.getProject(ProjectId('../etc'))).toBeNull();
  });

  it('persists projects across store instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'myleaf-store-'));
    roots.push(root);
    const first = await FileSystemProjectStore.open(root);
    const project = await first.createProject({
      name: 'Kept',
      rootFile: parseProjectPath('main.tex'),
      files: [],
    });
    const second = await FileSystemProjectStore.open(root);
    expect(await second.getProject(project.id)).toEqual(project);
  });
});
