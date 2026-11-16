import type { FileEntryDto, ProjectDto } from '@myleaf/api';
import type { ProjectSettings } from '@myleaf/project';
import type {
  CompileResult,
  Diagnostic,
  PdfPoint,
  PdfRect,
  SourceLocation,
  TexEngine,
} from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import type { OutlineEntry } from '@myleaf/latex-syntax';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectPath } from '@myleaf/project';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { FilePreview } from '../files/FilePreview.js';
import { previewType } from '../files/file-types.js';
import { itemsFromFileList } from '../files/upload-items.js';
import { LiveChannel } from '../live/live-channel.js';
import { LivePreviewPane } from '../live/LivePreviewPane.js';
import type { LivePreviewHandle } from '../live/LivePreviewPane.js';
import type { UploadItem } from '../files/upload-items.js';
import { LatexEditor } from '../editor/LatexEditor.js';
import type { EditHistory, LatexEditorHandle } from '../editor/LatexEditor.js';
import { useImageLoader } from '../editor/use-image-loader.js';
import { useCompletionData } from '../editor/use-completion-data.js';
import { useOutline } from '../editor/use-outline.js';
import { useProjectMacros } from '../editor/use-project-macros.js';
import { useReferences } from '../editor/use-references.js';
import { PdfViewer } from '../pdf/PdfViewer.js';
import type { PdfViewState, PdfViewerHandle } from '../pdf/PdfViewer.js';
import { Dialog } from '../ui/Dialog.js';
import { Icon } from '../ui/icons.js';
import type { MenuDefinition, MenuItem } from '../ui/Menu.js';
import { SplitPane } from '../ui/SplitPane.js';
import { CompileSettings } from './CompileSettings.js';
import { Diagnostics } from './Diagnostics.js';
import { EditorToolbar } from './EditorToolbar.js';
import { FileTree } from './FileTree.js';
import { KeyboardShortcuts } from './KeyboardShortcuts.js';
import { OutlinePanel } from './OutlinePanel.js';
import { Sidebar } from './Sidebar.js';
import {
  OUTLINE_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SPLIT_MAX,
  SPLIT_MIN,
  loadLayout,
  saveLayout,
} from './layout.js';
import type { Layout, LayoutView } from './layout.js';
import { PdfToolbar } from './PdfToolbar.js';
import { shortcut } from './shortcuts.js';
import { TopBar } from './TopBar.js';

/** Delay between the last keystroke and saving. */
const SAVE_DELAY_MS = 800;
/** Full compiles (until references settle) or one engine pass while editing. */
type CompileKind = 'full' | 'single';

/** Pause in editing after which auto-compile starts. */
const AUTO_COMPILE_DELAY_MS = 1000;
/** How long a forward-search highlight stays in the PDF; keep in sync with `pdf-highlight-fade`. */
const HIGHLIGHT_MS = 1000;

type OpenDocument =
  | { readonly kind: 'text'; readonly path: ProjectPath; readonly text: string }
  | { readonly kind: 'binary'; readonly path: ProjectPath; readonly bytes: Uint8Array };

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
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [editHistory, setEditHistory] = useState<EditHistory | null>(null);
  const [pdfView, setPdfView] = useState<PdfViewState>({ page: 0, pages: 0, zoom: null });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** The server's live-preview engine, or `null` without live preview. */
  const [liveEngine, setLiveEngine] = useState<TexEngine | null>(null);
  const [maxSnapshots, setMaxSnapshots] = useState<number | null>(null);
  /** Whether the live pages map to the source and back (SyncTeX). */
  const [liveSynctex, setLiveSynctex] = useState(false);
  const [liveChannel] = useState(() => new LiveChannel());
  /** Output shown while live preview is on; the PDF stays reachable. */
  const [outputView, setOutputView] = useState<'live' | 'pdf'>('live');
  /** Changing it remounts the live pane, which starts a new session. */
  const [liveAttempt, setLiveAttempt] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  /** Folder that the next file-picker upload goes to (`''` is the root). */
  const uploadTarget = useRef('');
  const [result, setResult] = useState<CompileResult | null>(null);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [highlights, setHighlights] = useState<readonly PdfRect[]>([]);
  const [liveHighlights, setLiveHighlights] = useState<readonly PdfRect[]>([]);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<LatexEditorHandle>(null);
  const pdfRef = useRef<PdfViewerHandle>(null);
  const liveRef = useRef<LivePreviewHandle>(null);
  const pendingSave = useRef<PendingSave | null>(null);
  /** Line to move to once a newly opened document is in the editor. */
  const pendingLine = useRef<number | null>(null);
  const compilingRef = useRef(false);
  /** A compile requested while one was running, to run afterwards; `full` wins over `single`. */
  const compileQueued = useRef<CompileKind | null>(null);
  const autoCompileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const report = useCallback((reason: unknown) => setError(errorMessage(reason)), []);
  const projectMacros = useProjectMacros(
    projectId,
    files,
    document?.path ?? null,
    layout.editorMode === 'visual',
  );
  const imageLoader = useImageLoader(projectId, files);
  const completionData = useCompletionData(projectId, files, document?.path ?? null);
  const references = useReferences(projectId, pdfVersion, layout.editorMode === 'visual');
  const { entries: outlineEntries, noteEdit: noteOutlineEdit } = useOutline(
    projectId,
    files,
    project?.rootFile ?? null,
    document?.kind === 'text' ? document : null,
    layout.outline,
  );

  // Forward-search highlights fade out in CSS and are removed afterwards.
  useEffect(() => {
    if (highlights.length === 0) return;
    const timer = setTimeout(() => setHighlights([]), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlights]);
  useEffect(() => {
    if (liveHighlights.length === 0) return;
    const timer = setTimeout(() => setLiveHighlights([]), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [liveHighlights]);

  const updateLayout = useCallback((change: Partial<Layout>) => {
    setLayout((current) => {
      const next = { ...current, ...change };
      saveLayout(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (project !== null) window.document.title = `${project.name} – MyLeaf`;
  }, [project]);

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
      setDocument(text === null ? { kind: 'binary', path, bytes } : { kind: 'text', path, text });
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
      const liveInfo = await api.livePreviewInfo();
      setLiveEngine(liveInfo.engine);
      setMaxSnapshots(liveInfo.maxSnapshots);
      setLiveSynctex(liveInfo.synctex);
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

  /**
   * Compiles; a request during a running compile triggers one more compile
   * afterwards. `single`: one engine pass, for auto-compile while editing.
   */
  const compile = useCallback(
    async (kind: CompileKind = 'full') => {
      if (compilingRef.current) {
        if (compileQueued.current !== 'full') compileQueued.current = kind;
        return;
      }
      compilingRef.current = true;
      setCompiling(true);
      try {
        let next: CompileKind | null = kind;
        while (next !== null) {
          compileQueued.current = null;
          await flushSave();
          const compiled = await api.compile(projectId, { singlePass: next === 'single' });
          setResult(compiled);
          setHighlights([]);
          if (compiled.hasPdf) setPdfVersion((version) => version + 1);
          next = compileQueued.current;
        }
      } catch (reason) {
        report(reason);
      } finally {
        compilingRef.current = false;
        setCompiling(false);
      }
    },
    [flushSave, projectId, report],
  );

  useEffect(
    () => () => {
      if (autoCompileTimer.current !== null) clearTimeout(autoCompileTimer.current);
    },
    [],
  );

  const showLive = liveEngine !== null && project?.settings.livePreview === true;
  /** Source and PDF positions map to the live pages, not the compiled PDF. */
  const syncLive = showLive && liveSynctex && outputView === 'live';
  /** Live preview already updates as you type: auto-compile pauses while it is on. */
  const autoCompile = project?.settings.autoCompile === true && !showLive;

  useEffect(() => {
    if (!autoCompile && autoCompileTimer.current !== null) {
      clearTimeout(autoCompileTimer.current);
      autoCompileTimer.current = null;
    }
  }, [autoCompile]);

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
      liveChannel.publish({ path: document.path, text });
      noteOutlineEdit(text);
      if (autoCompile) {
        if (autoCompileTimer.current !== null) clearTimeout(autoCompileTimer.current);
        autoCompileTimer.current = setTimeout(() => void compile('single'), AUTO_COMPILE_DELAY_MS);
      }
    },
    [autoCompile, compile, document, flushSave, liveChannel, noteOutlineEdit, report],
  );

  /** A new live session starts from saved files: send the open document's unsaved text. */
  const sendOpenDocumentToLive = useCallback(() => {
    if (document?.kind === 'text' && editorRef.current !== null) {
      liveChannel.publish({ path: document.path, text: editorRef.current.text() });
    }
  }, [document, liveChannel]);

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

  /** Forward search, on the live pages when they are shown and support it. */
  const forwardSearch = useCallback(
    async (location: SourceLocation) => {
      // Unmount the previous boxes so a repeated search restarts the fade.
      if (syncLive) {
        setLiveHighlights([]);
        setLiveHighlights((await liveRef.current?.forwardSearch(location)) ?? []);
      } else {
        setHighlights([]);
        setHighlights((await api.forwardSearch(projectId, location)).rects);
      }
    },
    [projectId, syncLive],
  );

  const showInPdf = useCallback(async () => {
    if (document?.kind !== 'text') return;
    const line = editorRef.current?.cursorLine() ?? 1;
    await forwardSearch({ file: document.path, line, column: null });
  }, [document, forwardSearch]);

  const inverseSearch = useCallback(
    async (point: PdfPoint, onLive: boolean) => {
      const location = onLive
        ? ((await liveRef.current?.inverseSearch(point)) ?? null)
        : (await api.inverseSearch(projectId, point)).location;
      if (location !== null) await openFile(location.file, location.line);
    },
    [openFile, projectId],
  );

  /** Inverse search from the reading line of the shown pages. */
  const showInSource = useCallback(async () => {
    const point = (syncLive ? liveRef.current : pdfRef.current)?.readingPoint() ?? null;
    if (point !== null) await inverseSearch(point, syncLive);
  }, [inverseSearch, syncLive]);

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

  const newFile = async (folder: string) => {
    const path = askForPath(
      'New file path (e.g. chapters/intro.tex)',
      folder === '' ? '' : `${folder}/`,
    );
    if (path === null) return;
    await api.writeFile(projectId, path, '');
    await refreshFiles();
    await openFile(path);
  };

  /** Uploads files into `folder`, asking once before replacing existing files. */
  const uploadItems = async (items: readonly UploadItem[], folder: string) => {
    const targets = items.map((item) => ({
      file: item.file,
      path: parseProjectPath(folder === '' ? item.path : `${folder}/${item.path}`),
    }));
    const existing = new Set<string>(files.map((entry) => entry.path));
    const replacing = targets.filter((target) => existing.has(target.path));
    const replace =
      replacing.length === 0 ||
      window.confirm(
        `Replace ${replacing.length} existing file(s)?\n${replacing.map((t) => t.path).join('\n')}`,
      );
    const uploads = replace ? targets : targets.filter((target) => !existing.has(target.path));
    try {
      for (const [index, { file, path }] of uploads.entries()) {
        setUploadStatus(`Uploading ${index + 1} of ${uploads.length}: ${path}`);
        await api.writeFile(projectId, path, new Uint8Array(await file.arrayBuffer()));
        // Reload an open file whose content was replaced.
        if (path === document?.path) setDocument(null);
      }
    } finally {
      setUploadStatus(null);
      await refreshFiles();
    }
  };

  const onFilesChosen = (input: HTMLInputElement) => {
    if (input.files !== null) {
      void uploadItems(itemsFromFileList(input.files), uploadTarget.current).catch(report);
    }
    input.value = '';
  };

  const chooseUpload = (folder: string, input: HTMLInputElement | null) => {
    uploadTarget.current = folder;
    input?.click();
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

  const renameProject = async () => {
    const name = window.prompt('Project name', project?.name)?.trim();
    if (name === undefined || name === '' || name === project?.name) return;
    setProject(await api.updateProject(projectId, { name }));
  };

  if (project === null) {
    return error === null ? <p className="loading">Loading…</p> : <p className="error">{error}</p>;
  }

  const hasPdf = pdfVersion > 0;
  const pdfUrl = hasPdf ? api.pdfUrl(projectId, pdfVersion) : null;
  const pdfShown = !showLive || outputView === 'pdf';
  const canShowInPdf = document?.kind === 'text' && (syncLive || hasPdf);
  const canShowInSource = (syncLive || (hasPdf && pdfShown)) && layout.view !== 'editor';
  const downloadPdf = () => {
    if (pdfUrl === null) return;
    const link = window.document.createElement('a');
    link.href = pdfUrl;
    link.download = `${project.name}.pdf`;
    link.click();
  };

  /** Forward search; makes the PDF visible first. */
  const goToPdf = () => {
    if (layout.view === 'editor') updateLayout({ view: 'split' });
    if (!syncLive) setOutputView('pdf');
    void showInPdf().catch(report);
  };
  /** Inverse search from the PDF; makes the editor visible. */
  const goToSource = () => {
    if (layout.view === 'pdf') updateLayout({ view: 'split' });
    void showInSource().catch(report);
  };

  /** Forward search to an outline heading; makes the PDF visible first. */
  const goToHeading = (entry: OutlineEntry) => {
    if (layout.view === 'editor') updateLayout({ view: 'split' });
    if (!syncLive) setOutputView('pdf');
    void forwardSearch({
      file: parseProjectPath(entry.file),
      line: entry.line,
      column: null,
    }).catch(report);
  };

  const viewItems = (
    [
      ['split', 'Editor & PDF'],
      ['editor', 'Editor only'],
      ['pdf', 'PDF only'],
    ] as const
  ).map(([view, label]): MenuItem => ({
    label,
    checked: layout.view === view,
    onSelect: () => updateLayout({ view: view satisfies LayoutView }),
  }));

  const menus: MenuDefinition[] = [
    {
      label: 'File',
      items: [
        { label: 'New file…', onSelect: () => void newFile('').catch(report) },
        { label: 'Upload files…', onSelect: () => chooseUpload('', fileInput.current) },
        { label: 'Upload folder…', onSelect: () => chooseUpload('', folderInput.current) },
        { kind: 'separator' },
        { label: 'Download PDF', onSelect: downloadPdf, disabled: !hasPdf },
        { label: 'Download source (.zip)' },
        { kind: 'separator' },
        { label: 'Back to projects', onSelect: () => (window.location.hash = '#/') },
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          label: 'Undo',
          shortcut: shortcut('Z'),
          onSelect: () => editorRef.current?.undo(),
          disabled: editHistory?.canUndo !== true,
        },
        {
          label: 'Redo',
          shortcut: shortcut('Z', { shift: true }),
          onSelect: () => editorRef.current?.redo(),
          disabled: editHistory?.canRedo !== true,
        },
        { kind: 'separator' },
        {
          label: 'Find and replace',
          shortcut: shortcut('F'),
          onSelect: () => editorRef.current?.openSearch(),
          disabled: document?.kind !== 'text',
        },
      ],
    },
    {
      label: 'Insert',
      items: [
        { label: 'Figure…' },
        { label: 'Table…' },
        { label: 'Citation…' },
        { label: 'Cross-reference…' },
      ],
    },
    {
      label: 'View',
      items: [
        ...viewItems,
        { kind: 'separator' },
        {
          label: 'File tree',
          checkbox: true,
          checked: layout.fileTree,
          onSelect: () => updateLayout({ fileTree: !layout.fileTree }),
        },
        {
          label: 'Outline',
          checkbox: true,
          checked: layout.outline,
          onSelect: () => updateLayout({ outline: !layout.outline }),
        },
        { kind: 'separator' },
        { label: 'Show in PDF', onSelect: goToPdf, disabled: !canShowInPdf },
        { label: 'Show in source', onSelect: goToSource, disabled: !(syncLive || hasPdf) },
      ],
    },
    {
      label: 'Format',
      items: [
        { label: 'Bold', shortcut: shortcut('B') },
        { label: 'Italic', shortcut: shortcut('I') },
        { kind: 'separator' },
        { label: 'Bulleted list' },
        { label: 'Numbered list' },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard shortcuts', onSelect: () => setShortcutsOpen(true) },
        { label: 'Documentation' },
      ],
    },
  ];

  const projectItems: MenuItem[] = [
    { label: 'Rename…', onSelect: () => void renameProject().catch(report) },
    { label: 'Download PDF', onSelect: downloadPdf, disabled: !hasPdf },
    { label: 'Download source (.zip)' },
    { kind: 'separator' },
    { label: 'Back to projects', onSelect: () => (window.location.hash = '#/') },
  ];

  const errorCount =
    result === null ? null : result.diagnostics.filter((d) => d.severity === 'error').length;

  return (
    <div className="workspace">
      <TopBar
        projectName={project.name}
        saveState={saveState}
        menus={menus}
        projectItems={projectItems}
        layoutItems={viewItems}
      />
      {error !== null && (
        <div className="error-bar" role="alert">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <div className="workspace-body">
        <Sidebar
          open={layout.fileTree}
          width={layout.sidebar}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          onWidthChange={(sidebar) => updateLayout({ sidebar })}
        >
          <div className="sidebar-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="New file"
              title="New file"
              onClick={() => void newFile('').catch(report)}
            >
              <Icon name="file-plus" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Upload files"
              title="Upload files"
              onClick={() => chooseUpload('', fileInput.current)}
            >
              <Icon name="upload" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Upload folder"
              title="Upload folder"
              onClick={() => chooseUpload('', folderInput.current)}
            >
              <Icon name="folder-upload" />
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              data-testid="upload-files-input"
              onChange={(event) => onFilesChosen(event.currentTarget)}
            />
            <input
              ref={(element) => {
                folderInput.current = element;
                // Not in React's typings; makes the picker select a folder.
                element?.setAttribute('webkitdirectory', '');
              }}
              type="file"
              multiple
              hidden
              data-testid="upload-folder-input"
              onChange={(event) => onFilesChosen(event.currentTarget)}
            />
          </div>
          {uploadStatus !== null && (
            <p className="upload-status" role="status">
              {uploadStatus}
            </p>
          )}
          <FileTree
            files={files}
            openPath={document?.path ?? null}
            rootFile={project.rootFile}
            onOpen={(path) => void openFile(path).catch(report)}
            onRename={(path) => void renameFile(path).catch(report)}
            onDelete={(path) => void deleteFile(path).catch(report)}
            onSetRoot={(path) => void setRoot(path).catch(report)}
            onNewFile={(folder) => void newFile(folder).catch(report)}
            onUpload={(folder) => chooseUpload(folder, fileInput.current)}
            onDropFiles={(items, folder) => void uploadItems(items, folder).catch(report)}
          />
        </Sidebar>
        <SplitPane
          view={layout.view === 'split' ? 'both' : layout.view === 'editor' ? 'start' : 'end'}
          ratio={layout.split}
          min={SPLIT_MIN}
          max={SPLIT_MAX}
          onRatioChange={(split) => updateLayout({ split })}
          label="Resize editor and PDF"
          divider={
            <div className="sync-buttons">
              <button
                type="button"
                className="icon-button"
                aria-label="Show in PDF"
                title="Go to this location in the PDF"
                disabled={!canShowInPdf}
                onClick={goToPdf}
              >
                <Icon name="arrow-right" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Show in source"
                title="Go to this location in the source"
                disabled={!canShowInSource}
                onClick={goToSource}
              >
                <Icon name="arrow-left" />
              </button>
            </div>
          }
          start={
            <section className="source-pane" aria-label="Editor">
              <EditorToolbar
                history={document?.kind === 'text' ? editHistory : null}
                onUndo={() => editorRef.current?.undo()}
                onRedo={() => editorRef.current?.redo()}
                fileTreeOpen={layout.fileTree}
                onToggleFileTree={() => updateLayout({ fileTree: !layout.fileTree })}
                mode={layout.editorMode}
                onModeChange={(editorMode) => updateLayout({ editorMode })}
                clean={layout.cleanVisual}
                onToggleClean={() => updateLayout({ cleanVisual: !layout.cleanVisual })}
                vim={layout.vim}
                onToggleVim={() => updateLayout({ vim: !layout.vim })}
              />
              <main className="source">
                {document?.kind === 'text' && (
                  <LatexEditor
                    ref={editorRef}
                    documentId={document.path}
                    initialText={document.text}
                    onChange={handleChange}
                    onCompile={() => void compile()}
                    onSave={() => void flushSave().catch(report)}
                    onHistoryChange={setEditHistory}
                    visual={layout.editorMode === 'visual'}
                    clean={layout.cleanVisual}
                    vim={layout.vim}
                    macros={projectMacros}
                    images={imageLoader}
                    references={references}
                    completion={completionData}
                  />
                )}
                {document?.kind === 'binary' && (
                  <FilePreview
                    path={document.path}
                    bytes={document.bytes}
                    type={previewType(document.path)}
                  />
                )}
                {document === null && <p className="placeholder">Select a file.</p>}
              </main>
            </section>
          }
          end={
            <section className="output" aria-label="Output">
              <PdfToolbar
                compiling={compiling}
                onRecompile={() => void compile().catch(report)}
                compileSettings={
                  <CompileSettings
                    settings={project.settings}
                    liveEngine={liveEngine}
                    livePreviewOn={showLive}
                    maxSnapshots={maxSnapshots}
                    onChange={(settings) => {
                      if (settings.livePreview === true) setOutputView('live');
                      void updateSettings(settings).catch(report);
                    }}
                  />
                }
                errorCount={errorCount}
                logsOpen={layout.logs}
                onToggleLogs={() => updateLayout({ logs: !layout.logs })}
                downloadUrl={pdfUrl}
                downloadName={`${project.name}.pdf`}
                outputTabs={
                  showLive && (
                    <div className="segmented output-tabs" role="tablist" aria-label="Output">
                      {(['live', 'pdf'] as const).map((view) => (
                        <button
                          key={view}
                          type="button"
                          role="tab"
                          aria-selected={outputView === view}
                          onClick={() => setOutputView(view)}
                        >
                          {view === 'live' ? 'Live' : 'PDF'}
                        </button>
                      ))}
                    </div>
                  )
                }
                pdfControls={pdfShown}
                view={pdfView}
                onGoToPage={(page) => pdfRef.current?.goToPage(page)}
                onZoom={(zoom) => updateLayout({ zoom })}
              />
              {/* The live pane stays mounted while the PDF is shown, keeping its session. */}
              {showLive && liveEngine && (
                <div className="output-view" hidden={outputView !== 'live'}>
                  <LivePreviewPane
                    key={liveAttempt}
                    projectId={projectId}
                    channel={liveChannel}
                    engine={liveEngine}
                    onReady={sendOpenDocumentToLive}
                    onShowPdf={() => setOutputView('pdf')}
                    onRetry={() => setLiveAttempt((attempt) => attempt + 1)}
                    ref={liveRef}
                    highlights={liveHighlights}
                    onInverseSearch={
                      liveSynctex
                        ? (point) => void inverseSearch(point, true).catch(report)
                        : undefined
                    }
                  />
                </div>
              )}
              <div className="output-view" hidden={!pdfShown}>
                <PdfViewer
                  ref={pdfRef}
                  url={pdfUrl}
                  highlights={highlights}
                  onInverseSearch={(point) => void inverseSearch(point, false).catch(report)}
                  zoom={layout.zoom}
                  onViewChange={setPdfView}
                  onZoom={(zoom) => updateLayout({ zoom })}
                />
              </div>
              {result !== null && (
                <Diagnostics
                  result={result}
                  onSelect={selectDiagnostic}
                  open={layout.logs}
                  onToggle={() => updateLayout({ logs: !layout.logs })}
                />
              )}
            </section>
          }
        />
        {!layout.outline && (
          <div className="outline-rail">
            <button
              type="button"
              className="icon-button"
              aria-label="Show outline"
              title="Show outline"
              onClick={() => updateLayout({ outline: true })}
            >
              <Icon name="outline" />
            </button>
          </div>
        )}
        <Sidebar
          side="end"
          label="Outline"
          resizeLabel="Resize outline"
          defaultWidth={OUTLINE_DEFAULT}
          open={layout.outline}
          width={layout.outlineWidth}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          onWidthChange={(outlineWidth) => updateLayout({ outlineWidth })}
        >
          <OutlinePanel
            entries={outlineEntries}
            canNavigate={hasPdf}
            onSelect={goToHeading}
            onClose={() => updateLayout({ outline: false })}
          />
        </Sidebar>
      </div>
      {shortcutsOpen && (
        <Dialog title="Keyboard shortcuts" onClose={() => setShortcutsOpen(false)}>
          <KeyboardShortcuts />
        </Dialog>
      )}
    </div>
  );
}
