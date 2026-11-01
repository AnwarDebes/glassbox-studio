import { MAX_FILE_BYTES, MAX_FILES, SKIP_DIRS, looksBinaryName, looksBinaryText } from './paths';

// .zip import and export. JSZip is loaded only when someone uses it.

export async function importZip(file: File): Promise<{ name: string; files: Record<string, string>; skipped: number }> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  // Strip a single shared top-level folder, which most zips have.
  const tops = new Set(entries.map((e) => e.name.split('/')[0]));
  const strip = tops.size === 1 && entries.every((e) => e.name.includes('/')) ? `${[...tops][0]}/` : '';
  const files: Record<string, string> = {};
  let skipped = 0;
  let count = 0;
  for (const entry of entries) {
    const path = entry.name.startsWith(strip) ? entry.name.slice(strip.length) : entry.name;
    if (!path || path.split('/').some((p) => SKIP_DIRS.has(p)) || looksBinaryName(path) || count >= MAX_FILES) {
      skipped++;
      continue;
    }
    const text = await entry.async('string');
    if (text.length > MAX_FILE_BYTES || looksBinaryText(text)) {
      skipped++;
      continue;
    }
    files[path] = text;
    count++;
  }
  const base = file.name.replace(/\.zip$/i, '') || 'workspace';
  return { name: strip ? strip.slice(0, -1) : base, files, skipped };
}

export async function exportZip(name: string, files: Record<string, string>): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const folder = zip.folder(name) ?? zip;
  for (const [path, content] of Object.entries(files)) folder.file(path, content);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadBlob(blob, `${name}.zip`);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
