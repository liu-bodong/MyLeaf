import type { EditHistory } from '../editor/LatexEditor.js';
import { Icon } from '../ui/icons.js';
import { shortcut } from './shortcuts.js';

interface EditorToolbarProps {
  /** Null when no text document is open. */
  readonly history: EditHistory | null;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

/** Above the editor: Code/Visual switch (Visual is planned) and undo/redo. */
export function EditorToolbar({ history, onUndo, onRedo }: EditorToolbarProps) {
  return (
    <div className="pane-toolbar editor-toolbar" role="toolbar" aria-label="Editor">
      <div className="segmented" role="radiogroup" aria-label="Editor mode">
        <button type="button" role="radio" aria-checked="true">
          Code
        </button>
        <button type="button" role="radio" aria-checked="false" disabled title="Not available yet">
          Visual
        </button>
      </div>
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
