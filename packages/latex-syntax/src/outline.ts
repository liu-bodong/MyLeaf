import { parseLatex } from './parse.js';
import type { ArgumentNode, CommandNode, LatexNode } from './parse.js';

/** Sectioning commands, outermost first; the index is the heading's depth. */
export const SECTIONING_COMMANDS = [
  'part',
  'chapter',
  'section',
  'subsection',
  'subsubsection',
  'paragraph',
  'subparagraph',
] as const;

export type SectioningCommand = (typeof SECTIONING_COMMANDS)[number];

/** A sectioning command or an `\input`/`\include`, in source order. */
export type OutlineItem = OutlineHeadingItem | OutlineIncludeItem;

export interface OutlineHeadingItem {
  readonly kind: 'heading';
  readonly command: SectioningCommand;
  /** Index in `SECTIONING_COMMANDS`. */
  readonly depth: number;
  readonly starred: boolean;
  /** The mandatory argument as plain text. */
  readonly title: string;
  /** Offset of the backslash. */
  readonly offset: number;
}

export interface OutlineIncludeItem {
  readonly kind: 'include';
  readonly command: 'input' | 'include';
  /** The argument as written, trimmed. */
  readonly target: string;
  readonly offset: number;
}

const DEPTH: ReadonlyMap<string, number> = new Map(
  SECTIONING_COMMANDS.map((command, depth) => [command, depth]),
);

/**
 * Sectioning commands and `\input`/`\include` commands of one file, in
 * source order. Comments and verbatim environments are skipped; commands
 * without their mandatory argument are ignored.
 */
export function outlineItems(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const visit = (nodes: readonly LatexNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'command') {
        const item = commandItem(text, node);
        if (item !== null) items.push(item);
        for (const arg of node.args) visit(arg.children);
      } else if (node.kind === 'group' || node.kind === 'environment') {
        visit(node.children);
      }
    }
  };
  visit(parseLatex(text).nodes);
  return items;
}

function commandItem(text: string, node: CommandNode): OutlineItem | null {
  const mandatory = node.args.find((arg) => !arg.optional);
  if (mandatory === undefined) return null;
  const depth = DEPTH.get(node.name);
  if (depth !== undefined) {
    return {
      kind: 'heading',
      command: node.name as SectioningCommand,
      depth,
      starred: node.starred,
      title: plainText(text, mandatory),
      offset: node.from,
    };
  }
  if (node.name === 'input' || node.name === 'include') {
    const target = text.slice(mandatory.contentFrom, mandatory.contentTo).trim();
    if (target === '') return null;
    return { kind: 'include', command: node.name, target, offset: node.from };
  }
  return null;
}

/**
 * An argument's text without markup: commands with arguments are replaced by
 * their last mandatory argument, other commands by their name (`\LaTeX` →
 * `LaTeX`, `\&` → `&`), math is kept as written, comments are dropped, `~`
 * and line breaks become spaces.
 */
function plainText(text: string, arg: ArgumentNode): string {
  const parts: string[] = [];
  const collect = (from: number, to: number, children: readonly LatexNode[]) => {
    let at = from;
    for (const child of children) {
      parts.push(text.slice(at, child.from));
      at = child.to;
      if (child.kind === 'command') {
        const last = child.args.filter((a) => !a.optional).at(-1);
        if (last !== undefined) collect(last.contentFrom, last.contentTo, last.children);
        else parts.push(child.name === '\\' ? ' ' : child.name);
      } else if (child.kind === 'group') {
        collect(child.contentFrom, child.contentTo, child.children);
      } else if (child.kind === 'math') {
        parts.push(text.slice(child.from, child.to));
      } else if (child.kind === 'environment') {
        collect(child.contentFrom, child.contentTo, child.children);
      }
    }
    parts.push(text.slice(at, to));
  };
  collect(arg.contentFrom, arg.contentTo, arg.children);
  return parts.join('').replace(/~/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Project paths TeX tries for an `\input`/`\include` argument, relative to
 * the compile directory (the project root): `\include{x}` reads `x.tex`;
 * `\input{x}` tries `x.tex`, then `x`.
 */
export function includeCandidates(command: 'input' | 'include', target: string): string[] {
  const path = target.replace(/^"(.*)"$/, '$1').replace(/^(\.\/)+/, '');
  if (command === 'include') return [`${path}.tex`];
  return path.endsWith('.tex') ? [path] : [`${path}.tex`, path];
}

/** A heading in the project outline, with the headings below it. */
export interface OutlineEntry {
  readonly command: SectioningCommand;
  readonly depth: number;
  readonly starred: boolean;
  readonly title: string;
  /** Project path of the file the heading is in. */
  readonly file: string;
  /** 1-based line of the sectioning command. */
  readonly line: number;
  readonly children: readonly OutlineEntry[];
}

/**
 * The headings of `rootFile` and of the files it pulls in with `\input` and
 * `\include` (recursively, at the place of the command), nested by depth.
 * `readSource` returns a project file's text, or null if there is no such
 * file. Missing files and include cycles are skipped.
 */
export function projectOutline(
  rootFile: string,
  readSource: (path: string) => string | null,
): OutlineEntry[] {
  interface Mutable extends Omit<OutlineEntry, 'children'> {
    children: Mutable[];
  }
  const roots: Mutable[] = [];
  const stack: Mutable[] = [];
  const expanding = new Set<string>();

  const expand = (file: string, text: string) => {
    expanding.add(file);
    const lineStarts = lineStartOffsets(text);
    for (const item of outlineItems(text)) {
      if (item.kind === 'include') {
        for (const candidate of includeCandidates(item.command, item.target)) {
          if (expanding.has(candidate)) break;
          const included = readSource(candidate);
          if (included !== null) {
            expand(candidate, included);
            break;
          }
        }
        continue;
      }
      const entry: Mutable = {
        command: item.command,
        depth: item.depth,
        starred: item.starred,
        title: item.title,
        file,
        line: lineAt(lineStarts, item.offset),
        children: [],
      };
      while (stack.length > 0 && stack[stack.length - 1]!.depth >= entry.depth) stack.pop();
      (stack.length === 0 ? roots : stack[stack.length - 1]!.children).push(entry);
      stack.push(entry);
    }
    expanding.delete(file);
  };

  const root = readSource(rootFile);
  if (root !== null) expand(rootFile, root);
  return roots;
}

function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** 1-based line containing `offset`. */
function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}
