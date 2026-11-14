const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Label of a Mod-key shortcut for this platform, e.g. "⌘Z" or "Ctrl+Z". */
export function shortcut(key: string, options: { readonly shift?: boolean } = {}): string {
  if (isMac) return `${options.shift === true ? '⇧' : ''}⌘${key}`;
  return `Ctrl+${options.shift === true ? 'Shift+' : ''}${key}`;
}
