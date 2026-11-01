// Workspace paths are relative POSIX paths like "src/config.js".

/**
 * Normalize a user or model supplied path to a workspace-relative path.
 * Returns null when the path escapes the workspace root.
 */
export function normalizePath(input: string): string | null {
  let p = (input ?? '').trim().replace(/\\/g, '/');
  if (p.startsWith('~')) return null;
  p = p.replace(/^\/?(workspace|project)\//, '');
  p = p.replace(/^\/+/, '');
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function extname(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase();
}

const LANGS: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  c: 'cpp',
  h: 'cpp',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  swift: 'swift',
  lua: 'lua',
  dockerfile: 'dockerfile',
};

/** Monaco language id for a path. */
export function languageFor(path: string): string {
  const b = basename(path).toLowerCase();
  if (b === 'dockerfile') return 'dockerfile';
  if (b.startsWith('.env')) return 'ini';
  if (b === '.gitignore' || b === '.npmrc') return 'ini';
  return LANGS[extname(path)] ?? 'plaintext';
}

export interface TreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  children: TreeNode[];
}

/** Build a sorted tree (folders first) from a flat list of file paths. */
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'dir', children: [] };
  for (const full of paths) {
    const parts = full.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.name === part && c.kind === (isFile ? 'file' : 'dir'));
      if (!child) {
        child = { name: part, path, kind: isFile ? 'file' : 'dir', children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif', 'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'avi', 'exe', 'dll', 'so',
  'dylib', 'bin', 'class', 'jar', 'wasm', 'psd', 'sqlite', 'db', 'pyc', 'lockb',
]);

export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache',
  'coverage', '.venv', 'venv', '__pycache__', 'target', '.idea', '.gradle', 'Pods', '.dart_tool',
]);

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_FILES = 3000;

export function looksBinaryName(path: string): boolean {
  return BINARY_EXT.has(extname(path));
}

export function looksBinaryText(text: string): boolean {
  return text.slice(0, 4096).includes('\u0000');
}
