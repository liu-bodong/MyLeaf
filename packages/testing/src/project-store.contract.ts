import { ProjectId } from '@myleaf/doc-model';
import {
  FileAlreadyExistsError,
  FileNotFoundError,
  InvalidProjectNameError,
  PathConflictError,
  ProjectNotFoundError,
  parseProjectPath,
} from '@myleaf/project';
import type { ProjectStore } from '@myleaf/project';
import { describe, expect, it } from 'vitest';

const path = parseProjectPath;
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const unknownId = ProjectId('does-not-exist');

/**
 * Behaviour every ProjectStore implementation must provide. `create` must
 * return a new, empty store for each call.
 */
export function describeProjectStoreContract(
  name: string,
  create: () => Promise<ProjectStore>,
): void {
  const withProject = async () => {
    const store = await create();
    const project = await store.createProject({
      name: 'Paper',
      rootFile: path('main.tex'),
      files: [{ path: path('main.tex'), content: bytes('\\documentclass{article}') }],
    });
    return { store, id: project.id };
  };

  describe(`ProjectStore contract: ${name}`, () => {
    describe('projects', () => {
      it('starts empty', async () => {
        expect(await (await create()).listProjects()).toEqual([]);
      });

      it('creates a project with its files', async () => {
        const store = await create();
        const project = await store.createProject({
          name: '  Thesis ',
          rootFile: path('main.tex'),
          files: [
            { path: path('main.tex'), content: bytes('root') },
            { path: path('chapters/intro.tex'), content: bytes('intro') },
          ],
        });
        expect(project).toMatchObject({ name: 'Thesis', rootFile: 'main.tex' });
        expect(typeof project.createdAt).toBe('number');
        expect(await store.getProject(project.id)).toEqual(project);
        expect(await store.listProjects()).toEqual([project]);
        expect(await store.listFiles(project.id)).toEqual([
          { path: 'chapters/intro.tex', size: 5 },
          { path: 'main.tex', size: 4 },
        ]);
      });

      it('applies default settings and merges updates', async () => {
        const store = await create();
        const project = await store.createProject({
          name: 'P',
          rootFile: path('main.tex'),
          files: [],
          settings: { autoCompile: true },
        });
        expect(project.settings).toEqual({
          autoCompile: true,
          precompilePreamble: true,
          livePreview: false,
          liveSnapshots: null,
          reuseImages: true,
          draftImages: false,
        });
        const updated = await store.updateProject(project.id, {
          settings: { precompilePreamble: false },
        });
        expect(updated.settings).toEqual({
          autoCompile: true,
          precompilePreamble: false,
          livePreview: false,
          liveSnapshots: null,
          reuseImages: true,
          draftImages: false,
        });
        expect((await store.getProject(project.id))?.settings).toEqual(updated.settings);
      });

      it('rejects blank names', async () => {
        const store = await create();
        await expect(
          store.createProject({ name: ' ', rootFile: path('main.tex'), files: [] }),
        ).rejects.toThrow(InvalidProjectNameError);
      });

      it('updates name and root file', async () => {
        const { store, id } = await withProject();
        const updated = await store.updateProject(id, { name: 'Renamed', rootFile: path('b.tex') });
        expect(updated).toMatchObject({ id, name: 'Renamed', rootFile: 'b.tex' });
        expect(await store.getProject(id)).toEqual(updated);
      });

      it('deletes a project and its files', async () => {
        const { store, id } = await withProject();
        await store.deleteProject(id);
        expect(await store.getProject(id)).toBeNull();
        await expect(store.listFiles(id)).rejects.toThrow(ProjectNotFoundError);
      });

      it('rejects unknown project ids', async () => {
        const store = await create();
        expect(await store.getProject(unknownId)).toBeNull();
        await expect(store.updateProject(unknownId, { name: 'x' })).rejects.toThrow(
          ProjectNotFoundError,
        );
        await expect(store.deleteProject(unknownId)).rejects.toThrow(ProjectNotFoundError);
        await expect(store.listFiles(unknownId)).rejects.toThrow(ProjectNotFoundError);
        await expect(store.readFile(unknownId, path('a'))).rejects.toThrow(ProjectNotFoundError);
        await expect(store.writeFile(unknownId, path('a'), bytes(''))).rejects.toThrow(
          ProjectNotFoundError,
        );
      });
    });

    describe('files', () => {
      it('writes, overwrites and reads binary content', async () => {
        const { store, id } = await withProject();
        const binary = new Uint8Array([0, 255, 10, 0]);
        await store.writeFile(id, path('img/a.bin'), bytes('old'));
        await store.writeFile(id, path('img/a.bin'), binary);
        expect(await store.readFile(id, path('img/a.bin'))).toEqual(binary);
        expect(await store.listFiles(id)).toContainEqual({ path: 'img/a.bin', size: 4 });
      });

      it('does not share buffers with callers', async () => {
        const { store, id } = await withProject();
        const content = bytes('abc');
        await store.writeFile(id, path('a.txt'), content);
        content[0] = 0;
        const read = await store.readFile(id, path('a.txt'));
        read[1] = 0;
        expect(text(await store.readFile(id, path('a.txt')))).toBe('abc');
      });

      it('rejects reads and deletes of missing files', async () => {
        const { store, id } = await withProject();
        await expect(store.readFile(id, path('nope.tex'))).rejects.toThrow(FileNotFoundError);
        await expect(store.deleteFile(id, path('nope.tex'))).rejects.toThrow(FileNotFoundError);
        await expect(store.readFile(id, path('main.tex/x'))).rejects.toThrow(FileNotFoundError);
      });

      it('rejects using a path as both file and directory', async () => {
        const { store, id } = await withProject();
        await store.writeFile(id, path('dir/a.tex'), bytes('a'));
        await expect(store.writeFile(id, path('dir'), bytes('x'))).rejects.toThrow(
          PathConflictError,
        );
        await expect(store.writeFile(id, path('main.tex/b.tex'), bytes('x'))).rejects.toThrow(
          PathConflictError,
        );
      });

      it('drops empty directories after deleting their last file', async () => {
        const { store, id } = await withProject();
        await store.writeFile(id, path('dir/sub/a.tex'), bytes('a'));
        await store.deleteFile(id, path('dir/sub/a.tex'));
        expect(await store.listFiles(id)).toEqual([{ path: 'main.tex', size: 23 }]);
        await store.writeFile(id, path('dir'), bytes('now a file'));
        expect(text(await store.readFile(id, path('dir')))).toBe('now a file');
      });

      it('moves files', async () => {
        const { store, id } = await withProject();
        await store.writeFile(id, path('a.tex'), bytes('a'));
        await store.moveFile(id, path('a.tex'), path('moved/b.tex'));
        expect(text(await store.readFile(id, path('moved/b.tex')))).toBe('a');
        await expect(store.readFile(id, path('a.tex'))).rejects.toThrow(FileNotFoundError);
      });

      it('rejects moves from missing files or onto existing ones', async () => {
        const { store, id } = await withProject();
        await store.writeFile(id, path('a.tex'), bytes('a'));
        await expect(store.moveFile(id, path('nope.tex'), path('b.tex'))).rejects.toThrow(
          FileNotFoundError,
        );
        await expect(store.moveFile(id, path('a.tex'), path('main.tex'))).rejects.toThrow(
          FileAlreadyExistsError,
        );
        await expect(store.moveFile(id, path('a.tex'), path('main.tex/a.tex'))).rejects.toThrow(
          PathConflictError,
        );
        expect(text(await store.readFile(id, path('a.tex')))).toBe('a');
      });
    });
  });
}
