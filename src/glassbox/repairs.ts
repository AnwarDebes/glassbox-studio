// Safer alternatives for risky tool calls, in the spirit of REINS
// (github.com/AnwarDebes/reins): instead of only blocking, propose the least
// disruptive edit that keeps the task moving. Every repair is model-free and
// deterministic, and every suggestion is itself run through guard() and
// dropped if it would be blocked. In REINS' edit vocabulary they are:
//   SUBSTITUTE  a safer variant of the same action (mv into .trash instead of
//               rm -rf, --force-with-lease to a new branch, chmod 755,
//               terraform plan -destroy, a local install instead of a global one)
//   DEFER       look before acting (download and show a script, list a folder)
//   SUPPRESS    a no-op `echo` that tells the agent why the call was refused
// Repairs are ordered from most to least useful; at most three are returned.

import type { GuardResult, Repair, ToolCall } from './types';
import { guard, guardFeaturesOf } from './models';
import { isFlag, resolveTarget, shellSegments } from './guard-features';
import { fold, norm } from './text';

const DELETE_CMDS = new Set(['rm', 'rmdir', 'unlink', 'del', 'erase', 'rd', 'remove-item', 'ri', 'rimraf', 'shred', 'srm']);
const REGENERABLE = new Set(['node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', 'target', '__pycache__', '.cache', 'tmp', 'logs', '.turbo', '.pytest_cache', '.venv', 'venv']);
const URL_IN_TEXT = /(?:https?|ftp):\/\/[^\s'"<>|;()`\\]+/;
const SECRET_PARAM = /token|key|secret|passw|pwd|auth|session|sig/i;
const MAX = 3;

type Feats = Set<string>;

interface Ctx {
  call: ToolCall;
  feats: Feats;
  raw: string;
  ws?: string;
  wsSegs: string[] | null;
  wsAbs: boolean;
  block: boolean;
}

/** Safer alternatives to a call the guard did not allow (an empty list for allowed calls). */
export function repairs(call: ToolCall, result: GuardResult): Repair[] {
  if (result.decision === 'allow') return [];
  const feats = new Set(guardFeaturesOf(call));
  const wsRaw = norm(call.workspaceRoot ?? '').replace(/\\/g, '/');
  const ctx: Ctx = {
    call,
    feats,
    raw: fold(call.args?.command ?? call.args?.cmd ?? ''),
    ws: call.workspaceRoot,
    wsSegs: wsRaw ? wsRaw.split('/').filter((s) => s !== '' && s !== '.') : null,
    wsAbs: wsRaw.startsWith('/') || /^[a-z]:(\/|$)/.test(wsRaw),
    block: result.decision === 'block',
  };
  const out: Repair[] = [];
  // Every candidate is checked by the guard before it is offered (REINS keeps only
  // edits that leave the policy satisfied): a suggestion the guard would block is dropped.
  const add = (r: Repair | null | undefined): void => {
    if (!r || out.length >= MAX || out.some((o) => JSON.stringify(o.call) === JSON.stringify(r.call))) return;
    if (guard(r.call).decision === 'block') return;
    out.push(r);
  };
  for (const r of hardRefusals(ctx)) add(r);
  if (out.length === 0) {
    switch (call.tool) {
      case 'run_command':
        for (const r of commandRepairs(ctx)) add(r);
        break;
      case 'fetch_url':
        for (const r of fetchRepairs(ctx)) add(r);
        break;
      case 'write_file':
        for (const r of writeRepairs(ctx)) add(r);
        break;
      case 'delete_file':
        for (const r of deleteFileRepairs(ctx)) add(r);
        break;
      case 'read_file':
      case 'list_files':
      case 'search':
        for (const r of readRepairs(ctx)) add(r);
        break;
      case 'run_js':
        break;
    }
  }
  if (out.length === 0 && ctx.block) add(fallbackRefusal(ctx, result));
  return out;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function withWs(ctx: Ctx, tool: ToolCall['tool'], args: Record<string, string>): ToolCall {
  return ctx.ws ? { tool, args, workspaceRoot: ctx.ws } : { tool, args };
}

function command(ctx: Ctx, cmd: string): ToolCall {
  return withWs(ctx, 'run_command', { command: cmd });
}

/** Shell-quote one word if it needs it. */
function shq(s: string): string {
  return /^[A-Za-z0-9_./~@%+=:,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * SUPPRESS: a harmless echo that hands the agent the reason as its tool
 * result. The echoed text is a short plain sentence (no paths, quotes or
 * shell syntax), so the repaired call is itself an obviously safe command;
 * longer detail goes into `why`, which is never executed.
 */
function refuse(ctx: Ctx, reason: string, detail = ''): Repair {
  const clean = reason.replace(/["$`\\]/g, '').replace(/\s+/g, ' ').trim();
  return {
    title: 'Refuse and tell the agent why',
    call: command(ctx, `echo "glassbox refused this call: ${clean}"`),
    why: `Refused because ${clean}.${detail ? ` ${detail}` : ''} Nothing runs: the agent gets this explanation as the tool result and can pick a safer step.`,
  };
}

function fallbackRefusal(ctx: Ctx, result: GuardResult): Repair {
  const top = result.evidence.find((e) => e.cls === result.decision && e.polarity === 1);
  return refuse(ctx, 'it matched a blocking rule and no safer variant is known', top ? `Strongest rule: ${top.rule}.` : '');
}

function where(ctx: Ctx, target: string): 'inside' | 'root' | 'outside' | 'escape' {
  return resolveTarget(norm(target).replace(/\\/g, '/'), ctx.wsSegs, ctx.wsAbs);
}

function isGitDir(t: string): boolean {
  return /(^|[\\/])\.git([\\/]|$)/i.test(t);
}

function trashMove(targets: string[]): string {
  return `mkdir -p .trash && mv -- ${targets.map(shq).join(' ')} .trash/`;
}

function listWorkspace(ctx: Ctx, why: string): Repair {
  return { title: 'Look first: list the workspace', call: withWs(ctx, 'list_files', { path: '.' }), why };
}

// ---------------------------------------------------------------------------
// refusals that apply whatever the tool
// ---------------------------------------------------------------------------

function hardRefusals(ctx: Ctx): Repair[] {
  const f = ctx.feats;
  if (!ctx.block) return [];
  const reasons: [string, string][] = [
    ['exfil:secret_to_net', 'it would send a secret or credential over the network'],
    ['sys:reverse_shell', 'it opens a remote shell on this machine for someone else'],
    ['sys:miner', 'it starts a crypto miner'],
    ['sh:fork_bomb', 'it is a fork bomb that freezes the machine'],
    ['sys:disk', 'it overwrites or formats a disk'],
    ['sys:shutdown', 'it shuts down or reboots the machine'],
    ['exec:kill_all', 'it kills every process on the machine'],
    ['sys:security_off', 'it switches off a security control'],
    ['sys:history_tamper', 'it erases shell history, which hides what happened'],
    ['perm:sudoers', 'it grants passwordless root access'],
    ['perm:user_mgmt', 'it changes operating-system accounts or passwords'],
    ['perm:setuid', 'it sets the setuid bit, a privilege-escalation path'],
    ['net:metadata', 'the cloud metadata service hands out machine credentials'],
    ['sys:kernel', 'it changes kernel settings or modules'],
    ['js:child_process', 'the script spawns shell commands from inside the browser sandbox'],
    ['js:remote_import', 'the script downloads code and runs it'],
  ];
  for (const [feat, why] of reasons) if (f.has(feat)) return [refuse(ctx, why)];
  return [];
}

// ---------------------------------------------------------------------------
// run_command
// ---------------------------------------------------------------------------

function commandRepairs(ctx: Ctx): Repair[] {
  const f = ctx.feats;
  const out: Repair[] = [];
  const raw = ctx.raw;

  if (f.has('net:fetch_exec') || f.has('net:pipe_to_shell') || f.has('net:download_then_run')) {
    if (['net:ip_host', 'net:http_plain', 'net:risky_tld', 'net:paste_webhook', 'net:shortener'].some((x) => f.has(x))) {
      return [refuse(ctx, 'the script comes from a host that looks untrusted (a raw IP, plain http, a shortener or a high-risk domain), so even downloading it for review is not suggested')];
    }
    const m = URL_IN_TEXT.exec(raw);
    if (m) {
      const url = m[0];
      const file = (url.split(/[?#]/)[0].split('/').pop() || 'install.sh').replace(/[^A-Za-z0-9._-]/g, '') || 'install.sh';
      out.push({
        title: 'Download the script and show it first',
        call: withWs(ctx, 'fetch_url', { url }),
        why: 'Piping a remote script into a shell runs code nobody has read. Fetch it, read it, then decide whether to run it.',
      });
      out.push({
        title: 'Save it to a file for review',
        call: command(ctx, `curl -fsSL ${shq(url)} -o ${shq('.glassbox-downloads/' + (file.includes('.') ? file : file + '.sh'))} --create-dirs`),
        why: 'Keeps the script inside the workspace without executing it, so it can be inspected and run by a person.',
      });
      return out;
    }
  }

  if (f.has('git:force_push') || f.has('git:delete_remote') || f.has('git:history_rewrite') || f.has('git:reset_hard') || f.has('git:clean_force') || f.has('git:discard_changes')) {
    out.push(...gitRepairs(ctx));
    if (out.length) return out;
  }

  if (f.has('exec:infra_destroy')) {
    const r = infraRepair(ctx);
    if (r) return [r];
  }

  if (f.has('del:any') || f.has('exec:find_delete') || f.has('del:shred')) {
    out.push(...deleteRepairs(ctx));
    if (out.length) return out;
  }

  if (f.has('perm:world_writable') || f.has('perm:owner_root')) {
    out.push(...chmodRepairs(ctx));
    if (out.length) return out;
  }

  if (f.has('pkg:custom_index') || f.has('pkg:global') || f.has('pkg:from_url') || f.has('pkg:registry_config')) {
    out.push(...packageRepairs(ctx));
    if (out.length) return out;
  }

  if (f.has('exec:env_dump')) {
    out.push({
      title: 'List the variable names, not their values',
      call: command(ctx, 'env | cut -d= -f1 | sort'),
      why: 'Shows which variables exist without copying secrets into the conversation.',
    });
    return out;
  }

  if (f.has('exec:secret_var')) {
    const m = /\$\{?([A-Za-z_][A-Za-z0-9_]*)/.exec(raw);
    if (m) {
      out.push({
        title: 'Check that it is set without printing it',
        call: command(ctx, `test -n "$${m[1]}" && echo "${m[1]} is set" || echo "${m[1]} is empty"`),
        why: `Confirms ${m[1]} exists without putting its value into logs or the conversation.`,
      });
      return out;
    }
  }

  if (f.has('path:env_file') && !ctx.block) {
    const t = envTarget(raw);
    if (t) {
      out.push({
        title: 'Show the keys, not the values',
        call: command(ctx, `grep -o '^[A-Za-z_][A-Za-z0-9_]*=' ${shq(t)}`),
        why: 'Lists which variables the file defines without exposing the secrets themselves.',
      });
      return out;
    }
  }

  if (f.has('path:sensitive') || f.has('path:ssh_private_key') || f.has('path:cloud_creds')) {
    return [refuse(ctx, 'the file holds a private key or credentials, which the agent never needs to read')];
  }

  if (f.has('sh:sudo')) {
    const stripped = raw.replace(/^\s*sudo\s+(-\S+\s+)*/, '');
    if (stripped !== raw && stripped.trim()) {
      out.push({ title: 'Run it without sudo', call: command(ctx, stripped), why: 'Most project tasks do not need root; running without sudo keeps mistakes inside your own permissions.' });
      return out;
    }
  }

  if (f.has('exec:db_destructive') && ctx.block) {
    return [refuse(ctx, 'it destroys database data; take a backup and run it yourself if it is really intended')];
  }
  return out;
}

function gitRepairs(ctx: Ctx): Repair[] {
  const f = ctx.feats;
  const raw = ctx.raw;
  const out: Repair[] = [];
  if (/\breflog\s+expire\b|--prune=now/.test(raw)) return [refuse(ctx, 'it permanently deletes the commits git could otherwise recover')];
  if (f.has('git:delete_remote') && f.has('git:protected_branch')) return [refuse(ctx, 'it deletes a protected branch on the remote')];
  if (/\bpush\b[^|;&\n]*\s--(all|mirror)\b/.test(raw) && (f.has('git:force_push') || /--mirror/.test(raw))) {
    return [refuse(ctx, 'it would force-overwrite every branch on the remote')];
  }
  if (f.has('git:force_push')) {
    const fixed = raw.replace(/\bgit\b[^|;&\n]*\spush\b[^|;&\n]*/g, (seg) => {
      let s = seg
        .replace(/(\s)--force(?![-\w])/g, '$1--force-with-lease')
        .replace(/(\s)-f(?=\s|$)/g, '$1--force-with-lease')
        .replace(/(\s)\+([\w./-]+)/g, '$1$2');
      if (!/--force-with-lease/.test(s)) s = s.replace(/\spush\b/, ' push --force-with-lease');
      return s.replace(/(\s)(HEAD:)?(main|master|production|prod|release|trunk|live|stable)(?=\s|$)/i, '$1HEAD:$3-rewrite');
    });
    const toBranch = fixed !== raw && /-rewrite\b/.test(fixed);
    out.push({
      title: toBranch ? 'Push to a new branch with --force-with-lease' : 'Use --force-with-lease',
      call: command(ctx, fixed),
      why: toBranch
        ? 'Leaves the protected branch untouched: the rewritten history goes to a new branch where it can be reviewed and merged, and --force-with-lease refuses to overwrite commits you have not fetched.'
        : '--force-with-lease refuses to overwrite commits on the remote that you have not seen, so nobody else\'s work is lost.',
    });
    return out;
  }
  if (f.has('git:reset_hard')) {
    out.push({
      title: 'Stash local work before resetting',
      call: command(ctx, `git stash push -u -m "glassbox: before reset" && ${raw.trim()}`),
      why: 'git reset --hard throws away uncommitted changes; stashing first keeps them recoverable with git stash pop.',
    });
    return out;
  }
  if (f.has('git:clean_force')) {
    const x = /\bclean\b[^|;&\n]*\s-[a-z]*x/i.test(raw) ? 'x' : '';
    out.push({ title: 'Preview what git clean would delete', call: command(ctx, `git clean -nd${x}`), why: 'A dry run (-n) lists the untracked files first; nothing is deleted.' });
    return out;
  }
  if (f.has('git:discard_changes')) {
    out.push({ title: 'Stash the changes instead of discarding them', call: command(ctx, 'git stash push -u -m "glassbox: kept before discard"'), why: 'Same clean working tree, but the changes can come back with git stash pop.' });
    return out;
  }
  if (f.has('git:history_rewrite') && ctx.block) return [refuse(ctx, 'it rewrites shared git history')];
  return out;
}

function infraRepair(ctx: Ctx): Repair | null {
  const raw = ctx.raw.trim();
  if (/\bterraform\s+destroy\b/.test(raw)) {
    return { title: 'Preview the destroy plan instead', call: command(ctx, 'terraform plan -destroy'), why: 'Shows exactly what would be destroyed without touching any infrastructure.' };
  }
  const k = /\bkubectl\s+delete\s+(.*)$/.exec(raw);
  if (k) {
    const rest = k[1].split(/\s+/).filter((t) => t && !/^--(force|grace-period|now|wait|all)(=.*)?$/.test(t)).join(' ');
    return { title: 'Inspect the resources instead', call: command(ctx, `kubectl get ${rest}`.trim()), why: 'Lists what the delete would remove; nothing changes in the cluster.' };
  }
  const h = /\bhelm\s+(uninstall|delete)\s+(.*)$/.exec(raw);
  if (h) return { title: 'Check the release status instead', call: command(ctx, `helm status ${h[2]}`), why: 'Shows the release and its resources without removing them.' };
  const s3 = /\baws\s+s3\s+(rm|rb)\s+(s3:\/\/\S+)/.exec(raw);
  if (s3) return { title: 'List the bucket contents instead', call: command(ctx, `aws s3 ls ${s3[2]} --recursive --summarize`), why: 'Shows what would be deleted; nothing is removed.' };
  return ctx.block ? refuse(ctx, 'it destroys cloud infrastructure') : null;
}

function deleteRepairs(ctx: Ctx): Repair[] {
  const raw = ctx.raw;
  const out: Repair[] = [];
  if (/\bfind\b[^|;&\n]*\s-delete\b/.test(raw)) {
    const start = /\bfind\s+(\S+)/.exec(raw)?.[1];
    const outsideStart = !!start && !start.startsWith('-') && where(ctx, start) !== 'inside' && where(ctx, start) !== 'root';
    const listing = raw.replace(/\s-delete\b/, ' -print');
    out.push(
      outsideStart
        ? {
            title: 'List the matching files in the workspace instead',
            call: command(ctx, listing.replace(/\bfind\s+\S+/, 'find .')),
            why: `Searching from ${start} reaches outside the project and -delete would remove every match. This lists the matches inside the workspace; nothing is deleted.`,
          }
        : { title: 'List what would be deleted first', call: command(ctx, listing), why: 'Same search with -print instead of -delete: you see every match before anything is removed.' },
    );
    return out;
  }
  const inside: string[] = [];
  const outside: string[] = [];
  let protectedHit = '';
  for (const toks of shellSegments(raw)) {
    let i = 0;
    while (i < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) || /^(sudo|doas|command|xargs|npx)$/i.test(toks[i]))) i++;
    const word = (toks[i] ?? '').replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
    if (!DELETE_CMDS.has(word)) continue;
    for (const t of toks.slice(i + 1)) {
      if (isFlag(norm(t)) || t === '--') continue;
      const w = where(ctx, t);
      if (isGitDir(t)) protectedHit = protectedHit || '.git (the repository history)';
      else if (w === 'root' || t === '*' || t === './*') protectedHit = protectedHit || 'the whole workspace';
      else if (w === 'inside') inside.push(t);
      else outside.push(t);
    }
  }
  if (inside.length && !protectedHit) {
    out.push({
      title: 'Move it to .trash instead of deleting it',
      call: command(ctx, trashMove(inside)),
      why: outside.length
        ? `Keeps the workspace part reversible and drops ${outside.join(', ')}, which is outside the workspace (a stray space or variable is the usual cause).`
        : 'Same clean-up, but reversible: the files can be restored from .trash until you empty it.',
    });
    return out;
  }
  if (outside.length || protectedHit) {
    const local = outside
      .map((t) => t.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? '')
      .filter((b) => REGENERABLE.has(b.toLowerCase()));
    if (local.length && !protectedHit) {
      out.push({
        title: 'Clean the workspace copy instead',
        call: command(ctx, trashMove(local.map((b) => './' + b))),
        why: `The command reaches outside the workspace (${outside.join(', ')}). The workspace has its own ${local.join(', ')}, which can be moved to .trash and restored later.`,
      });
    }
    const what = protectedHit || outside.join(', ');
    out.push(listWorkspace(ctx, `Deleting ${what} cannot be undone and is not part of this project. List the workspace, pick the specific folder you meant, and move it into .trash.`));
    return out;
  }
  return out;
}

function chmodRepairs(ctx: Ctx): Repair[] {
  const raw = ctx.raw;
  for (const toks of shellSegments(raw)) {
    let i = 0;
    while (i < toks.length && /^(sudo|doas)$/i.test(toks[i])) i++;
    if ((toks[i] ?? '').toLowerCase() !== 'chmod') continue;
    const flags = toks.slice(i + 1).filter((t) => isFlag(norm(t)));
    const args = toks.slice(i + 1).filter((t) => !isFlag(norm(t)));
    const [mode, ...targets] = args;
    if (!mode || !targets.length) continue;
    if (targets.some((t) => where(ctx, t) !== 'inside')) {
      return [refuse(ctx, 'it opens up permissions on files outside the workspace')];
    }
    const safe = /666|6[0-7]6/.test(mode) ? '644' : '755';
    return [{
      title: `Use chmod ${safe} instead`,
      call: command(ctx, ['chmod', ...flags, safe, ...targets.map(shq)].join(' ')),
      why: `${mode} lets every user on the machine modify the files; ${safe} keeps write access with the owner${safe === '755' ? ' and still lets scripts run' : ''}.`,
    }];
  }
  return ctx.block ? [refuse(ctx, 'it changes ownership or permissions of system files')] : [];
}

function packageRepairs(ctx: Ctx): Repair[] {
  const raw = ctx.raw;
  const f = ctx.feats;
  if (f.has('pkg:registry_config') || (f.has('pkg:from_url') && f.has('net:unknown_host'))) {
    return [refuse(ctx, 'the package source is not a trusted registry, so its contents cannot be verified')];
  }
  if (f.has('pkg:custom_index')) {
    const cleaned = raw
      .replace(/\s--(index-url|extra-index-url|trusted-host|registry)(=|\s+)\S+/g, '')
      .replace(/\s-i\s+https?:\/\/\S+/g, '')
      .replace(/^\s*sudo\s+/, '')
      .replace(/\s--break-system-packages\b/g, '');
    return [{ title: 'Install from the default registry', call: command(ctx, cleaned), why: 'Drops the custom package index: packages then come from the official registry, where names cannot be silently swapped.' }];
  }
  if (f.has('pkg:global')) {
    const m = /\b(npm|pnpm|yarn|bun)\b.*?\b(install|i|add)\b((?:\s+\S+)*)/.exec(raw);
    if (m) {
      const pkgs = m[3].split(/\s+/).filter((t) => t && !t.startsWith('-') && t !== 'global');
      if (pkgs.length) return [{ title: 'Install it into the project instead', call: command(ctx, `npm install --save-dev ${pkgs.map(shq).join(' ')}`), why: 'A project-local dev dependency needs no global or root access and is pinned in the lockfile.' }];
    }
    const p = /\bpip3?\b.*?\binstall\b((?:\s+\S+)*)/.exec(raw);
    if (p) {
      const pkgs = p[1].split(/\s+/).filter((t) => t && !t.startsWith('-'));
      if (pkgs.length) return [{ title: 'Install into a project virtualenv', call: command(ctx, `python -m venv .venv && .venv/bin/python -m pip install ${pkgs.map(shq).join(' ')}`), why: 'Keeps the system Python untouched and needs no sudo.' }];
    }
  }
  return [];
}

function envTarget(raw: string): string | null {
  for (const toks of shellSegments(raw)) for (const t of toks) if (/(^|\/)\.env(\.[a-z]+)?$/i.test(t)) return t;
  return null;
}

// ---------------------------------------------------------------------------
// other tools
// ---------------------------------------------------------------------------

function fetchRepairs(ctx: Ctx): Repair[] {
  const f = ctx.feats;
  const url = ctx.call.args?.url ?? '';
  const method = (ctx.call.args?.method ?? 'GET').toUpperCase();
  if (f.has('net:file_url')) return [refuse(ctx, 'it reads a local file through a file URL, outside the workspace tools')];
  if ((f.has('secret:any') || f.has('net:url_secret')) && method !== 'GET') return [refuse(ctx, 'it sends a credential to another server')];
  let parsed: URL | null = null;
  try {
    parsed = new URL(url.includes('://') ? url : 'https://' + url);
  } catch {
    parsed = null;
  }
  if (!parsed) return ctx.block ? [refuse(ctx, 'the URL could not be checked')] : [];
  const out: Repair[] = [];
  if (f.has('net:url_secret') || f.has('secret:any')) {
    for (const k of [...parsed.searchParams.keys()]) if (SECRET_PARAM.test(k)) parsed.searchParams.delete(k);
    out.push({ title: 'Remove the credential from the URL', call: withWs(ctx, 'fetch_url', { ...ctx.call.args, url: parsed.toString() }), why: 'Credentials in URLs end up in server logs, proxies and browser history.' });
  }
  if (parsed.protocol === 'http:' && !f.has('net:localhost') && !f.has('net:ip_host')) {
    const https = new URL(parsed.toString());
    https.protocol = 'https:';
    out.push({ title: 'Use https', call: withWs(ctx, 'fetch_url', { ...ctx.call.args, url: https.toString() }), why: 'Plain http can be read and modified by anyone on the network path.' });
  }
  if (!out.length && ctx.block) out.push(refuse(ctx, 'the destination is not a trusted host for this request'));
  return out;
}

function writeRepairs(ctx: Ctx): Repair[] {
  const f = ctx.feats;
  const path = ctx.call.args?.path ?? ctx.call.args?.file ?? '';
  const content = ctx.call.args?.content ?? '';
  const base = path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'file';
  if (f.has('path:outside_ws') || f.has('path:system_write') || f.has('path:persist_write')) {
    if (['content:pipe_to_shell', 'content:obfuscated', 'content:alias_hijack', 'sys:reverse_shell', 'content:destructive'].some((x) => f.has(x))) {
      return [refuse(ctx, 'the content would run downloaded or destructive code outside the project')];
    }
    return [{
      title: 'Write a proposal inside the workspace',
      // ".proposed" keeps the copy inert: it is not a shell startup file, key list or crontab by name
      call: withWs(ctx, 'write_file', { path: `.glassbox-proposals/${base.replace(/^\.+/, '')}.proposed`, content }),
      why: `${path} is outside the workspace${f.has('path:persist_write') ? ' and runs automatically at login or on a schedule' : ''}. The proposed content is saved in the project so a person can review it and apply it by hand.`,
    }];
  }
  if (f.has('secret:any') && !f.has('path:env_file')) {
    const redacted = content
      .replace(/\b(sk-(proj-|live-|test-)?[0-9A-Za-z_-]{20,}|(sk|rk)_live_[0-9A-Za-z]{16,}|gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,}|xox[abprs]-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|npm_[0-9A-Za-z]{30,})/g, 'REDACTED_USE_AN_ENV_VARIABLE')
      .replace(/-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g, 'REDACTED_PRIVATE_KEY');
    if (redacted !== content) {
      return [{ title: 'Keep the secret out of source code', call: withWs(ctx, 'write_file', { ...ctx.call.args, content: redacted }), why: 'Secrets in source files end up in git history. Read the value from an environment variable instead.' }];
    }
  }
  return ctx.block ? [refuse(ctx, 'the write could not be made safe automatically')] : [];
}

function deleteFileRepairs(ctx: Ctx): Repair[] {
  const path = ctx.call.args?.path ?? ctx.call.args?.file ?? '';
  const w = path ? where(ctx, path) : 'outside';
  if (path && w === 'inside' && !isGitDir(path)) {
    return [{ title: 'Move it to .trash instead of deleting it', call: command(ctx, trashMove([path])), why: 'Same result for the project, but the file can be restored from .trash.' }];
  }
  return [listWorkspace(ctx, `${path || 'That path'} is ${isGitDir(path) ? 'the repository history' : w === 'root' ? 'the workspace itself' : 'outside the workspace'}; deleting it cannot be undone. List the workspace and pick a specific file instead.`)];
}

function readRepairs(ctx: Ctx): Repair[] {
  const f = ctx.feats;
  const path = ctx.call.args?.path ?? '';
  if (ctx.call.tool === 'search' && (f.has('path:outside_ws') || f.has('query:secret_hunt'))) {
    return [{ title: 'Search the workspace only', call: withWs(ctx, 'search', { ...ctx.call.args, path: '.' }), why: 'Searching outside the project (or for credentials) can surface secrets the task does not need.' }];
  }
  if (f.has('path:env_file') && !ctx.block && path) {
    return [{ title: 'Show the keys, not the values', call: command(ctx, `grep -o '^[A-Za-z_][A-Za-z0-9_]*=' ${shq(path)}`), why: 'Lists which variables the file defines without exposing the secrets themselves.' }];
  }
  if (f.has('path:sensitive') || f.has('path:ssh_private_key') || f.has('path:cloud_creds') || f.has('path:browser_data')) {
    return [refuse(ctx, 'the file holds a private key or credentials, which the agent never needs to read')];
  }
  return [];
}
