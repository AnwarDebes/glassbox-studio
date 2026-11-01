// Monaco, bundled with the app instead of loaded from a CDN, so the editor
// works offline and nothing is fetched from third parties. Only the core
// editor worker is used; languages get syntax highlighting without the heavy
// language-service workers.
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/scss/register.js';
import 'monaco-editor/languages/definitions/less/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import 'monaco-editor/languages/definitions/ini/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/rust/register.js';
import 'monaco-editor/languages/definitions/go/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/kotlin/register.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/csharp/register.js';
import 'monaco-editor/languages/definitions/php/register.js';
import 'monaco-editor/languages/definitions/ruby/register.js';
import 'monaco-editor/languages/definitions/sql/register.js';
import 'monaco-editor/languages/definitions/swift/register.js';
import 'monaco-editor/languages/definitions/lua/register.js';
import 'monaco-editor/languages/definitions/dockerfile/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { loader } from '@monaco-editor/react';

(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// JSON highlighting without the JSON language service.
monaco.languages.register({ id: 'json', extensions: ['.json', '.jsonc', '.webmanifest'], aliases: ['JSON'] });
monaco.languages.setMonarchTokensProvider('json', {
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/\/\/.*$/, 'comment'],
      [/[{}[\],:]/, 'delimiter'],
    ],
  },
});

monaco.editor.defineTheme('glassbox-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6f8b91', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c3b4ff' },
    { token: 'string', foreground: '9ee6bb' },
    { token: 'number', foreground: 'f4c45e' },
    { token: 'type', foreground: '7ce7df' },
    { token: 'identifier', foreground: 'e3eff1' },
    { token: 'delimiter', foreground: '8fa8ae' },
    { token: 'regexp', foreground: 'ffb38a' },
  ],
  colors: {
    'editor.background': '#00000000',
    'editor.foreground': '#e3eff1',
    'editorLineNumber.foreground': '#4a6369',
    'editorLineNumber.activeForeground': '#a7bdc2',
    'editor.lineHighlightBackground': '#ffffff07',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#7ce7df33',
    'editor.inactiveSelectionBackground': '#7ce7df1a',
    'editorCursor.foreground': '#7ce7df',
    'editorIndentGuide.background1': '#ffffff0d',
    'editorIndentGuide.activeBackground1': '#ffffff24',
    'editorWidget.background': '#0d2228',
    'editorWidget.border': '#ffffff1f',
    'editorSuggestWidget.background': '#0d2228',
    'editorHoverWidget.background': '#0d2228',
    'editorGutter.background': '#00000000',
    'diffEditor.insertedTextBackground': '#5fd8a026',
    'diffEditor.removedTextBackground': '#ff7d8826',
    'diffEditor.insertedLineBackground': '#5fd8a012',
    'diffEditor.removedLineBackground': '#ff7d8812',
    'scrollbarSlider.background': '#ffffff12',
    'scrollbarSlider.hoverBackground': '#ffffff22',
    'minimap.background': '#00000000',
    focusBorder: '#7ce7df66',
  },
});

monaco.editor.defineTheme('glassbox-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '5f7b81', fontStyle: 'italic' },
    { token: 'keyword', foreground: '5841d4' },
    { token: 'string', foreground: '0f7446' },
    { token: 'number', foreground: '8a5a00' },
    { token: 'type', foreground: '067a73' },
    { token: 'delimiter', foreground: '4f6d74' },
    { token: 'regexp', foreground: 'a3480f' },
  ],
  colors: {
    'editor.background': '#00000000',
    'editor.foreground': '#0b2025',
    'editorLineNumber.foreground': '#8aa3a9',
    'editorLineNumber.activeForeground': '#36555c',
    'editor.lineHighlightBackground': '#0a343c08',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#067a7326',
    'editorCursor.foreground': '#067a73',
    'editorWidget.background': '#f3f8f9',
    'editorGutter.background': '#00000000',
    'diffEditor.insertedTextBackground': '#0f744626',
    'diffEditor.removedTextBackground': '#bf2a4122',
    'diffEditor.insertedLineBackground': '#0f744612',
    'diffEditor.removedLineBackground': '#bf2a4110',
    'minimap.background': '#00000000',
    focusBorder: '#067a7366',
  },
});

loader.config({ monaco });

if (typeof document !== 'undefined' && document.fonts) {
  void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
}

export { monaco };
