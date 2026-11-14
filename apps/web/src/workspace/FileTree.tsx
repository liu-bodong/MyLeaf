import type { FileEntryDto } from '@myleaf/api';
import type { ProjectPath } from '@myleaf/project';
import { useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { previewType } from '../files/file-types.js';
import { itemsFromDrop } from '../files/upload-items.js';
import type { UploadItem } from '../files/upload-items.js';
import { Icon } from '../ui/icons.js';
import { Dropdown } from '../ui/Menu.js';
import type { MenuItem } from '../ui/Menu.js';

interface FileTreeProps {
  readonly files: readonly FileEntryDto[];
  readonly openPath: ProjectPath | null;
  readonly rootFile: ProjectPath;
  readonly onOpen: (path: ProjectPath) => void;
  readonly onRename: (path: ProjectPath) => void;
  readonly onDelete: (path: ProjectPath) => void;
  readonly onSetRoot: (path: ProjectPath) => void;
  /** Folder actions; `''` is the project root. */
  readonly onNewFile: (folder: string) => void;
  readonly onUpload: (folder: string) => void;
  readonly onDropFiles: (items: UploadItem[], folder: string) => void;
}

interface FolderNode {
  readonly name: string;
  readonly path: string;
  readonly folders: Map<string, FolderNode>;
  readonly files: FileEntryDto[];
}

function buildTree(files: readonly FileEntryDto[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: new Map(), files: [] };
  for (const entry of files) {
    const segments = entry.path.split('/');
    let folder = root;
    for (const name of segments.slice(0, -1)) {
      let child = folder.folders.get(name);
      if (child === undefined) {
        const path = folder.path === '' ? name : `${folder.path}/${name}`;
        child = { name, path, folders: new Map(), files: [] };
        folder.folders.set(name, child);
      }
      folder = child;
    }
    folder.files.push(entry);
  }
  return root;
}

const fileKind = (path: string) =>
  path.endsWith('.tex')
    ? 'tex'
    : path.endsWith('.bib')
      ? 'bib'
      : (previewType(path)?.kind ?? 'file');

const INDENT = 14;

/** "⋯" button opening a row's actions. */
function RowMenu({ name, items }: { readonly name: string; readonly items: readonly MenuItem[] }) {
  return (
    <Dropdown
      label={`Actions for ${name}`}
      trigger={<Icon name="more" />}
      items={items}
      align="end"
      className="row-menu"
      buttonClassName="icon-button"
      title="More actions"
    />
  );
}

/**
 * Project files as a collapsible folder tree. Files and folders dropped from
 * the operating system onto a folder (or the empty area, for the root) are
 * uploaded there.
 */
export function FileTree(props: FileTreeProps) {
  const { files, openPath, rootFile, onOpen, onRename, onDelete, onSetRoot } = props;
  const { onNewFile, onUpload, onDropFiles } = props;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const dropHandlers = (folder: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(folder);
    },
    onDragLeave: (event: DragEvent) => {
      event.stopPropagation();
      setDropTarget((current) => (current === folder ? null : current));
    },
    onDrop: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      void itemsFromDrop(event.dataTransfer).then((items) => onDropFiles(items, folder));
    },
  });

  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const renderFolder = (folder: FolderNode, depth: number): ReactNode[] => [
    ...[...folder.folders.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => (
        <li key={`d:${child.path}`} {...dropHandlers(child.path)}>
          <div
            className={`file-row directory${dropTarget === child.path ? ' drop-target' : ''}`}
            style={{ paddingLeft: depth * INDENT + 4 }}
          >
            <button
              className="file-name"
              aria-expanded={!collapsed.has(child.path)}
              onClick={() => toggle(child.path)}
            >
              <span className="caret" aria-hidden="true">
                {collapsed.has(child.path) ? '▸' : '▾'}
              </span>
              {child.name}
            </button>
            <RowMenu
              name={child.name}
              items={[
                { label: 'New file…', onSelect: () => onNewFile(child.path) },
                { label: 'Upload files…', onSelect: () => onUpload(child.path) },
              ]}
            />
          </div>
          {!collapsed.has(child.path) && <ul>{renderFolder(child, depth + 1)}</ul>}
        </li>
      )),
    ...folder.files.map(({ path }) => {
      const name = path.slice(path.lastIndexOf('/') + 1);
      return (
        <li key={`f:${path}`}>
          <div
            className={`file-row${path === openPath ? ' active' : ''}`}
            style={{ paddingLeft: depth * INDENT + 18 }}
          >
            <button className="file-name" onClick={() => onOpen(path)} title={path}>
              <span className={`file-kind kind-${fileKind(path)}`} aria-hidden="true" />
              {name}
              {path === rootFile && <span className="badge">main</span>}
            </button>
            <RowMenu
              name={name}
              items={[
                ...(path !== rootFile && name.endsWith('.tex')
                  ? [{ label: 'Use as main document', onSelect: () => onSetRoot(path) }]
                  : []),
                { label: 'Rename or move…', onSelect: () => onRename(path) },
                { kind: 'separator' },
                { label: 'Delete…', onSelect: () => onDelete(path) },
              ]}
            />
          </div>
        </li>
      );
    }),
  ];

  return (
    <div
      className={`file-tree-area${dropTarget === '' ? ' drop-target' : ''}`}
      data-testid="file-tree"
      {...dropHandlers('')}
    >
      <ul className="file-tree" aria-label="Project files">
        {renderFolder(buildTree(files), 0)}
      </ul>
      <p className="drop-hint">Drop files or folders here to upload</p>
    </div>
  );
}
