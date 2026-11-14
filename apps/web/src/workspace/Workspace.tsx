import type { FileEntryDto, ProjectDto } from '@myleaf/api';
import type { ProjectSettings } from '@myleaf/project';
import type { CompileResult, Diagnostic, PdfPoint, PdfRect } from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectPath } from '@myleaf/project';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { LatexEditor } from '../editor/LatexEditor.js';
import type { LatexEditorHandle } from '../editor/LatexEditor.js';
import { PdfViewer } from '../pdf/PdfViewer.js';
import { Diagnostics } from './Diagnostics.js';
import { FileTree } from './FileTree.js';

/** Delay between the last keystroke and saving. */
const SAVE_DELAY_MS = 800;
/** Pause in editing after which auto-compile starts. */
const AUTO_COMPILE_DELAY_MS = 1000;

type OpenDocument =
  | { readonly kind: 'text'; readonly path: ProjectPath; readonly text: string }
  | { readonly kind: 'binary'; readonly path: ProjectPath; readonly size: number };

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

interface PendingSave {
  readonly path: ProjectPath;
  text: string;
  timer: ReturnType<typeof setTimeout>;
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function Workspace({ projectId }: { readonly projectId: ProjectId }) {
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [files, setFiles] = useState<readonly FileEntryDto[]>([]);
  const [document, setDocument] = useState<OpenDocument | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [compiling, setCompiling] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [highlights, setHighlights] = useState<readonly PdfRect[]>([]);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<LatexEditorHandle>(null);
  const pendingSave = useRef<PendingSave | null>(null);
  /** Line to move to once a newly opened document is in the editor. */
  const pendingLine = useRef<number | null>(null);
  const compilingRef = useRef(false);
  /** A compile was requested while one was running: run once more afterwards. */
  const compileQueued = useRef(false);
  const autoCompileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const report = useCallback((reason: unknown) => setError(errorMessage(reason)), []);

  const refreshFiles = useCallback(async () => {
    setFiles(await api.listFiles(projectId));
  }, [projectId]);

  /** Writes any unsaved edit immediately. */
  const flushSave = useCallback(async () => {
    const pending = pendingSave.current;
    if (pending === null) return;
    clearTimeout(pending.timer);
    pendingSave.current = null;
    setSaveState('saving');
    try {
      await api.writeFile(projectId, pending.path, pending.text);
      setSaveState(pendingSave.current === null ? 'saved' : 'unsaved');
    } catch (reason) {
      setSaveState('error');
      throw reason;
    }
  }, [projectId]);

  const openFile = useCallback(
    async (path: ProjectPath, line?: number) => {
      if (document?.path === path) {
        if (line !== undefined) editorRef.current?.goToLine(line);
        return;
      }
      await flushSave();
      const bytes = await api.readFile(projectId, path);
      const text = decodeText(bytes);
      pendingLine.current = line ?? null;
      setDocument(
        text === null
          ? { kind: 'binary', path, size: bytes.byteLength }
          : { kind: 'text', path, text },
      );
    },
    [document?.path, flushSave, projectId],
  );

  useEffect(() => {
    if (pendingLine.current !== null) {
      editorRef.current?.goToLine(pendingLine.current);
      pendingLine.current = null;
    }
  }, [document]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await api.getProject(projectId);
      const entries = await api.listFiles(projectId);
      if (cancelled) return;
      setProject(loaded);
      setFiles(entries);
      if (entries.some((entry) => entry.path === loaded.rootFile)) {
        const text = decodeText(await api.readFile(projectId, loaded.rootFile));
        if (!cancelled && text !== null) {
          setDocument({ kind: 'text', path: loaded.rootFile, text });
        }
      }
      const pdf = await fetch(api.pdfUrl(projectId, 0), { method: 'HEAD' });
      if (!cancelled && pdf.ok) setPdfVersion(1);
    })().catch(report);
    return () => {
      cancelled = true;
    };
  }, [projectId, report]);

  /** Compiles; a request during a running compile triggers one more compile afterwards. */
  const compile = useCallback(async () => {
    if (compilingRef.current) {
      compileQueued.current = true;
      return;
    }
    compilingRef.current = true;
    setCompiling(true);
    try {
      do {
        compileQueued.current = false;
        await flushSave();
        const compiled = await api.compile(projectId);
        setResult(compiled);
        setHighlights([]);
        if (compiled.hasPdf) setPdfVersion((version) => version + 1);
      } while (compileQueued.current);
    } catch (reason) {
      report(reason);
    } finally {
      compilingRef.current = false;
      setCompiling(false);
    }
  }, [flushSave, projectId, report]);

  useEffect(
    () => () => {
      if (autoCompileTimer.current !== null) clearTimeout(autoCompileTimer.current);
    },
    [],
  );

  const handleChange = useCallback(
    (text: string) => {
      if (document?.kind !== 'text') return;
      const pending = pendingSave.current;
      if (pending !== null) clearTimeout(pending.timer);
      pendingSave.current = {
        path: document.path,
        text,
        timer: setTimeout(() => void flushSave().catch(report), SAVE_DELAY_MS),
      };
      setSaveState('unsaved');
      if (project?.settings.autoCompile) {
        if (autoCompileTimer.current !== null) clearTimeout(autoCompileTimer.current);
        autoCompileTimer.current = setTimeout(() => void compile(), AUTO_COMPILE_DELAY_MS);
      }
    },
    [compile, document, flushSave, project?.settings.autoCompile, report],
  );

  /** Applies a settings change immediately and reverts it if saving fails. */
  const updateSettings = async (settings: Partial<ProjectSettings>) => {
    const previous = project;
    setProject(
      (current) => current && { ...current, settings: { ...current.settings, ...settings } },
    );
    try {
      setProject(await api.updateProject(projectId, { settings }));
    } catch (reason) {
      setProject(previous);
      throw reason;
    }
  };

  const showInPdf = useCallback(async () => {
    if (document?.kind !== 'text') return;
    const line = editorRef.current?.cursorLine() ?? 1;
    const { rects } = await api.forwardSearch(projectId, {
      file: document.path,
      line,
      column: null,
    });
    setHighlights(rects);
  }, [document, projectId]);

  const inverseSearch = useCallback(
    async (point: PdfPoint) => {
      const { location } = await api.inverseSearch(projectId, point);
      if (location !== null) await openFile(location.file, location.line);
    },
    [openFile, projectId],
  );

  const selectDiagnostic = useCallback(
    (diagnostic: Diagnostic) => {
      if (diagnostic.line === null) return;
      const file = diagnostic.file ?? project?.rootFile;
      if (file !== undefined) void openFile(file, diagnostic.line).catch(report);
    },
    [openFile, project?.rootFile, report],
  );

  const askForPath = (message: string, initial: string): ProjectPath | null => {
    const answer = window.prompt(message, initial);
    if (answer === null) return null;
    try {
      return parseProjectPath(answer.trim());
    } catch (reason) {
      report(reason);
      return null;
    }
  };

  const newFile = async () => {
    const path = askForPath('New file path (e.g. chapters/intro.tex)', '');
    if (path === null) return;
    await api.writeFile(projectId, path, '');
    await refreshFiles();
    await openFile(path);
  };

  const uploadFiles = async (list: FileList) => {
    for (const file of Array.from(list)) {
      await api.writeFile(
        projectId,
        parseProjectPath(file.name),
        new Uint8Array(await file.arrayBuffer()),
      );
    }
    await refreshFiles();
  };

  const renameFile = async (from: ProjectPath) => {
    const to = askForPath('New path', from);
    if (to === null || to === from) return;
    await flushSave();
    await api.moveFile(projectId, from, to);
    if (project?.rootFile === from)
      setProject(await api.updateProject(projectId, { rootFile: to }));
    // Reload so the editor shows the saved content under the new path.
    if (document?.path === from) await openFile(to);
    await refreshFiles();
  };

  const deleteFile = async (path: ProjectPath) => {
    if (!window.confirm(`Delete ${path}?`)) return;
    if (document?.path === path) {
      if (pendingSave.current !== null) clearTimeout(pendingSave.current.timer);
      pendingSave.current = null;
      setDocument(null);
    }
    await api.deleteFile(projectId, path);
    await refreshFiles();
  };

  const setRoot = async (path: ProjectPath) => {
    setProject(await api.updateProject(projectId, { rootFile: path }));
  };

  if (project === null) {
    return error === null ? <p className="loading">Loading…</p> : <p className="error">{error}</p>;
  }

  return (
    <div className="workspace">
      <header className="toolbar">
        <a href="#/" className="back">
          ← Projects
        </a>
        <h1>{project.name}</h1>
        <span className={`save-state ${saveState}`} data-testid="save-state">
          {saveState}
        </span>
        <button
          onClick={() => void showInPdf().catch(report)}
          disabled={document?.kind !== 'text' || pdfVersion === 0}
        >
          Show in PDF
        </button>
        <div className="compile-group">
          <button
            className="primary"
            onClick={() => void compile().catch(report)}
            disabled={compiling}
          >
            {compiling ? 'Compiling…' : 'Compile'}
          </button>
          <button
            className="primary menu-toggle"
            aria-label="Compile settings"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ▾
          </button>
          {menuOpen && (
            <div className="compile-menu" role="group" aria-label="Compile settings">
              <label>
                <input
                  type="checkbox"
                  checked={project.settings.autoCompile}
                  onChange={(event) =>
                    void updateSettings({ autoCompile: event.target.checked }).catch(report)
                  }
                />
                <span>
                  Auto-compile
                  <small>After a 1 s pause in typing</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={project.settings.precompilePreamble}
                  onChange={(event) =>
                    void updateSettings({ precompilePreamble: event.target.checked }).catch(report)
                  }
                />
                <span>
                  Precompile preamble
                  <small>Faster pdfLaTeX compiles; turn off if a package misbehaves</small>
                </span>
              </label>
            </div>
          )}
        </div>
      </header>
      {error !== null && (
        <div className="error-bar" role="alert">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <aside className="sidebar">
        <div className="sidebar-actions">
          <button onClick={() => void newFile().catch(report)}>New file</button>
          <label className="upload">
            Upload
            <input
              type="file"
              multiple
              onChange={(event) => {
                const list = event.currentTarget.files;
                if (list !== null) void uploadFiles(list).catch(report);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        <FileTree
          files={files}
          openPath={document?.path ?? null}
          rootFile={project.rootFile}
          onOpen={(path) => void openFile(path).catch(report)}
          onRename={(path) => void renameFile(path).catch(report)}
          onDelete={(path) => void deleteFile(path).catch(report)}
          onSetRoot={(path) => void setRoot(path).catch(report)}
        />
      </aside>
      <main className="source">
        {document?.kind === 'text' && (
          <LatexEditor
            ref={editorRef}
            documentId={document.path}
            initialText={document.text}
            onChange={handleChange}
            onCompile={() => void compile()}
          />
        )}
        {document?.kind === 'binary' && (
          <p className="placeholder">
            {document.path} is a binary file ({document.size} bytes) and cannot be edited here.
          </p>
        )}
        {document === null && <p className="placeholder">Select a file.</p>}
      </main>
      <section className="output">
        <PdfViewer
          url={pdfVersion === 0 ? null : api.pdfUrl(projectId, pdfVersion)}
          highlights={highlights}
          onInverseSearch={(point) => void inverseSearch(point).catch(report)}
        />
        {result !== null && <Diagnostics result={result} onSelect={selectDiagnostic} />}
      </section>
    </div>
  );
}
