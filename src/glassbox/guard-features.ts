// Guard featurizer: a proposed tool call -> named Boolean features.
// Twin of glassbox/gbx/guard_features.py. The regexes and word lists come from
// the model file (featurizer spec), so only the procedural steps below exist
// twice; src/glassbox/__tests__/parity.test.mjs checks both sides agree.

import type { GuardSpec, ToolCall } from './types';
import { fold, norm } from './text';

const END = '(?![\\s\\S])';
const ENV_ASSIGN = /^[a-z_][a-z0-9_]*=/;
const CMD_OK = new RegExp('^[a-z0-9][a-z0-9._+-]{0,23}' + END);
const FLAG_OK = new RegExp('^(-{1,2}[a-z0-9][a-z0-9._-]{0,22}|/[a-z?])' + END);
const WIN_FLAG = new RegExp('^/[a-z?]' + END);
const DRIVE = new RegExp('^[a-z]:(/|' + END + ')');
const KEY_VALUE = /^[a-z][a-z0-9_]*=/;
const REMOTE = /^[a-z0-9._-]+@[a-z0-9.-]+:/;
const REDIRECT = /(?:^|[^<>0-9&])>{1,2}[ \t]*([^ \t\n<>|;&()]+)/g;
const URL_RE = /(?:https?|ftp|wss?|file):\/\/[^ \t\n'"<>|;()`\\]+/g;
const IPV4 = new RegExp('^[0-9]{1,3}(\\.[0-9]{1,3}){3}' + END);
const USER_HOST = new RegExp('^[a-z0-9._-]+@([a-z0-9.-]+\\.[a-z0-9.-]+)(:|' + END + ')');
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/;
const SUBST = /\$\(([^()]*)\)|`([^`]*)`/g;
const HOME_FORMS = ['~', '$home', '${home}', '$env:userprofile', '$env:home', '%userprofile%', '%homepath%'];
const SEPARATORS = ';\n|&()`';
const LIST_FIELDS = new Set(['cmdword', 'flag', 'target', 'host', 'urlfull', 'method']);

type Fields = Record<'tool' | 'cmd' | 'cmdraw' | 'cwd' | 'code' | 'path' | 'url' | 'method' | 'content' | 'query' | 'ws' | 'all', string>;
type Lists = Record<'cmdword' | 'flag' | 'target' | 'host' | 'urlfull' | 'method', string[]>;
interface CompiledFact { name: string; on: string[]; re: RegExp }

/** Result of featurizing one call: sorted feature names and how many characters the regexes scanned. */
export interface GuardFeatureResult { features: string[]; scanned: number }

export class GuardFeaturizer {
  private readonly wrappers: Set<string>;
  private readonly wrapperValueFlags: Set<string>;
  private readonly multi: Set<string>;
  private readonly fileCmds: Set<string>;
  private readonly modeFirst: Set<string>;
  private readonly devNull: Set<string>;
  private readonly readonlyHead: RegExp;
  private readonly localhost: RegExp;
  private readonly known: RegExp;
  private readonly facts: CompiledFact[];
  private readonly anyOf: { name: string; of: string[] }[];
  private readonly allOf: { name: string; groups: string[][] }[];
  private readonly argKeys: Record<string, string[]>;

  constructor(spec: GuardSpec) {
    this.wrappers = new Set(spec.wrappers);
    this.wrapperValueFlags = new Set(spec.wrapperValueFlags);
    this.multi = new Set(spec.multi);
    this.fileCmds = new Set(spec.fileCmds);
    this.modeFirst = new Set(spec.modeFirstArg);
    this.devNull = new Set(spec.devNull);
    this.readonlyHead = new RegExp(spec.readonlyHead);
    this.localhost = new RegExp(spec.localhostHost);
    this.known = new RegExp(spec.knownHost);
    this.facts = spec.facts.map((f) => ({ name: f.name, on: Array.isArray(f.on) ? f.on : [f.on], re: new RegExp(f.re) }));
    this.anyOf = spec.anyOf;
    this.allOf = spec.allOf;
    this.argKeys = spec.argKeys;
  }

  fields(call: ToolCall): Fields {
    const args: Record<string, unknown> = call.args ?? {};
    const pick = (kind: string): string => {
      for (const k of this.argKeys[kind] ?? []) {
        const v = args[k];
        if (typeof v === 'string' && v !== '') return v;
      }
      return '';
    };
    const rawCmd = pick('cmd');
    const f: Fields = {
      tool: String(call.tool || ''),
      cmd: norm(rawCmd),
      cmdraw: fold(rawCmd),
      cwd: norm(pick('cwd')),
      code: norm(pick('code')),
      path: norm(pick('path')),
      url: norm(pick('url')),
      method: norm(pick('method')).replace(/\n/g, ' '),
      content: norm(pick('content')),
      query: norm(pick('query')),
      ws: norm(String(call.workspaceRoot || '')),
      all: '',
    };
    f.all = [f.cmd, f.code, f.path, f.url, f.content, f.query].join('\n');
    return f;
  }

  featurize(call: ToolCall): GuardFeatureResult {
    const f = this.fields(call);
    const feats = new Set<string>(['tool:' + f.tool]);
    const lists: Lists = { cmdword: [], flag: [], target: [], host: [], urlfull: [], method: f.method ? [f.method] : [] };
    const heads: string[] = [];
    if (f.cmd) {
      this.shell(f.cmd, lists, heads, feats);
      if (heads.length && heads.every((h) => this.readonlyHead.test(h))) feats.add('exec:all_readonly');
    }
    if (f.path) lists.target.push(f.path);
    else if (f.tool === 'list_files' || f.tool === 'search') lists.target.push('.');
    if (f.cwd) lists.target.push(f.cwd);
    if (f.tool === 'write_file' && f.content.replace(/[ \t\n]/g, '') === '') feats.add('content:empty');

    this.urls(f, lists, feats);
    this.targets(lists, f.ws, feats);

    let scanned = f.cmd.length + f.all.length;
    for (const fact of this.facts) {
      if (feats.has(fact.name)) continue;
      for (const field of fact.on) {
        let hit = false;
        if (LIST_FIELDS.has(field)) {
          for (const v of lists[field as keyof Lists]) {
            scanned += v.length;
            if (fact.re.test(v)) { hit = true; break; }
          }
        } else {
          const v = f[field as keyof Fields];
          if (v) {
            scanned += v.length;
            hit = fact.re.test(v);
          }
        }
        if (hit) { feats.add(fact.name); break; }
      }
    }
    for (const a of this.anyOf) if (a.of.some((m) => feats.has(m))) feats.add(a.name);
    for (const a of this.allOf) if (a.groups.every((g) => g.some((m) => feats.has(m)))) feats.add(a.name);
    return { features: [...feats].sort(), scanned };
  }

  // ------------------------------------------------------------------ shell
  private shell(cmd: string, lists: Lists, heads: string[], feats: Set<string>): void {
    const segments = shellSegments(cmd);
    for (const m of cmd.matchAll(SUBST)) segments.push(...shellSegments(m[1] !== undefined ? m[1] : (m[2] ?? '')));
    for (const toks of segments) {
      const n = toks.length;
      let i = 0;
      let main = -1;
      while (i < n) {
        const t = toks[i];
        if (t === '' || t === '$' || ENV_ASSIGN.test(t)) { i += 1; continue; }
        const w = basename(t);
        this.addCmd(w, lists, feats);
        if (this.wrappers.has(w)) {
          i += 1;
          while (i < n && toks[i].startsWith('-')) {
            const takesValue = this.wrapperValueFlags.has(toks[i]);
            i += 1;
            if (takesValue && i < n) i += 1;
          }
          if (w === 'timeout' && i < n && /^[0-9]/.test(toks[i])) i += 1;
          continue;
        }
        main = i;
        break;
      }
      if (main < 0) continue;
      const w = basename(toks[main]);
      const rest = toks.slice(main + 1);
      let head = w;
      if (this.multi.has(w)) {
        for (const t of rest) {
          if (!t.startsWith('-')) {
            if (CMD_OK.test(t)) {
              feats.add('sub:' + w + ' ' + t);
              head = w + ' ' + t;
            }
            break;
          }
        }
      }
      heads.push(head);
      for (let j = 0; j < rest.length; j++) {
        const t = rest[j];
        if ((t === '-exec' || t === '-execdir' || t === '-ok') && j + 1 < rest.length) this.addCmd(basename(rest[j + 1]), lists, feats);
      }
      const fileCmd = this.fileCmds.has(w);
      const skipFirst = this.modeFirst.has(w);
      let seenArg = false;
      for (let t of rest) {
        if (isFlag(t)) {
          const k = t.indexOf('=');
          const fl = k >= 0 ? t.slice(0, k) : t;
          if (FLAG_OK.test(fl)) {
            lists.flag.push(fl);
            feats.add('flag:' + fl);
          }
          continue;
        }
        if (skipFirst && !seenArg) { seenArg = true; continue; }
        seenArg = true;
        const kv = KEY_VALUE.exec(t);
        if (kv && !REMOTE.test(t)) {
          t = t.slice(kv[0].length);
          if (t === '') continue;
        }
        if ((fileCmd || pathLike(t)) && !t.includes('://') && !REMOTE.test(t)) lists.target.push(t);
      }
    }
    for (const m of cmd.matchAll(REDIRECT)) lists.target.push(stripQuotes(m[1]));
  }

  private addCmd(w: string, lists: Lists, feats: Set<string>): void {
    if (CMD_OK.test(w)) {
      lists.cmdword.push(w);
      feats.add('cmd:' + w);
    }
  }

  // ------------------------------------------------------------------ network
  private urls(f: Fields, lists: Lists, feats: Set<string>): void {
    const urls = [...f.all.matchAll(URL_RE)].map((m) => m[0]);
    if (f.tool === 'fetch_url' && f.url && !HAS_SCHEME.test(f.url)) urls.push('https://' + f.url);
    const hosts: string[] = [];
    for (const u of urls) {
      lists.urlfull.push(u);
      if (u.startsWith('file:')) {
        lists.target.push(u.startsWith('file://') ? u.slice('file://'.length) : u.slice(5));
        continue;
      }
      const h = urlHost(u);
      if (h) {
        hosts.push(h);
        if (u.startsWith('http:') && !this.localhost.test(h)) feats.add('net:http_plain');
      }
    }
    for (const word of f.cmd.replace(/\t/g, ' ').replace(/\n/g, ' ').split(' ')) {
      const t = stripQuotes(word);
      if (IPV4.test(t)) hosts.push(t);
      else {
        const m = USER_HOST.exec(t);
        if (m) hosts.push(m[1]);
      }
    }
    if (urls.length) feats.add('net:url');
    for (const h of hosts) {
      lists.host.push(h);
      if (!this.localhost.test(h) && !this.known.test(h)) feats.add('net:unknown_host');
    }
  }

  // ------------------------------------------------------------------ paths
  private targets(lists: Lists, wsRaw: string, feats: Set<string>): void {
    const clean: string[] = [];
    const wsSlash = wsRaw.replace(/\\/g, '/');
    const ws = wsRaw ? segments(wsSlash) : null;
    const wsAbs = wsRaw !== '' && (wsSlash.startsWith('/') || DRIVE.test(wsSlash));
    for (const raw of lists.target) {
      const t = raw.replace(/\\/g, '/').replace(/\n/g, ' ').replace(/\t/g, ' ');
      if (t === '' || this.devNull.has(t)) continue;
      clean.push(t);
      const where = resolveTarget(t, ws, wsAbs);
      if (where === 'outside') feats.add('path:outside_ws');
      else if (where === 'escape') { feats.add('path:outside_ws'); feats.add('path:escapes_ws'); }
      else if (where === 'root') { feats.add('path:inside_ws'); feats.add('path:ws_root'); }
      else feats.add('path:inside_ws');
    }
    lists.target = clean;
  }
}

// ---------------------------------------------------------------------------
// Procedural helpers (twins of the Python functions with the same names)
// ---------------------------------------------------------------------------

/** Split a normalised shell command into pipeline segments of tokens (see shell_segments in Python). */
export function shellSegments(s: string): string[][] {
  const segs: string[][] = [];
  let cur: string[] = [];
  let tok: string | null = null;
  let quote = '';
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = '';
      else tok = (tok ?? '') + c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      if (tok === null) tok = '';
      continue;
    }
    if (c === ' ' || c === '\t' || c === '<' || c === '>') {
      if (tok !== null) { cur.push(tok); tok = null; }
      continue;
    }
    if (c === '&' && ((i + 1 < n && s[i + 1] === '>') || (i > 0 && (s[i - 1] === '<' || s[i - 1] === '>')))) {
      if (tok !== null) { cur.push(tok); tok = null; }
      continue;
    }
    if (SEPARATORS.includes(c)) {
      if (tok !== null) { cur.push(tok); tok = null; }
      if (cur.length) { segs.push(cur); cur = []; }
      continue;
    }
    tok = tok === null ? c : tok + c;
  }
  if (tok !== null) cur.push(tok);
  if (cur.length) segs.push(cur);
  return segs;
}

export function basename(t: string): string {
  const s = t.replace(/\\/g, '/');
  const k = s.lastIndexOf('/');
  return k >= 0 ? s.slice(k + 1) : s;
}

export function isFlag(t: string): boolean {
  return (t.length >= 2 && t[0] === '-' && t !== '--') || WIN_FLAG.test(t);
}

export function pathLike(t: string): boolean {
  if (t === '' || t.includes('://') || REMOTE.test(t)) return false;
  if (t === '.' || t === '..' || t === '*' || t === '~') return true;
  if ('/.~%\\'.includes(t[0])) return true;
  if (t.startsWith('$home') || t.startsWith('${home}') || t.startsWith('$env:')) return true;
  if (DRIVE.test(t.replace(/\\/g, '/'))) return true;
  return t.includes('/') || t.includes('\\') || t.includes('*');
}

export function urlHost(u: string): string {
  const k = u.indexOf('://');
  let rest = k >= 0 ? u.slice(k + 3) : u;
  for (const ch of ['/', '?', '#']) {
    const j = rest.indexOf(ch);
    if (j >= 0) rest = rest.slice(0, j);
  }
  const at = rest.lastIndexOf('@');
  if (at >= 0) rest = rest.slice(at + 1);
  let host: string;
  if (rest.startsWith('[')) {
    const j = rest.indexOf(']');
    host = j >= 0 ? rest.slice(0, j + 1) : rest;
  } else {
    const j = rest.indexOf(':');
    host = j >= 0 ? rest.slice(0, j) : rest;
  }
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

function stripQuotes(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === '"' || s[a] === "'")) a++;
  while (b > a && (s[b - 1] === '"' || s[b - 1] === "'")) b--;
  return s.slice(a, b);
}

function segments(p: string): string[] {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length) out.pop();
      continue;
    }
    out.push(seg);
  }
  return out;
}

/** Where a target lands relative to the workspace: inside | root | outside | escape. */
export function resolveTarget(t: string, ws: string[] | null, wsAbs: boolean): 'inside' | 'root' | 'outside' | 'escape' {
  for (const h of HOME_FORMS) {
    if (t === h || t.startsWith(h + '/') || (h === '~' && t.startsWith('~'))) return 'outside';
  }
  if (t.startsWith('/') || DRIVE.test(t)) {
    if (ws === null || !wsAbs) return 'outside';
    const segs = segments(t);
    if (segs.length === ws.length && segs.every((s, i) => s === ws[i])) return 'root';
    if (segs.length >= ws.length && ws.every((s, i) => s === segs[i])) return 'inside';
    return 'outside';
  }
  let depth = 0;
  for (const seg of t.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      depth -= 1;
      if (depth < 0) return 'escape';
    } else depth += 1;
  }
  return depth === 0 ? 'root' : 'inside';
}
