import type { EditHistory } from '../editor/LatexEditor.js';
import { Icon } from '../ui/icons.js';
import type { EditorMode } from './layout.js';
import { shortcut } from './shortcuts.js';

interface EditorToolbarProps {
  /** Null when no text document is open. */
  readonly history: EditHistory | null;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly fileTreeOpen: boolean;
  readonly onToggleFileTree: () => void;
  readonly mode: EditorMode;
  readonly onModeChange: (mode: EditorMode) => void;
  readonly vim: boolean;
  readonly onToggleVim: () => void;
}

/** Above the editor: file-tree toggle, Code/Visual switch, Vim toggle and undo/redo. */
export function EditorToolbar(props: EditorToolbarProps) {
  const { history, onUndo, onRedo, fileTreeOpen, onToggleFileTree, mode, onModeChange } = props;
  const { vim, onToggleVim } = props;
  return (
    <div className="pane-toolbar editor-toolbar" role="toolbar" aria-label="Editor">
      <button
        type="button"
        className="icon-button"
        aria-label="File tree"
        aria-pressed={fileTreeOpen}
        title={fileTreeOpen ? 'Hide file tree' : 'Show file tree'}
        onClick={onToggleFileTree}
      >
        <Icon name="file-tree" />
      </button>
      <span className="toolbar-separator" />
      <div className="segmented" role="radiogroup" aria-label="Editor mode">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'code'}
          title="Show the LaTeX source"
          onClick={() => onModeChange('code')}
        >
          Code
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'visual'}
          title="Show LaTeX rendered in place; the source appears where the cursor is"
          onClick={() => onModeChange('visual')}
        >
          Visual
        </button>
      </div>
      <button
        type="button"
        className="icon-button toggle-button"
        aria-pressed={vim}
        title={vim ? 'Turn off Vim key bindings' : 'Turn on Vim key bindings'}
        onClick={onToggleVim}
      >
        Vim
      </button>
      <span className="toolbar-separator" />
      <button
        type="button"
        className="icon-button"
        aria-label="Undo"
        title={`Undo (${shortcut('Z')})`}
        disabled={history?.canUndo !== true}
        onClick={onUndo}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Redo"
        title={`Redo (${shortcut('Z', { shift: true })})`}
        disabled={history?.canRedo !== true}
        onClick={onRedo}
      >
        <Icon name="redo" />
      </button>
    </div>
  );
}
