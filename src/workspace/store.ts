import { create } from 'zustand';
import { SAMPLE_NAME, sampleFiles } from './sample';
import { load, save, saveSoon, remove } from './persist';
import { deleteFromDisk, permissionOf, readDirectory, writeToDisk } from './fs-access';

export type WorkspaceKind = 'sample' | 'local' | 'zip';

interface Snapshot {
  name: string;
  kind: WorkspaceKind;
  files: Record<string, string>;
  disk?: Record<string, string>;
}

export interface Reveal {
  path: string;
  line: number;
  nonce: number;
}

export interface WorkspaceState {
  ready: boolean;
  name: string;
  kind: WorkspaceKind;
  files: Record<string, string>;
  /** Local folders: the content last read from or written to disk. */
  disk: Record<string, string>;
  handle: FileSystemDirectoryHandle | null;
  permission: PermissionState | 'none';
  tabs: string[];
  active: string | null;
  reveal: Reveal | null;
  expanded: Record<string, boolean>;
}

const initial: WorkspaceState = {
  ready: false,
  name: SAMPLE_NAME,
  kind: 'sample',
  files: {},
  disk: {},
  handle: null,
  permission: 'none',
  tabs: [],
  active: null,
  reveal: null,
  expanded: { src: true, test: true },
};

export const useWorkspace = create<WorkspaceState>(() => initial);

const set = useWorkspace.setState;
const get = useWorkspace.getState;

function persist() {
  saveSoon('workspace', () => {
    const s = get();
    const snap: Snapshot = { name: s.name, kind: s.kind, files: s.files, disk: s.kind === 'local' ? s.disk : undefined };
    return snap;
  });
}

export const workspace = {
  /** Restore the last workspace, or start with the sample project. */
  async init() {
    const snap = await load<Snapshot>('workspace');
    const handle = await load<FileSystemDirectoryHandle>('workspace-handle');
    if (snap && Object.keys(snap.files).length) {
      const permission = snap.kind === 'local' && handle ? await permissionOf(handle, false) : 'none';
      set({ ready: true, name: snap.name, kind: snap.kind, files: snap.files, disk: snap.disk ?? {}, handle: snap.kind === 'local' ? handle ?? null : null, permission });
    } else {
      set({ ready: true, name: SAMPLE_NAME, kind: 'sample', files: sampleFiles(), disk: {} });
    }
    const first = ['src/config.js', 'README.md'].find((p) => p in get().files) ?? Object.keys(get().files)[0] ?? null;
    if (first) workspace.openFile(first);
  },

  resetToSample() {
    set({ ...initial, ready: true, files: sampleFiles(), tabs: [], active: null });
    void remove('workspace-handle');
    persist();
    workspace.openFile('src/config.js');
  },

  loadFiles(name: string, kind: WorkspaceKind, files: Record<string, string>, handle: FileSystemDirectoryHandle | null = null) {
    // Small projects open with their top-level folders expanded.
    const paths = Object.keys(files);
    const expanded: Record<string, boolean> = {};
    if (paths.length <= 200) for (const p of paths) if (p.includes('/')) expanded[p.split('/')[0]] = true;
    set({
      name,
      kind,
      files,
      disk: kind === 'local' ? { ...files } : {},
      handle,
      permission: handle ? 'granted' : 'none',
      tabs: [],
      active: null,
      reveal: null,
      expanded,
    });
    if (handle) void save('workspace-handle', handle);
    else void remove('workspace-handle');
    persist();
    const readme = Object.keys(files).find((p) => /^readme\.md$/i.test(p));
    if (readme) workspace.openFile(readme);
  },

  /** Ask the browser again for access to a remembered local folder. */
  async reconnect(): Promise<boolean> {
    const { handle } = get();
    if (!handle) return false;
    const state = await permissionOf(handle, true);
    set({ permission: state });
    if (state !== 'granted') return false;
    const { files } = await readDirectory(handle);
    set({ files, disk: { ...files } });
    persist();
    return true;
  },

  read(path: string): string | undefined {
    return get().files[path];
  },

  /** Change a file in the workspace (and on disk for local folders when allowed). */
  async write(path: string, content: string, opts: { toDisk?: boolean } = {}) {
    set((s) => ({ files: { ...s.files, [path]: content } }));
    persist();
    if (opts.toDisk) await workspace.flush(path);
  },

  async remove(path: string, opts: { toDisk?: boolean } = {}) {
    const s = get();
    const files = { ...s.files };
    delete files[path];
    const tabs = s.tabs.filter((t) => t !== path);
    set({ files, tabs, active: s.active === path ? tabs[tabs.length - 1] ?? null : s.active });
    persist();
    if (opts.toDisk && s.kind === 'local' && s.handle && s.permission === 'granted') {
      try {
        await deleteFromDisk(s.handle, path);
        set((st) => {
          const disk = { ...st.disk };
          delete disk[path];
          return { disk };
        });
      } catch {
        /* file may already be gone on disk */
      }
    }
  },

  /** Write one file to the local folder. Returns false when there is no writable folder. */
  async flush(path: string): Promise<boolean> {
    const s = get();
    if (s.kind !== 'local' || !s.handle) return false;
    let permission = s.permission;
    if (permission !== 'granted') {
      permission = await permissionOf(s.handle, true);
      set({ permission });
    }
    if (permission !== 'granted') return false;
    const content = s.files[path];
    if (content === undefined) return false;
    await writeToDisk(s.handle, path, content);
    set((st) => ({ disk: { ...st.disk, [path]: content } }));
    persist();
    return true;
  },

  isDirty(path: string): boolean {
    const s = get();
    return s.kind === 'local' && s.files[path] !== s.disk[path];
  },

  openFile(path: string, line?: number) {
    set((s) => {
      const tabs = s.tabs.includes(path) ? s.tabs : [...s.tabs, path];
      const parts = path.split('/');
      const expanded = { ...s.expanded };
      for (let i = 1; i < parts.length; i++) expanded[parts.slice(0, i).join('/')] = true;
      return { tabs, active: path, expanded, reveal: line ? { path, line, nonce: Date.now() } : s.reveal };
    });
  },

  openTab(id: string) {
    set((s) => ({ tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id], active: id }));
  },

  closeTab(id: string) {
    set((s) => {
      const i = s.tabs.indexOf(id);
      const tabs = s.tabs.filter((t) => t !== id);
      const active = s.active === id ? tabs[Math.min(i, tabs.length - 1)] ?? null : s.active;
      return { tabs, active };
    });
  },

  toggleFolder(path: string) {
    set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } }));
  },
};
