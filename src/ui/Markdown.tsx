import { Fragment, memo, type ReactNode } from 'react';
import { useWorkspace, workspace } from '../workspace/store';

// A small, safe Markdown renderer that builds React elements (no innerHTML).
// It understands paragraphs, headings, lists, fenced code, inline code, bold,
// italics, links, and file citations like [src/config.js:12] or src/a.js:3-8.

const CITE = /\[?((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]*):(\d+)(?:-(\d+))?\]?/g;

function Citation({ path, line, end, raw }: { path: string; line: number; end?: number; raw?: string }) {
  const exists = useWorkspace((s) => path in s.files);
  const label = `${path}:${line}${end ? `-${end}` : ''}`;
  if (!exists) return raw !== undefined ? <>{raw}</> : <code>{label}</code>;
  return (
    <button type="button" className="cite" onClick={() => workspace.openFile(path, line)} title={`Open ${path} at line ${line}`}>
      {label}
    </button>
  );
}

function withCitations(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(CITE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    out.push(<Citation key={`${key}c${i++}`} raw={m[0]} path={m[1]} line={parseInt(m[2], 10)} end={m[3] ? parseInt(m[3], 10) : undefined} />);
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code first so nothing inside it is touched.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(\*[^*\s][^*]*\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(...withCitations(text.slice(last, idx), `${key}t${i}`));
    const k = `${key}i${i++}`;
    if (m[1]) {
      const code = m[1].slice(1, -1);
      const cite = /^((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]*):(\d+)(?:-(\d+))?$/.exec(code);
      out.push(cite ? <Citation key={k} path={cite[1]} line={parseInt(cite[2], 10)} end={cite[3] ? parseInt(cite[3], 10) : undefined} /> : <code key={k}>{code}</code>);
    } else if (m[2]) out.push(<strong key={k}>{inline(m[2].slice(2, -2), k)}</strong>);
    else if (m[3]) {
      const label = /^\[([^\]]+)\]/.exec(m[3])?.[1] ?? m[4];
      out.push(
        <a key={k} href={m[4]} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
    } else if (m[5]) out.push(<em key={k}>{m[5].slice(1, -1)}</em>);
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(...withCitations(text.slice(last), `${key}e`));
  return out;
}

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'ul' | 'ol'; items: string[] };

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      blocks.push({ t: 'code', lang: fence[1], text: body.join('\n') });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ t: 'h', level: h[1].length, text: h[2] });
      continue;
    }
    const li = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]);
      const prev = blocks[blocks.length - 1];
      if (prev && prev.t === (ordered ? 'ol' : 'ul')) prev.items.push(li[2]);
      else blocks.push({ t: ordered ? 'ol' : 'ul', items: [li[2]] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case 'p':
            return <p key={k}>{inline(b.text, k)}</p>;
          case 'h':
            return (
              <p key={k} className={`md-h md-h${b.level}`}>
                {inline(b.text, k)}
              </p>
            );
          case 'code':
            return (
              <pre key={k} className="md-pre" tabIndex={0}>
                <code>{b.text}</code>
              </pre>
            );
          case 'ul':
          case 'ol': {
            const List = b.t;
            return (
              <List key={k}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Fragment>{inline(it, `${k}l${j}`)}</Fragment>
                  </li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
});
