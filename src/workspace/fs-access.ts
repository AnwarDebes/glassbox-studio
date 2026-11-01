import { MAX_FILE_BYTES, MAX_FILES, SKIP_DIRS, looksBinaryName, looksBinaryText } from './paths';

// Local folders through the File System Access API (Chrome and Edge).
// The browser asks the person before granting read or write access.

export function fsAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export interface ReadResult {
  files: Record<string, string>;
  skipped: number;
  truncated: boolean;
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite', id: 'glassbox-workspace' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

export async function readDirectory(root: FileSystemDirectoryHandle): Promise<ReadResult> {
  const files: Record<string, string> = {};
  let skipped = 0;
  let count = 0;
  let truncated = false;

  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    for await (const entry of dir.values()) {
      if (count >= MAX_FILES) {
        truncated = true;
        return;
      }
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(entry as FileSystemDirectoryHandle, path);
        continue;
      }
      if (looksBinaryName(path)) {
        skipped++;
        continue;
      }
      const file = await (entry as FileSystemFileHandle).getFile();
      if (file.size > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }
      const text = await file.text();
      if (looksBinaryText(text)) {
        skipped++;
        continue;
      }
      files[path] = text;
      count++;
    }
  }

  await walk(root, '');
  return { files, skipped, truncated };
}

export async function permissionOf(handle: FileSystemDirectoryHandle, request: boolean): Promise<PermissionState> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  try {
    const state = await handle.queryPermission(opts);
    if (state === 'granted' || !request) return state;
    return await handle.requestPermission(opts);
  } catch {
    return 'denied';
  }
}

async function dirFor(root: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = path.split('/');
  const name = parts.pop() as string;
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return { dir, name };
}

export async function writeToDisk(root: FileSystemDirectoryHandle, path: string, content: string): Promise<void> {
  const { dir, name } = await dirFor(root, path, true);
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

export async function deleteFromDisk(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const { dir, name } = await dirFor(root, path, false);
  await dir.removeEntry(name);
}
