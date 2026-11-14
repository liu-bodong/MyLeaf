import type { CompileResult, Diagnostic } from '@myleaf/compile';
import { useId, useState } from 'react';
import { Icon } from '../ui/icons.js';

interface DiagnosticsProps {
  readonly result: CompileResult;
  readonly onSelect: (diagnostic: Diagnostic) => void;
  /** Collapsed, only the summary line is shown. */
  readonly open: boolean;
  readonly onToggle: () => void;
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

const PREAMBLE_LABELS: Record<CompileResult['preamble'], string | null> = {
  reused: 'preamble cached',
  building: 'caching preamble for next compile',
  unavailable: 'preamble not cached',
  disabled: null,
};

/** Compile messages under the PDF; collapses to a one-line summary. */
export function Diagnostics({ result, onSelect, open, onToggle }: DiagnosticsProps) {
  const [showLog, setShowLog] = useState(false);
  const bodyId = useId();
  const sorted = [...result.diagnostics].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  const count = (severity: Diagnostic['severity']) =>
    result.diagnostics.filter((d) => d.severity === severity).length;

  return (
    <section className={`diagnostics${open ? '' : ' collapsed'}`} aria-label="Compile messages">
      <header>
        <button
          type="button"
          className="diagnostics-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          title={open ? 'Hide compile messages' : 'Show compile messages'}
          onClick={onToggle}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-up'} />
          <span className={`status status-${result.status}`}>{result.status}</span>
          <span className="summary">
            {count('error')} errors · {count('warning')} warnings · {count('info')} boxes ·{' '}
            {result.durationMs} ms
            {PREAMBLE_LABELS[result.preamble] !== null && (
              <span data-testid="preamble-status"> · {PREAMBLE_LABELS[result.preamble]}</span>
            )}
          </span>
        </button>
        {open && (
          <button type="button" onClick={() => setShowLog((value) => !value)}>
            {showLog ? 'Hide log' : 'Raw log'}
          </button>
        )}
      </header>
      {/* Kept in the DOM while collapsed, so counts and messages stay inspectable. */}
      <div id={bodyId} className="diagnostics-body" hidden={!open}>
        {showLog ? (
          <pre className="raw-log">{result.log || '(no log)'}</pre>
        ) : (
          <ul>
            {sorted.map((diagnostic, index) => (
              <li key={index} className={`diagnostic ${diagnostic.severity}`}>
                <button disabled={diagnostic.line === null} onClick={() => onSelect(diagnostic)}>
                  {diagnostic.file !== null && (
                    <span className="location">
                      {diagnostic.file}:{diagnostic.line}
                    </span>
                  )}
                  {diagnostic.file === null && diagnostic.line !== null && (
                    <span className="location">line {diagnostic.line}</span>
                  )}
                  {diagnostic.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
