import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProjectPath } from '@myleaf/project';
import { InMemoryProjectStore } from '@myleaf/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedSampleProject } from './sample-project.js';

describe('seedSampleProject', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'myleaf-sample-'));
    await writeFile(join(dir, 'paper.tex'), '\\input{sections/intro}');
    await writeFile(join(dir, 'README.md'), 'About the sample');
    await mkdir(join(dir, 'sections'));
    await writeFile(join(dir, 'sections', 'intro.tex'), 'Intro');
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('creates the project from the folder, without its README', async () => {
    const store = new InMemoryProjectStore();
    const sample = { dir, name: 'Sample', rootFile: 'paper.tex' };
    expect(await seedSampleProject(store, sample)).toBe(true);

    const [project] = await store.listProjects();
    expect(project?.name).toBe('Sample');
    expect(project?.rootFile).toBe('paper.tex');
    const paths = (await store.listFiles(project!.id)).map((file) => file.path);
    expect(paths).toEqual(['paper.tex', 'sections/intro.tex']);
    const intro = await store.readFile(project!.id, parseProjectPath('sections/intro.tex'));
    expect(new TextDecoder().decode(intro)).toBe('Intro');
  });

  it('does nothing when a project with the name exists', async () => {
    const store = new InMemoryProjectStore();
    const sample = { dir, name: 'Sample', rootFile: 'paper.tex' };
    await seedSampleProject(store, sample);
    expect(await seedSampleProject(store, sample)).toBe(false);
    expect(await store.listProjects()).toHaveLength(1);
  });
});
