import type { FileEntryDto } from '@myleaf/api';
import type { ProjectPath } from '@myleaf/project';

interface FileTreeProps {
  readonly files: readonly FileEntryDto[];
  readonly openPath: ProjectPath | null;
  readonly rootFile: ProjectPath;
  readonly onOpen: (path: ProjectPath) => void;
  readonly onRename: (path: ProjectPath) => void;
  readonly onDelete: (path: ProjectPath) => void;
  readonly onSetRoot: (path: ProjectPath) => void;
}

interface Row {
  readonly kind: 'directory' | 'file';
  readonly name: string;
  readonly depth: number;
  readonly path: string;
}

/** Flattens sorted file paths into directory and file rows. */
function toRows(files: readonly FileEntryDto[]): Row[] {
  const rows: Row[] = [];
  const seenDirectories = new Set<string>();
  for (const { path } of files) {
    const segments = path.split('/');
    segments.slice(0, -1).forEach((name, depth) => {
      const directory = segments.slice(0, depth + 1).join('/');
      if (!seenDirectories.has(directory)) {
        seenDirectories.add(directory);
        rows.push({ kind: 'directory', name, depth, path: directory });
      }
    });
    rows.push({ kind: 'file', name: segments.at(-1) ?? path, depth: segments.length - 1, path });
  }
  return rows;
}

export function FileTree(props: FileTreeProps) {
  const { files, openPath, rootFile, onOpen, onRename, onDelete, onSetRoot } = props;
  return (
    <ul className="file-tree" aria-label="Project files">
      {toRows(files).map((row) => {
        const path = row.path as ProjectPath;
        if (row.kind === 'directory') {
          return (
            <li
              key={`d:${row.path}`}
              className="file-row directory"
              style={{ paddingLeft: row.depth * 14 + 8 }}
            >
              {row.name}/
            </li>
          );
        }
        return (
          <li
            key={`f:${row.path}`}
            className={`file-row${path === openPath ? ' active' : ''}`}
            style={{ paddingLeft: row.depth * 14 + 8 }}
          >
            <button className="file-name" onClick={() => onOpen(path)} title={row.path}>
              {row.name}
              {path === rootFile && <span className="badge">main</span>}
            </button>
            <span className="file-actions">
              {path !== rootFile && row.name.endsWith('.tex') && (
                <button onClick={() => onSetRoot(path)} title="Use as main document">
                  Main
                </button>
              )}
              <button onClick={() => onRename(path)} title="Rename or move">
                Rename
              </button>
              <button onClick={() => onDelete(path)} title="Delete">
                Delete
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
