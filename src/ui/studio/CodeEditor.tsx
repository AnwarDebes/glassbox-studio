import { useEffect, useRef } from 'react';
import Editor, { DiffEditor, type OnMount } from '@monaco-editor/react';
import { monaco } from './monaco';
import { useWorkspace, workspace } from '../../workspace/store';
import { languageFor } from '../../workspace/paths';

// Loaded on demand: this module pulls in Monaco.

const FONT = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace";

const baseOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: FONT,
  fontSize: 13,
  lineHeight: 21,
  fontLigatures: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  stickyScroll: { enabled: false },
  renderLineHighlight: 'line',
  padding: { top: 12, bottom: 12 },
  automaticLayout: true,
  tabSize: 2,
  bracketPairColorization: { enabled: true },
  guides: { indentation: true },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  ariaLabel: 'Code editor',
};

interface FileEditorProps {
  path: string;
  theme: 'dark' | 'light';
  readOnly?: boolean;
}

export function FileEditor({ path, theme, readOnly }: FileEditorProps) {
  const value = useWorkspace((s) => s.files[path] ?? '');
  const reveal = useWorkspace((s) => s.reveal);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    decorations.current = editor.createDecorationsCollection();
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void workspace.flush(path);
    });
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !reveal || reveal.path !== path) return;
    const line = Math.max(1, Math.min(reveal.line, editor.getModel()?.getLineCount() ?? reveal.line));
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    decorations.current?.set([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'gbx-reveal-line' } }]);
    const t = setTimeout(() => decorations.current?.clear(), 1800);
    return () => clearTimeout(t);
  }, [reveal, path]);

  return (
    <Editor
      path={path}
      value={value}
      language={languageFor(path)}
      theme={theme === 'dark' ? 'glassbox-dark' : 'glassbox-light'}
      onMount={onMount}
      onChange={(v) => {
        if (v !== undefined && v !== useWorkspace.getState().files[path]) void workspace.write(path, v);
      }}
      options={{ ...baseOptions, readOnly }}
      loading={<div className="editor-loading">Opening {path}</div>}
    />
  );
}

interface ReviewEditorProps {
  reviewId: string;
  path: string;
  before: string;
  after: string;
  theme: 'dark' | 'light';
  sideBySide: boolean;
}

export function ReviewEditor({ reviewId, path, before, after, theme, sideBySide }: ReviewEditorProps) {
  const originalUri = `review-original://${reviewId}/${path}`;
  const proposedUri = `review-proposed://${reviewId}/${path}`;

  // The diff widget must be disposed before its models, so the models are kept
  // through unmount and released here once the widget is gone.
  useEffect(
    () => () => {
      setTimeout(() => {
        monaco.editor.getModel(monaco.Uri.parse(originalUri))?.dispose();
        monaco.editor.getModel(monaco.Uri.parse(proposedUri))?.dispose();
      }, 0);
    },
    [originalUri, proposedUri],
  );

  return (
    <DiffEditor
      original={before}
      modified={after}
      language={languageFor(path)}
      originalModelPath={originalUri}
      modifiedModelPath={proposedUri}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      theme={theme === 'dark' ? 'glassbox-dark' : 'glassbox-light'}
      options={{
        ...baseOptions,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: sideBySide,
        ariaLabel: `Proposed changes to ${path}`,
      }}
      loading={<div className="editor-loading">Preparing the review</div>}
    />
  );
}

export default FileEditor;
