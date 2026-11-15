import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import {
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { visualMode } from '@myleaf/editor-visual';
import { Vim, vim as vimBindings } from '@replit/codemirror-vim';
import type { CodeMirror as VimEditor } from '@replit/codemirror-vim';
import type { ImageLoader, VisualModeOptions } from '@myleaf/editor-visual';
import type { AuxReferences, MacroDefinitions } from '@myleaf/latex-syntax';
import 'katex/dist/katex.min.css';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';

export interface LatexEditorHandle {
  /** Moves the cursor to the start of a 1-based line and scrolls it into view. */
  goToLine(line: number): void;
  /** 1-based line of the cursor. */
  cursorLine(): number;
  /** Current text, including unsaved edits. */
  text(): string;
  undo(): void;
  redo(): void;
  /** Opens find and replace. */
  openSearch(): void;
}

/** Whether undo and redo have anything to do. */
export interface EditHistory {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

interface LatexEditorProps {
  /** Identifies the document; a new id replaces the editor content. */
  readonly documentId: string;
  readonly initialText: string;
  readonly onChange: (text: string) => void;
  /** Mod-S / Mod-Enter. */
  readonly onCompile: () => void;
  /** Vim `:w`: writes unsaved edits now instead of after the autosave delay. */
  readonly onSave?: () => void;
  readonly onHistoryChange?: (history: EditHistory) => void;
  /** Renders LaTeX in place (ADR 0016); the text and undo history are unaffected. */
  readonly visual?: boolean;
  /** Clean visual mode (only with `visual`). */
  readonly clean?: boolean;
  /** Vim key bindings, with a status line showing the Vim mode. */
  readonly vim?: boolean;
  /** Macros from the project's other files, for math in visual mode. */
  readonly macros?: MacroDefinitions;
  /** Loads `\includegraphics` images for visual mode. */
  readonly images?: ImageLoader;
  /** Numbers from the last compile, for chips in visual mode. */
  readonly references?: AuxReferences | null;
  readonly ref?: Ref<LatexEditorHandle>;
}

const NO_MACROS: MacroDefinitions = {};

/** `:w` handler of each editor; Vim ex commands are registered globally. */
const saveHandlers = new WeakMap<EditorView, () => void>();

function vimMessage(cm: VimEditor, text: string) {
  const message = document.createElement('span');
  message.className = 'cm-vim-message';
  message.textContent = text;
  cm.openNotification(message, { bottom: true, duration: 5000 });
}

/**
 * Write commands. There is one file per editor and nothing to quit, so `:wq` and `:x` only
 * write; writing to another file name is not supported.
 */
function vimWrite(cm: VimEditor, params: { readonly argString?: string }) {
  const argument = params.argString?.trim() ?? '';
  if (argument !== '' && argument !== '!') {
    vimMessage(cm, 'Writing to another file is not supported');
    return;
  }
  saveHandlers.get(cm.cm6)?.();
}
Vim.defineEx('write', 'w', vimWrite);
Vim.defineEx('wall', 'wa', vimWrite);
Vim.defineEx('wq', 'wq', vimWrite);
Vim.defineEx('xit', 'x', vimWrite);

/** Visual mode options without undefined values (exactOptionalPropertyTypes). */
function visualOptions(
  macros: MacroDefinitions,
  images: ImageLoader | undefined,
  references: AuxReferences | null,
  clean: boolean,
): VisualModeOptions {
  return {
    macros,
    clean,
    ...(images === undefined ? {} : { images }),
    ...(references === null ? {} : { references }),
  };
}

/** Runs a command and returns focus to the editor, e.g. after a toolbar click. */
function runCommand(view: EditorView | null, command: (view: EditorView) => boolean) {
  if (view === null) return;
  command(view);
  view.focus();
}

/** CodeMirror 6 source editor for LaTeX. CodeMirror is confined to this module. */
export function LatexEditor({
  documentId,
  initialText,
  onChange,
  onCompile,
  onSave,
  onHistoryChange,
  visual = false,
  clean = false,
  vim = false,
  macros = NO_MACROS,
  images,
  references = null,
  ref,
}: LatexEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [mode] = useState(() => new Compartment());
  const visualRef = useRef(
    visual ? visualMode(visualOptions(macros, images, references, clean)) : [],
  );
  const [keys] = useState(() => new Compartment());
  const vimRef = useRef(vim ? vimBindings({ status: true }) : []);
  // Latest callbacks, so the editor does not need recreating when they change.
  const callbacks = useRef({ onChange, onCompile, onSave, onHistoryChange });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onCompile, onSave, onHistoryChange };
  });

  useEffect(() => {
    const compile = () => {
      callbacks.current.onCompile();
      return true;
    };
    const reportHistory = (state: EditorState) =>
      callbacks.current.onHistoryChange?.({
        canUndo: undoDepth(state) > 0,
        canRedo: redoDepth(state) > 0,
      });
    const view = new EditorView({
      parent: containerRef.current!,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          // Before the other keymaps, so Vim sees keys first (per @replit/codemirror-vim).
          keys.of(vimRef.current),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          highlightSelectionMatches(),
          StreamLanguage.define(stex),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          mode.of(visualRef.current),
          keymap.of([
            { key: 'Mod-s', run: compile, preventDefault: true },
            { key: 'Mod-Enter', run: compile, preventDefault: true },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              callbacks.current.onChange(update.state.doc.toString());
            }
            if (update.transactions.length > 0) reportHistory(update.state);
          }),
        ],
      }),
    });
    viewRef.current = view;
    saveHandlers.set(view, () => callbacks.current.onSave?.());
    reportHistory(view.state);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate only when another document is opened; text edits stay inside CodeMirror.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    visualRef.current = visual ? visualMode(visualOptions(macros, images, references, clean)) : [];
    viewRef.current?.dispatch({ effects: mode.reconfigure(visualRef.current) });
  }, [clean, images, macros, mode, references, visual]);

  useEffect(() => {
    vimRef.current = vim ? vimBindings({ status: true }) : [];
    viewRef.current?.dispatch({ effects: keys.reconfigure(vimRef.current) });
  }, [keys, vim]);

  useImperativeHandle(
    ref,
    () => ({
      goToLine(line) {
        const view = viewRef.current;
        if (view === null) return;
        const target = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
        view.dispatch({
          selection: { anchor: target.from },
          effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
        });
        view.focus();
      },
      cursorLine() {
        const view = viewRef.current;
        return view === null ? 1 : view.state.doc.lineAt(view.state.selection.main.head).number;
      },
      text() {
        return viewRef.current?.state.doc.toString() ?? '';
      },
      undo() {
        runCommand(viewRef.current, undo);
      },
      redo() {
        runCommand(viewRef.current, redo);
      },
      openSearch() {
        runCommand(viewRef.current, openSearchPanel);
      },
    }),
    [],
  );

  return <div className="editor" ref={containerRef} data-testid="editor" />;
}
