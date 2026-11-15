/** Stroke paths on a 16×16 grid. */
const PATHS = {
  undo: 'M4 6h6.5a3.5 3.5 0 0 1 0 7H7M4 6l2.5-2.5M4 6l2.5 2.5',
  redo: 'M12 6H5.5a3.5 3.5 0 0 0 0 7H9M12 6L9.5 3.5M12 6L9.5 8.5',
  'chevron-down': 'M4 6l4 4 4-4',
  'chevron-up': 'M4 10l4-4 4 4',
  'chevron-right': 'M6 4l4 4-4 4',
  'arrow-right': 'M3 8h10M9 4l4 4-4 4',
  'arrow-left': 'M13 8H3M7 4L3 8l4 4',
  download: 'M8 2.5v7.5M4.5 6.5L8 10l3.5-3.5M3 13h10',
  plus: 'M3.5 8h9M8 3.5v9',
  minus: 'M3.5 8h9',
  history: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5V5H5M8 5v3l2 1.5',
  layout: 'M2 3h12v10H2zM8 3v10',
  'file-tree': 'M2 3h12v10H2zM6 3v10',
  'panel-right': 'M2 3h12v10H2zM10 3v10',
  outline: 'M3 4h10M5.5 8h7.5M8 12h5',
  share: 'M8 2.5v7M5 5.5l3-3 3 3M3.5 9v4h9V9',
  recompile: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3',
  home: 'M2.5 7.5L8 3l5.5 4.5M4 6.5V13h8V6.5',
  'file-plus': 'M9 2H4v12h8V5zM9 2v3h3M8 7.5v4M6 9.5h4',
  upload: 'M8 10.5V3M5 6l3-3 3 3M3 10v3h10v-3',
  'folder-upload': 'M2 4h4l1.5 1.5H14V13H2zM8 11.5V7.5M6.2 9.3L8 7.5l1.8 1.8',
  more: 'M3.25 8a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0M7.25 8a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0M11.25 8a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0',
} as const;

export type IconName = keyof typeof PATHS;

/** Decorative icon; the surrounding control carries the accessible name. */
export function Icon({ name }: { readonly name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
