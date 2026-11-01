import type { ToolCall, ToolName } from '../app/gb';
import type { PixieState } from '../pixie/renderer';
import { useWorkspace } from '../workspace/store';
import { normalizePath } from '../workspace/paths';
import type { ToolSchema } from './types';

interface ParamSpec {
  description: string;
  required?: boolean;
}

interface ToolSpec {
  description: string;
  params: Record<string, ParamSpec>;
  /** At least one of these must be present (for run_js). */
  oneOf?: string[];
  pixie: PixieState;
}

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  list_files: {
    description: 'List files in the workspace, optionally under a folder.',
    params: { path: { description: 'Folder to list, relative to the workspace root. Omit for everything.' } },
    pixie: 'reading',
  },
  read_file: {
    description: 'Read a text file. Returns numbered lines.',
    params: {
      path: { description: 'File path relative to the workspace root.', required: true },
      start_line: { description: 'First line to read (1-based). Optional.' },
      end_line: { description: 'Last line to read. Optional.' },
    },
    pixie: 'reading',
  },
  search: {
    description: 'Search all workspace files for text (case-insensitive). Wrap in slashes for a regular expression, like /fo+/.',
    params: {
      query: { description: 'Text or /regex/ to find.', required: true },
      path: { description: 'Only search under this folder. Optional.' },
    },
    pixie: 'searching',
  },
  write_file: {
    description: 'Create or replace a file with the complete new content. The user reviews it as a diff.',
    params: {
      path: { description: 'File path relative to the workspace root.', required: true },
      content: { description: 'The full new file content.', required: true },
    },
    pixie: 'editing',
  },
  delete_file: {
    description: 'Delete a file from the workspace.',
    params: { path: { description: 'File path relative to the workspace root.', required: true } },
    pixie: 'editing',
  },
  run_js: {
    description: 'Run JavaScript in a sandbox (no network, 5 s limit). Pass path to run a workspace file, such as a test file that uses node:test, or code for a snippet.',
    params: {
      path: { description: 'Workspace file to run, for example test/config.test.js.' },
      code: { description: 'JavaScript source to run instead of a file.' },
    },
    oneOf: ['path', 'code'],
    pixie: 'running',
  },
  run_command: {
    description: 'Propose a shell command. Commands cannot run in the browser: the guard reviews it and the user sees it. Use run_js to run tests here.',
    params: { command: { description: 'The shell command.', required: true } },
    pixie: 'running',
  },
  fetch_url: {
    description: 'Fetch a public web page or file over HTTPS and return its text.',
    params: { url: { description: 'The https:// URL to fetch.', required: true } },
    pixie: 'searching',
  },
};

export const TOOL_NAMES = Object.keys(TOOL_SPECS) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return name in TOOL_SPECS;
}

export function nativeToolSchemas(): ToolSchema[] {
  return TOOL_NAMES.map((name) => {
    const spec = TOOL_SPECS[name];
    return {
      type: 'function',
      function: {
        name,
        description: spec.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(Object.entries(spec.params).map(([k, p]) => [k, { type: 'string' as const, description: p.description }])),
          required: Object.entries(spec.params)
            .filter(([, p]) => p.required)
            .map(([k]) => k),
        },
      },
    };
  });
}

/** Compact tool reference for the JSON action protocol prompt. */
export function toolReference(): string {
  return TOOL_NAMES.map((name) => {
    const spec = TOOL_SPECS[name];
    const args = Object.entries(spec.params)
      .map(([k, p]) => `${k}${p.required ? '' : '?'}`)
      .join(', ');
    return `- ${name}(${args}): ${spec.description}`;
  }).join('\n');
}

/** Coerce model-provided arguments to the string record the guard expects. */
export function coerceArgs(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return out;
}

export function validateCall(tool: string, args: Record<string, string>): string | null {
  if (!isToolName(tool)) return `Unknown tool "${tool}". Use one of: ${TOOL_NAMES.join(', ')}.`;
  const spec = TOOL_SPECS[tool];
  for (const [k, p] of Object.entries(spec.params)) {
    if (p.required && !args[k]?.trim()) return `${tool} needs "${k}".`;
  }
  if (spec.oneOf && !spec.oneOf.some((k) => args[k]?.trim())) return `${tool} needs one of: ${spec.oneOf.join(', ')}.`;
  return null;
}

// ---------------------------------------------------------------------------
// Plain-language captions for people watching (Pixie, timeline, ledger).

function short(s: string, n = 48): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

export function describeCall(call: ToolCall): string {
  const a = call.args;
  switch (call.tool) {
    case 'list_files':
      return a.path && a.path.replace(/^\.?\/?$/, '') ? `List ${a.path}` : 'List the workspace';
    case 'read_file':
      return `Read ${a.path ?? 'a file'}`;
    case 'search':
      return `Search for “${short(a.query ?? '', 40)}”`;
    case 'write_file':
      return `Edit ${a.path ?? 'a file'}`;
    case 'delete_file':
      return `Delete ${a.path ?? 'a file'}`;
    case 'run_js':
      return a.path ? `Run ${a.path}` : 'Run a JavaScript snippet';
    case 'run_command':
      return `Command: ${short(a.command ?? '', 56)}`;
    case 'fetch_url':
      return `Fetch ${short(a.url ?? '', 56)}`;
  }
}

/** The key argument of a call, for compact one-line display. */
export function primaryArg(call: ToolCall): string {
  const a = call.args;
  return a.command ?? a.path ?? a.query ?? a.url ?? (a.code ? short(a.code, 60) : '');
}

// ---------------------------------------------------------------------------
// Executors for the tools that act on the in-browser workspace.

const READ_LIMIT = 400;

export interface ToolOutput {
  ok: boolean;
  /** What goes back to the model. */
  text: string;
  /** One line for people. */
  summary: string;
}

function files(): Record<string, string> {
  return useWorkspace.getState().files;
}

export function resolveWorkspacePath(raw: string | undefined): { path: string } | { error: string } {
  const path = normalizePath(raw ?? '');
  if (path === null) return { error: `"${raw}" is outside the workspace. Use a path relative to the workspace root.` };
  return { path };
}

export function execList(args: Record<string, string>): ToolOutput {
  const r = resolveWorkspacePath(args.path ?? '');
  if ('error' in r) return { ok: false, text: r.error, summary: 'Outside the workspace' };
  const prefix = r.path ? `${r.path}/` : '';
  const all = Object.keys(files())
    .filter((p) => !prefix || p.startsWith(prefix))
    .sort();
  if (!all.length) return { ok: false, text: `No files under "${r.path || '.'}".`, summary: 'Nothing there' };
  const shown = all.slice(0, 300);
  const more = all.length > shown.length ? `\n…and ${all.length - shown.length} more` : '';
  return { ok: true, text: shown.join('\n') + more, summary: `${all.length} file${all.length === 1 ? '' : 's'}` };
}

export function execRead(args: Record<string, string>): ToolOutput {
  const r = resolveWorkspacePath(args.path);
  if ('error' in r) return { ok: false, text: r.error, summary: 'Outside the workspace' };
  const content = files()[r.path];
  if (content === undefined) {
    const near = Object.keys(files()).filter((p) => p.endsWith(`/${r.path.split('/').pop()}`) || p === r.path.split('/').pop());
    return { ok: false, text: `No file named ${r.path}.${near.length ? ` Did you mean ${near.slice(0, 3).join(', ')}?` : ' Use list_files to see what exists.'}`, summary: 'Not found' };
  }
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const from = Math.max(1, parseInt(args.start_line ?? '1', 10) || 1);
  const to = Math.min(lines.length, parseInt(args.end_line ?? '', 10) || from + READ_LIMIT - 1);
  const width = String(to).length;
  const body = lines
    .slice(from - 1, to)
    .map((l, i) => `${String(from + i).padStart(width, ' ')}| ${l}`)
    .join('\n');
  const note = to < lines.length || from > 1 ? `\n(lines ${from}-${to} of ${lines.length})` : '';
  return { ok: true, text: (body || '(empty file)') + note, summary: `${lines.length} line${lines.length === 1 ? '' : 's'}` };
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export function searchWorkspace(query: string, under = ''): SearchHit[] | { error: string } {
  let re: RegExp;
  const m = /^\/(.+)\/([gimsuy]*)$/.exec(query.trim());
  try {
    re = m ? new RegExp(m[1], m[2].includes('i') ? 'i' : '') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  } catch {
    return { error: `Invalid regular expression: ${query}` };
  }
  const hits: SearchHit[] = [];
  const prefix = under ? `${under.replace(/\/$/, '')}/` : '';
  for (const [path, content] of Object.entries(files()).sort(([a], [b]) => a.localeCompare(b))) {
    if (prefix && !path.startsWith(prefix)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) hits.push({ path, line: i + 1, text: lines[i].trim().slice(0, 160) });
      if (hits.length >= 200) return hits;
    }
  }
  return hits;
}

export function execSearch(args: Record<string, string>): ToolOutput {
  const under = args.path ? normalizePath(args.path) ?? '' : '';
  const hits = searchWorkspace(args.query ?? '', under);
  if ('error' in hits) return { ok: false, text: hits.error, summary: 'Bad pattern' };
  if (!hits.length) return { ok: true, text: `No matches for ${args.query}.`, summary: 'No matches' };
  const shown = hits.slice(0, 60);
  const filesHit = new Set(hits.map((h) => h.path)).size;
  const text = shown.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n') + (hits.length > shown.length ? `\n…${hits.length - shown.length} more matches` : '');
  return { ok: true, text, summary: `${hits.length} match${hits.length === 1 ? '' : 'es'} in ${filesHit} file${filesHit === 1 ? '' : 's'}` };
}

export async function execFetch(args: Record<string, string>, signal: AbortSignal): Promise<ToolOutput> {
  let url: URL;
  try {
    url = new URL(args.url);
  } catch {
    return { ok: false, text: `Not a valid URL: ${args.url}`, summary: 'Invalid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, text: 'Only https:// URLs can be fetched.', summary: 'Not https' };
  try {
    const timeout = AbortSignal.timeout(10_000);
    const res = await fetch(url, { signal: AbortSignal.any([signal, timeout]), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' });
    const type = res.headers.get('content-type') ?? '';
    let text = (await res.text()).slice(0, 200_000);
    if (/html/i.test(type)) {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      doc.querySelectorAll('script,style,noscript,svg').forEach((n) => n.remove());
      text = (doc.body?.textContent ?? '').replace(/\n\s*\n+/g, '\n\n').trim();
    }
    const clipped = text.slice(0, 12_000);
    return {
      ok: res.ok,
      text: `HTTP ${res.status} ${type}\n\n${clipped}${text.length > clipped.length ? '\n…(truncated)' : ''}`,
      summary: `HTTP ${res.status}, ${Math.round(text.length / 1000)} kB of text`,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError' && signal.aborted) throw err;
    return {
      ok: false,
      text: `The browser could not fetch ${url.host}. Many sites do not allow cross-origin requests from web pages.`,
      summary: 'Blocked by the site or offline',
    };
  }
}
