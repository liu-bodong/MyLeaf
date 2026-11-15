import type { OutlineEntry } from '@myleaf/latex-syntax';
import { useState } from 'react';
import { Icon } from '../ui/icons.js';

interface OutlinePanelProps {
  readonly entries: readonly OutlineEntry[];
  /** False before there is a PDF to go to; entries are shown but disabled. */
  readonly canNavigate: boolean;
  readonly onSelect: (entry: OutlineEntry) => void;
  readonly onClose: () => void;
}

const entryKey = (entry: OutlineEntry) => `${entry.file}:${entry.line}`;

/** Headings of the document as a tree; selecting one shows it in the PDF. */
export function OutlinePanel({ entries, canNavigate, onSelect, onClose }: OutlinePanelProps) {
  /** Keys of collapsed entries; everything starts expanded. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const renderEntries = (list: readonly OutlineEntry[], level: number) => (
    <ul className="outline-list">
      {list.map((entry) => {
        const key = entryKey(entry);
        const hasChildren = entry.children.length > 0;
        const expanded = hasChildren && !collapsed.has(key);
        return (
          <li key={key}>
            <div className="outline-row" style={{ paddingLeft: 4 + level * 12 }}>
              {hasChildren ? (
                <button
                  type="button"
                  className="outline-toggle"
                  aria-expanded={expanded}
                  aria-label={expanded ? `Collapse ${entry.title}` : `Expand ${entry.title}`}
                  onClick={() => toggle(key)}
                >
                  <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
                </button>
              ) : (
                <span className="outline-toggle" aria-hidden="true" />
              )}
              <button
                type="button"
                className="outline-title"
                disabled={!canNavigate}
                title={
                  canNavigate
                    ? `${entry.title} (${entry.file}:${entry.line})`
                    : 'Compile to go to headings in the PDF'
                }
                onClick={() => onSelect(entry)}
              >
                {entry.title === '' ? `\\${entry.command}` : entry.title}
              </button>
            </div>
            {expanded && renderEntries(entry.children, level + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav className="outline-panel" aria-label="Outline">
      <div className="outline-header">
        <span className="outline-heading">Outline</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Hide outline"
          title="Hide outline"
          onClick={onClose}
        >
          <Icon name="panel-right" />
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="outline-empty">No sections in the main file or the files it includes.</p>
      ) : (
        renderEntries(entries, 0)
      )}
    </nav>
  );
}
