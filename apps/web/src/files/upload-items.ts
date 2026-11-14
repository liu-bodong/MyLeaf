/** A file to upload and its path relative to the upload target folder. */
export interface UploadItem {
  readonly path: string;
  readonly file: File;
}

/** Files chosen in an `<input type="file">`, keeping folder structure for folder uploads. */
export function itemsFromFileList(list: FileList): UploadItem[] {
  return Array.from(list, (file) => ({ path: file.webkitRelativePath || file.name, file }));
}

/**
 * Files dropped from the operating system, including the contents of dropped
 * folders. Must be called synchronously inside the `drop` event handler: the
 * browser invalidates the dropped items once the handler returns.
 */
export function itemsFromDrop(transfer: DataTransfer): Promise<UploadItem[]> {
  const entries = Array.from(transfer.items, (item) => item.webkitGetAsEntry());
  if (entries.some((entry) => entry === null)) {
    // Entries are unavailable (e.g. synthetic events): fall back to the plain file list.
    return Promise.resolve(itemsFromFileList(transfer.files));
  }
  return Promise.all(entries.map((entry) => collectEntry(entry!, ''))).then((nested) =>
    nested.flat(),
  );
}

async function collectEntry(entry: FileSystemEntry, prefix: string): Promise<UploadItem[]> {
  const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    return [{ path, file }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // readEntries returns results in batches until it returns an empty batch.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((child) => collectEntry(child, path)));
  return nested.flat();
}
