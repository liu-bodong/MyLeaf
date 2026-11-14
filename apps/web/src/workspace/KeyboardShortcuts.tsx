import { shortcut } from './shortcuts.js';

const SHORTCUTS: readonly { readonly action: string; readonly keys: string }[] = [
  { action: 'Compile', keys: `${shortcut('S')} or ${shortcut('Enter')}` },
  { action: 'Undo', keys: shortcut('Z') },
  { action: 'Redo', keys: shortcut('Z', { shift: true }) },
  { action: 'Find and replace', keys: shortcut('F') },
  {
    action: 'Zoom in / out (while the PDF has focus)',
    keys: `${shortcut('+')} / ${shortcut('-')}`,
  },
  {
    action: 'Previous / next page (while the PDF has focus)',
    keys: 'Page Up / Page Down',
  },
];

/** The keyboard shortcuts the workspace currently implements. */
export function KeyboardShortcuts() {
  return (
    <dl className="shortcuts">
      {SHORTCUTS.map(({ action, keys }) => (
        <div key={action} className="shortcut-row">
          <dt>{action}</dt>
          <dd>
            <kbd>{keys}</kbd>
          </dd>
        </div>
      ))}
    </dl>
  );
}
