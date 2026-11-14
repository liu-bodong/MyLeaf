/**
 * Parses the `key:value` records printed by the `synctex` command-line tool
 * between `SyncTeX result begin` and `SyncTeX result end`. A new record starts
 * at every occurrence of `firstKey` (e.g. `Page` for `synctex view`).
 */
export function parseSynctexRecords(output: string, firstKey: string): Map<string, string>[] {
  const records: Map<string, string>[] = [];
  let inResult = false;
  for (const line of output.split(/\r?\n/)) {
    if (line === 'SyncTeX result begin') {
      inResult = true;
      continue;
    }
    if (line === 'SyncTeX result end') {
      break;
    }
    const separator = line.indexOf(':');
    if (!inResult || separator < 0) {
      continue;
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === firstKey) {
      records.push(new Map());
    }
    records.at(-1)?.set(key, value);
  }
  return records;
}
