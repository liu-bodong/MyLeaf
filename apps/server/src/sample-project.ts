import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectFile, ProjectStore } from '@myleaf/project';

export interface SampleProject {
  /** Folder holding the project files. */
  readonly dir: string;
  readonly name: string;
  /** Main document, relative to `dir`. */
  readonly rootFile: string;
}

/** Files in the sample folder that are about the sample, not part of it. */
const EXCLUDED = new Set(['README.md']);

async function readFolder(dir: string): Promise<ProjectFile[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: ProjectFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    const path = relative(dir, absolute).split(sep).join('/');
    if (EXCLUDED.has(path)) continue;
    files.push({ path: parseProjectPath(path), content: new Uint8Array(await readFile(absolute)) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Creates the sample project from its folder unless a project with its name
 * exists, so a sample that was deleted comes back on the next start.
 * @returns whether the project was created.
 */
export async function seedSampleProject(
  store: ProjectStore,
  sample: SampleProject,
): Promise<boolean> {
  const projects = await store.listProjects();
  if (projects.some((project) => project.name === sample.name)) return false;
  await store.createProject({
    name: sample.name,
    rootFile: parseProjectPath(sample.rootFile),
    files: await readFolder(sample.dir),
  });
  return true;
}
