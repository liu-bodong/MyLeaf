import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { ResolvedTheme, Settings } from '../settings/settings.js';

/** Same tag groups as CodeMirror's default (light) style, with colors for a dark background. */
const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: '#9aa1ad' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.heading, textDecoration: 'underline', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.keyword, color: '#c792ea' },
  {
    tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName],
    color: '#82aaff',
  },
  { tag: [tags.literal, tags.inserted], color: '#9ccc65' },
  { tag: [tags.string, tags.deleted], color: '#f07178' },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: '#f78c6c' },
  { tag: tags.definition(tags.variableName), color: '#82aaff' },
  { tag: tags.local(tags.variableName), color: '#c792ea' },
  // Includes tagName, which the LaTeX mode uses for commands.
  { tag: [tags.typeName, tags.namespace], color: '#5fc79a' },
  { tag: tags.className, color: '#4fc1c9' },
  { tag: [tags.special(tags.variableName), tags.macroName], color: '#7fc8c8' },
  { tag: tags.definition(tags.propertyName), color: '#89b4fa' },
  { tag: tags.comment, color: '#b9915f' },
  { tag: tags.invalid, color: '#ff6b6b' },
]);

/** Editor chrome in the interface's colors (styles.css), so it follows the theme. */
function chrome(theme: ResolvedTheme, settings: Settings): Extension {
  return EditorView.theme(
    {
      '&': {
        color: 'var(--fg)',
        backgroundColor: 'var(--bg)',
        fontSize: `${settings.editorFontSize}px`,
      },
      '.cm-scroller': {
        fontFamily: settings.editorFontFamily,
        lineHeight: String(settings.editorLineHeight),
      },
      '.cm-gutters': {
        color: 'var(--fg-muted)',
        backgroundColor: 'var(--bg-muted)',
        borderRight: '1px solid var(--border)',
      },
      '.cm-activeLineGutter': {
        color: 'var(--fg)',
        backgroundColor: 'var(--bg-hover)',
      },
      '.cm-activeLine': {
        backgroundColor: 'color-mix(in srgb, var(--bg-hover) 60%, transparent)',
      },
      '.cm-panels': {
        color: 'var(--fg)',
        backgroundColor: 'var(--bg-muted)',
      },
      '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
      '.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
    },
    { dark: theme === 'dark' },
  );
}

/** Theme, font and the display options from the settings window. */
export function editorAppearance(theme: ResolvedTheme, settings: Settings): Extension {
  return [
    chrome(theme, settings),
    syntaxHighlighting(theme === 'dark' ? darkHighlightStyle : defaultHighlightStyle),
    settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
    settings.highlightActiveLine ? highlightActiveLine() : [],
    settings.lineWrapping ? EditorView.lineWrapping : [],
  ];
}
