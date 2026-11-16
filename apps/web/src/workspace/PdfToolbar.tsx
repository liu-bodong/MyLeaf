import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { stepZoom } from '../pdf/zoom.js';
import type { PdfZoom } from '../pdf/zoom.js';
import type { PdfViewState } from '../pdf/PdfViewer.js';
import type { LiveConnection } from '../live/LivePreviewPane.js';
import { Dropdown } from '../ui/Menu.js';
import type { MenuItem } from '../ui/Menu.js';
import { Icon } from '../ui/icons.js';
import { useDismiss } from '../ui/useDismiss.js';
import { shortcut } from './shortcuts.js';

interface PdfToolbarProps {
  readonly compiling: boolean;
  readonly onRecompile: () => void;
  /** Content of the compile settings popover. */
  readonly compileSettings: ReactNode;
  /** Error count of the last compile; null before the first compile. */
  readonly errorCount: number | null;
  readonly logsOpen: boolean;
  readonly onToggleLogs: () => void;
  /** Null when there is no PDF. */
  readonly downloadUrl: string | null;
  readonly downloadName: string;
  /** The live preview switch and, while it is on, its status. */
  readonly live: LiveToolbarState;
  /** Page and zoom of the shown view: the live pages or the PDF. */
  readonly view: PdfViewState;
  readonly onGoToPage: (page: number) => void;
  readonly onZoom: (zoom: PdfZoom) => void;
}

export interface LiveToolbarState {
  /** The engine's name, or null when the server has no live preview. */
  readonly engine: string | null;
  readonly on: boolean;
  readonly onToggle: () => void;
  /** The session's state while live preview is on. */
  readonly connection: LiveConnection | null;
  readonly onRetry: () => void;
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

/** Above the output pane: compile, logs, download, page navigation and zoom. */
export function PdfToolbar(props: PdfToolbarProps) {
  const { view, live, onGoToPage, onZoom } = props;
  const navigation = view.pages > 0;
  const zoomItems: MenuItem[] = [
    { label: 'Fit to width', onSelect: () => onZoom('fit-width') },
    { label: 'Fit to page', onSelect: () => onZoom('fit-page') },
    { kind: 'separator' },
    ...ZOOM_PRESETS.map((factor) => ({
      label: `${Math.round(factor * 100)}%`,
      onSelect: () => onZoom(factor),
    })),
  ];
  const percent = view.zoom === null ? '—' : `${Math.round(view.zoom * 100)}%`;

  return (
    <div
      className={`pane-toolbar pdf-toolbar${live.on ? ' live-on' : ''}`}
      role="toolbar"
      aria-label="PDF"
    >
      <RecompileButton
        compiling={props.compiling}
        onRecompile={props.onRecompile}
        settings={props.compileSettings}
      />
      <LiveToggle live={live} />
      {props.errorCount !== null && (
        <button
          type="button"
          className={`logs-button${props.errorCount > 0 ? ' has-errors' : ''}`}
          aria-pressed={props.logsOpen}
          aria-label={`Logs: ${props.errorCount} error${props.errorCount === 1 ? '' : 's'}`}
          title={props.logsOpen ? 'Hide logs' : 'Show logs'}
          onClick={props.onToggleLogs}
        >
          Logs
          {props.errorCount > 0 && <span className="count-badge">{props.errorCount}</span>}
        </button>
      )}
      {props.downloadUrl === null ? (
        <button type="button" className="icon-button" aria-label="Download PDF" disabled>
          <Icon name="download" />
        </button>
      ) : (
        <a
          className="icon-button"
          href={props.downloadUrl}
          download={props.downloadName}
          aria-label="Download PDF"
          title="Download PDF"
        >
          <Icon name="download" />
        </a>
      )}
      {live.on && live.connection?.state === 'connecting' && (
        <span className="live-status" role="status">
          Starting…
        </span>
      )}
      {live.on && live.connection?.state === 'ended' && (
        <span className="live-status ended" role="status">
          <span className="live-status-message" title={live.connection.message}>
            {live.connection.message}
          </span>
          <button type="button" onClick={live.onRetry}>
            Retry
          </button>
        </span>
      )}
      <span className="toolbar-spacer" />
      <button
        type="button"
        className="icon-button page-step"
        aria-label="Previous page"
        title="Previous page (Page Up in the PDF)"
        disabled={!navigation || view.page <= 1}
        onClick={() => onGoToPage(view.page - 1)}
      >
        <Icon name="chevron-up" />
      </button>
      <button
        type="button"
        className="icon-button page-step"
        aria-label="Next page"
        title="Next page (Page Down in the PDF)"
        disabled={!navigation || view.page >= view.pages}
        onClick={() => onGoToPage(view.page + 1)}
      >
        <Icon name="chevron-down" />
      </button>
      <PageBox page={view.page} pages={view.pages} disabled={!navigation} onGoTo={onGoToPage} />
      <span className="toolbar-separator" />
      <button
        type="button"
        className="icon-button"
        aria-label="Zoom out"
        title={`Zoom out (${shortcut('-')} in the PDF)`}
        disabled={!navigation || view.zoom === null}
        onClick={() => view.zoom !== null && onZoom(stepZoom(view.zoom, -1))}
      >
        <Icon name="minus" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Zoom in"
        title={`Zoom in (${shortcut('+')} in the PDF)`}
        disabled={!navigation || view.zoom === null}
        onClick={() => view.zoom !== null && onZoom(stepZoom(view.zoom, 1))}
      >
        <Icon name="plus" />
      </button>
      <Dropdown
        label={`Zoom level ${percent}`}
        trigger={
          <>
            <span data-testid="zoom-level">{percent}</span>
            <Icon name="chevron-down" />
          </>
        }
        items={zoomItems}
        align="end"
        buttonClassName="zoom-button"
        disabled={!navigation}
      />
    </div>
  );
}

/**
 * Live preview on/off. While on, it names the engine; the toolbar's page and
 * zoom controls then act on the live pages.
 */
function LiveToggle({ live }: { readonly live: LiveToolbarState }) {
  const available = live.engine !== null;
  const title = !available
    ? 'Live preview is not enabled on this server'
    : live.on
      ? `Live preview with ${live.engine}: pages update as you type. Click to show the compiled PDF.`
      : `Turn on live preview (${live.engine}): pages update as you type`;
  return (
    <button
      type="button"
      className={`live-toggle${live.on ? ' on' : ''}${live.connection?.state === 'ended' ? ' ended' : ''}`}
      aria-pressed={live.on}
      aria-label="Live preview"
      title={title}
      disabled={!available}
      onClick={live.onToggle}
    >
      <span className="live-dot" aria-hidden="true" />
      Live
      {live.on && <span className="live-engine">· {live.engine}</span>}
    </button>
  );
}

interface RecompileButtonProps {
  readonly compiling: boolean;
  readonly onRecompile: () => void;
  readonly settings: ReactNode;
}

/** Recompile with a dropdown holding the compile settings. */
function RecompileButton({ compiling, onRecompile, settings }: RecompileButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  return (
    <div className="compile-group" ref={ref}>
      <button
        type="button"
        className="primary"
        onClick={onRecompile}
        disabled={compiling}
        title={`Recompile (${shortcut('S')})`}
      >
        <Icon name="recompile" />
        {compiling ? 'Compiling…' : 'Recompile'}
      </button>
      <button
        type="button"
        className="primary menu-toggle"
        aria-label="Compile settings"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div className="compile-menu" role="group" aria-label="Compile settings">
          {settings}
        </div>
      )}
    </div>
  );
}

interface PageBoxProps {
  readonly page: number;
  readonly pages: number;
  readonly disabled: boolean;
  readonly onGoTo: (page: number) => void;
}

/** "5 / 41"; typing a page number and pressing Enter goes there. */
function PageBox({ page, pages, disabled, onGoTo }: PageBoxProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const target = Number.parseInt(draft ?? '', 10);
    setDraft(null);
    if (Number.isInteger(target)) onGoTo(Math.min(Math.max(target, 1), pages));
  };
  return (
    <span className="page-box">
      <input
        aria-label="Page"
        inputMode="numeric"
        disabled={disabled}
        value={draft ?? (pages === 0 ? '' : String(page))}
        size={Math.max(2, String(pages).length)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(null);
        }}
      />
      <span data-testid="page-count">/ {pages}</span>
    </span>
  );
}
