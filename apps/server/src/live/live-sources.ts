import { withDraftImages } from '@myleaf/compile-texlive';
import type { ImageCache } from '@myleaf/compile-texlive';
import type { LiveEngine } from '@myleaf/live-preview';
import type { ProjectFile, ProjectSummary } from '@myleaf/project';

/**
 * Applies a project's image options (`draftImages`, `reuseImages`) to the
 * files a live preview typesets, as TexLiveCompileBackend does for compiles.
 * Converted images exist for pdfLaTeX only, so they are used only when the
 * live engine is pdfLaTeX. Changing either option takes a new session.
 */
export class LiveSources {
  readonly #images: ImageCache | null;
  readonly #engine: LiveEngine;

  constructor(images: ImageCache | null, engine: LiveEngine) {
    this.#images = images;
    this.#engine = engine;
  }

  /** The file as the session should see it; synchronous, so edits keep their order. */
  text(project: ProjectSummary, file: ProjectFile): ProjectFile {
    return project.settings.draftImages && file.path === project.rootFile
      ? { path: file.path, content: withDraftImages(file.content) }
      : file;
  }

  /**
   * The files as the session should see them, with converted images where
   * they exist, and the images still to convert: `convert` converts them and
   * gives each one converted to `onConverted`.
   */
  async files(
    project: ProjectSummary,
    files: readonly ProjectFile[],
  ): Promise<{
    files: ProjectFile[];
    convert: (onConverted: (converted: ProjectFile, original: ProjectFile) => void) => void;
  }> {
    const texts = files.map((file) => this.text(project, file));
    const images = this.#images;
    if (images === null || !this.#reuse(project)) return { files: texts, convert: () => {} };
    const applied = await images.apply(texts);
    return {
      files: applied.files,
      convert: (onConverted) => {
        if (applied.pending.length === 0) return;
        void images
          .convertPending(applied.pending)
          .then(() => images.apply(applied.pending))
          .then(({ files: converted }) => {
            converted.forEach((file, i) => {
              const original = applied.pending[i]!;
              if (file !== original) onConverted(file, original);
            });
          })
          .catch((error: unknown) => console.error('Converting images failed:', error));
      },
    };
  }

  #reuse(project: ProjectSummary): boolean {
    return (
      project.settings.reuseImages && !project.settings.draftImages && this.#engine === 'pdflatex'
    );
  }
}
