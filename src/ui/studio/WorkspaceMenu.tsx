import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useWorkspace, workspace } from '../../workspace/store';
import { fsAccessSupported, pickDirectory, readDirectory } from '../../workspace/fs-access';
import { exportZip, importZip } from '../../workspace/zip';
import { useSession } from '../../state/session';
import { toast } from '../../state/ui';
import { Icon } from '../Icon';

const KIND_LABEL = { sample: 'Sample project', local: 'Local folder', zip: 'Imported zip' } as const;

export function WorkspaceMenu() {
  const name = useWorkspace((s) => s.name);
  const kind = useWorkspace((s) => s.kind);
  const permission = useWorkspace((s) => s.permission);
  const running = useSession((s) => s.running);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const supported = fsAccessSupported();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const openFolder = async () => {
    setOpen(false);
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      const { files, skipped, truncated } = await readDirectory(handle);
      workspace.loadFiles(handle.name, 'local', files, handle);
      toast(`Opened ${handle.name}: ${Object.keys(files).length} files${skipped ? `, ${skipped} skipped (binary or large)` : ''}${truncated ? ', list truncated' : ''}.`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open the folder.', 'error');
    }
  };

  const onZip = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { name: zipName, files, skipped } = await importZip(file);
      if (!Object.keys(files).length) {
        toast('That zip has no text files to open.', 'error');
        return;
      }
      workspace.loadFiles(zipName, 'zip', files);
      toast(`Imported ${zipName}: ${Object.keys(files).length} files${skipped ? `, ${skipped} skipped` : ''}.`, 'success');
    } catch {
      toast('Could not read that file as a zip.', 'error');
    }
  };

  return (
    <div className="ws-menu" ref={wrap}>
      <button className="ws-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="folder" size={15} />
        <span className="truncate">{name}</span>
        <span className="ws-kind hide-narrow">{KIND_LABEL[kind]}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {kind === 'local' && permission !== 'granted' ? (
        <button className="btn sm" onClick={() => void workspace.reconnect().then((ok) => toast(ok ? 'Folder reconnected.' : 'Access was not granted.', ok ? 'success' : 'error'))}>
          Reconnect folder
        </button>
      ) : null}
      {open ? (
        <div className="menu float" role="menu" aria-label="Workspace" onKeyDown={onMenuKey}>
          <button role="menuitem" className="menu-item" disabled={!supported || running} onClick={() => void openFolder()}>
            <Icon name="folder" />
            <span className="grow">
              Open local folder
              <span className="menu-note">{supported ? 'Read and write, after you allow it' : 'Needs Chrome or Edge on a desktop'}</span>
            </span>
          </button>
          <button
            role="menuitem"
            className="menu-item"
            disabled={running}
            onClick={() => {
              setOpen(false);
              fileInput.current?.click();
            }}
          >
            <Icon name="upload" />
            <span className="grow">Import .zip</span>
          </button>
          <button
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              void exportZip(name, useWorkspace.getState().files);
            }}
          >
            <Icon name="download" />
            <span className="grow">Export as .zip</span>
          </button>
          <div className="menu-sep" role="separator" />
          <button
            role="menuitem"
            className="menu-item"
            disabled={running}
            onClick={() => {
              setOpen(false);
              workspace.resetToSample();
              toast('Loaded a fresh copy of the sample project.', 'success');
            }}
          >
            <Icon name="refresh" />
            <span className="grow">
              Load the sample project
              <span className="menu-note">Replaces the files open here</span>
            </span>
          </button>
        </div>
      ) : null}
      <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={(e) => void onZip(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
    </div>
  );
}
