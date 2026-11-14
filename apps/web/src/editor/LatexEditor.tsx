import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { Ref } from 'react';

export interface LatexEditorHandle {
  /** Moves the cursor to the start of a 1-based line and scrolls it into view. */
  goToLine(line: number): void;
  /** 1-based line of the cursor. */
  cursorLine(): number;
  /** Current text, including unsaved edits. */
  text(): string;
}

interface LatexEditorProps {
  /** Identifies the document; a new id replaces the editor content. */
  readonly documentId: string;
  readonly initialText: string;
  readonly onChange: (text: string) => void;
  /** Mod-S / Mod-Enter. */
  readonly onCompile: () => void;
  readonly ref?: Ref<LatexEditorHandle>;
}

/** CodeMirror 6 source editor for LaTeX. CodeMirror is confined to this module. */
export function LatexEditor({
  documentId,
  initialText,
  onChange,
  onCompile,
  ref,
}: LatexEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Latest callbacks, so the editor does not need recreating when they change.
  const callbacks = useRef({ onChange, onCompile });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onCompile };
  });

  useEffect(() => {
    const compile = () => {
      callbacks.current.onCompile();
      return true;
    };
    const view = new EditorView({
      parent: containerRef.current!,
      state: EditorState.create({
        doc: initialText,
        extensions: [
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
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate only when another document is opened; text edits stay inside CodeMirror.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

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
    }),
    [],
  );

  return <div className="editor" ref={containerRef} data-testid="editor" />;
}
