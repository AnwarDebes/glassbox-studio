import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useWorkspace, workspace } from '../../workspace/store';
import { buildTree, extname, type TreeNode } from '../../workspace/paths';
import { Icon } from '../Icon';

interface Row {
  node: TreeNode;
  depth: number;
  parent: string | null;
}

const EXT_TINT: Record<string, string> = {
  js: '#e8c547',
  mjs: '#e8c547',
  cjs: '#e8c547',
  jsx: '#e8c547',
  ts: '#6fa8f5',
  tsx: '#6fa8f5',
  json: '#b9a7ff',
  md: '#7ce7df',
  css: '#f08ad0',
  html: '#ff9a6b',
  py: '#7fb3ff',
};

function flatten(nodes: TreeNode[], expanded: Record<string, boolean>, depth = 0, parent: string | null = null, out: Row[] = []): Row[] {
  for (const node of nodes) {
    out.push({ node, depth, parent });
    if (node.kind === 'dir' && expanded[node.path]) flatten(node.children, expanded, depth + 1, node.path, out);
  }
  return out;
}

export function FileTree({ onOpen }: { onOpen?: () => void }) {
  const paths = useWorkspace((s) => Object.keys(s.files).sort().join('\n'));
  const expanded = useWorkspace((s) => s.expanded);
  const active = useWorkspace((s) => s.active);
  const kind = useWorkspace((s) => s.kind);
  const dirtyKey = useWorkspace((s) => (s.kind === 'local' ? Object.keys(s.files).filter((p) => s.files[p] !== s.disk[p]).join('\n') : ''));
  const dirty = dirtyKey ? dirtyKey.split('\n') : [];
  const tree = useMemo(() => buildTree(paths ? paths.split('\n') : []), [paths]);
  const rows = useMemo(() => flatten(tree, expanded), [tree, expanded]);
  const [focus, setFocus] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const count = paths ? paths.split('\n').length : 0;
  const dirtySet = new Set(dirty);

  const focusRow = (i: number) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, i));
    setFocus(clamped);
    list.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[clamped]?.focus();
  };

  const activate = (row: Row) => {
    if (row.node.kind === 'dir') workspace.toggleFolder(row.node.path);
    else {
      workspace.openFile(row.node.path);
      onOpen?.();
    }
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    const row = rows[i];
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(i + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusRow(0);
        break;
      case 'End':
        e.preventDefault();
        focusRow(rows.length - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (row.node.kind === 'dir') {
          if (!expanded[row.node.path]) workspace.toggleFolder(row.node.path);
          else focusRow(i + 1);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (row.node.kind === 'dir' && expanded[row.node.path]) workspace.toggleFolder(row.node.path);
        else if (row.parent) focusRow(rows.findIndex((r) => r.node.path === row.parent));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        activate(row);
        break;
    }
  };

  return (
    <div className="tree">
      <div className="panel-head">
        <span className="panel-title">Files</span>
        <span className="faint">{count}</span>
        {kind === 'local' && dirty.length ? <span className="pill ask" title="Changed here but not yet saved to disk">{dirty.length} unsaved</span> : null}
      </div>
      {rows.length ? (
        <ul className="tree-list" role="tree" aria-label="Workspace files" ref={list}>
          {rows.map((row, i) => {
            const { node } = row;
            const isDir = node.kind === 'dir';
            const open = isDir && !!expanded[node.path];
            return (
              <li
                key={`${node.kind}:${node.path}`}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={isDir ? open : undefined}
                aria-selected={!isDir && node.path === active}
                tabIndex={i === Math.min(focus, rows.length - 1) ? 0 : -1}
                className={`tree-row ${!isDir && node.path === active ? 'active' : ''}`}
                style={{ paddingLeft: 8 + row.depth * 14 }}
                onClick={() => {
                  setFocus(i);
                  activate(row);
                }}
                onKeyDown={(e) => onKey(e, i)}
                title={node.path}
              >
                {isDir ? (
                  <Icon name="chevron" size={13} className={`tree-chev ${open ? 'open' : ''}`} />
                ) : (
                  <span className="tree-dot" style={{ background: EXT_TINT[extname(node.path)] ?? 'var(--text-3)' }} aria-hidden />
                )}
                {isDir ? <Icon name="folder" size={15} className="tree-icon" /> : null}
                <span className="truncate">{node.name}</span>
                {!isDir && dirtySet.has(node.path) ? (
                  <span className="tree-dirty">
                    <span className="sr-only">unsaved</span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="faint tree-empty">No files yet. Use the workspace menu to open a folder or import a zip.</p>
      )}
    </div>
  );
}
