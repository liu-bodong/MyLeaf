import type { PdfZoom } from '../pdf/zoom.js';
import { ZOOM_STEPS } from '../pdf/zoom.js';

/** Which panes the workspace shows. */
export type LayoutView = 'split' | 'editor' | 'pdf';

/** How the editor shows LaTeX: source, or rendered in place (ADR 0016). */
export type EditorMode = 'code' | 'visual';

/** Workspace layout, saved per browser. */
export interface Layout {
  readonly view: LayoutView;
  /** Share of the width given to the editor in the split view. */
  readonly split: number;
  /** Width of the file-tree sidebar in CSS pixels. */
  readonly sidebar: number;
  readonly zoom: PdfZoom;
  /** Whether the compile messages under the PDF are expanded. */
  readonly logs: boolean;
  /** Whether the file-tree sidebar is shown. */
  readonly fileTree: boolean;
  readonly editorMode: EditorMode;
  /** Whether the outline sidebar on the right is shown. */
  readonly outline: boolean;
  /** Width of the outline sidebar in CSS pixels. */
  readonly outlineWidth: number;
}

export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;
export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 240;
export const OUTLINE_DEFAULT = 220;
export const DEFAULT_LAYOUT: Layout = {
  view: 'split',
  split: 0.5,
  sidebar: SIDEBAR_DEFAULT,
  zoom: 'fit-width',
  logs: false,
  fileTree: true,
  editorMode: 'code',
  outline: false,
  outlineWidth: OUTLINE_DEFAULT,
};

const STORAGE_KEY = 'myleaf.layout';
const VIEWS: readonly LayoutView[] = ['split', 'editor', 'pdf'];
const EDITOR_MODES: readonly EditorMode[] = ['code', 'visual'];

export function clampSplit(split: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, split));
}

export function clampSidebar(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));
}

function parseZoom(value: unknown): PdfZoom | null {
  if (value === 'fit-width' || value === 'fit-page') return value;
  if (
    typeof value === 'number' &&
    value >= ZOOM_STEPS[0] &&
    value <= ZOOM_STEPS[ZOOM_STEPS.length - 1]!
  ) {
    return value;
  }
  return null;
}

/** Reads a saved layout; missing or invalid fields fall back to the defaults. */
export function parseLayout(raw: string | null): Layout {
  let value: unknown;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_LAYOUT;
  const saved = value as Record<string, unknown>;
  return {
    view: VIEWS.find((view) => view === saved.view) ?? DEFAULT_LAYOUT.view,
    split:
      typeof saved.split === 'number' && Number.isFinite(saved.split)
        ? clampSplit(saved.split)
        : DEFAULT_LAYOUT.split,
    sidebar:
      typeof saved.sidebar === 'number' && Number.isFinite(saved.sidebar)
        ? clampSidebar(saved.sidebar)
        : DEFAULT_LAYOUT.sidebar,
    zoom: parseZoom(saved.zoom) ?? DEFAULT_LAYOUT.zoom,
    logs: typeof saved.logs === 'boolean' ? saved.logs : DEFAULT_LAYOUT.logs,
    fileTree: typeof saved.fileTree === 'boolean' ? saved.fileTree : DEFAULT_LAYOUT.fileTree,
    editorMode: EDITOR_MODES.find((mode) => mode === saved.editorMode) ?? DEFAULT_LAYOUT.editorMode,
    outline: typeof saved.outline === 'boolean' ? saved.outline : DEFAULT_LAYOUT.outline,
    outlineWidth:
      typeof saved.outlineWidth === 'number' && Number.isFinite(saved.outlineWidth)
        ? clampSidebar(saved.outlineWidth)
        : DEFAULT_LAYOUT.outlineWidth,
  };
}

/** Storage may be unavailable (private mode, blocked site data). */
export function loadLayout(): Layout {
  try {
    return parseLayout(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: Layout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not saved; the layout still applies to this page.
  }
}
