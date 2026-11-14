import type { CompileResult, Diagnostic } from '@myleaf/compile';
import { useState } from 'react';

interface DiagnosticsProps {
  readonly result: CompileResult;
  readonly onSelect: (diagnostic: Diagnostic) => void;
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

export function Diagnostics({ result, onSelect }: DiagnosticsProps) {
  const [showLog, setShowLog] = useState(false);
  const sorted = [...result.diagnostics].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  const count = (severity: Diagnostic['severity']) =>
    result.diagnostics.filter((d) => d.severity === severity).length;

  return (
    <section className="diagnostics" aria-label="Compile messages">
      <header>
        <span className={`status status-${result.status}`}>{result.status}</span>
        <span>
          {count('error')} errors · {count('warning')} warnings · {count('info')} boxes ·{' '}
          {result.durationMs} ms
        </span>
        <button onClick={() => setShowLog((value) => !value)}>
          {showLog ? 'Hide log' : 'Raw log'}
        </button>
      </header>
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
    </section>
  );
}
