import { getLigatureMatcher, resetConfiguration, readConfiguration } from './configuration';
import { last as _last, processMillis } from 'ks-util';
import { activate as scopeInfoActivate, deactivate as scopeInfoDeactivate, reloadGrammar } from './scope-info/scope-info';
import { ExtensionContext, Position, Range, TextDocument, TextEditor, window, workspace, Selection } from 'vscode';

const breakNormal = window.createTextEditorDecorationType({ color: '' });
const breakDebug = window.createTextEditorDecorationType({ color: 'red', backgroundColor: 'white' });
const highlightLigature = window.createTextEditorDecorationType({ color: 'green', backgroundColor: 'white' });
const bleedThroughs = new Set(['?:', '+=', '-=', '*=', '/=', '^=']);

export function activate(context: ExtensionContext): void {
  const scopeInfoApi = scopeInfoActivate(context);

  workspace.onDidChangeConfiguration(() => {
    resetConfiguration();
    readConfiguration();
    reloadGrammar();
    init();
  }, null, context.subscriptions);

  window.onDidChangeVisibleTextEditors(() => {
    for (const editor of window.visibleTextEditors)
      reviewDocument(editor.document);
  });

  window.onDidChangeTextEditorSelection(event => {
    if (window.visibleTextEditors.includes(event.textEditor))
      reviewDocument(event.textEditor.document);
  });

  workspace.onDidChangeTextDocument(changeEvent => {
    if (changeEvent.contentChanges.length > 0)
      reviewDocument(changeEvent.document);
  });

  workspace.onDidOpenTextDocument(document => {
    reviewDocument(document);
  });

  readConfiguration();
  init();

  function init(): void {
    workspace.textDocuments.forEach(document => reviewDocument(document));
  }

  function reviewDocument(document: TextDocument, attempt = 1): void {
    if (attempt > 5)
      return;

    const editors = getEditors(document);

    if (!isValidDocument(document) || !editors)
      return;

    if (!scopeInfoApi.getScopeAt(document, new Position(0, 0))) {
      setTimeout(() => reviewDocument(document, ++attempt), 250);
      return;
    }

    editors.forEach(editor => lookForLigatures(document, editor, 0, document.lineCount - 1));
  }

  function lookForLigatures(document: TextDocument, editor: TextEditor, first: number, last: number,
    breaks: Range[] = [], debugBreaks: Range[] = [], highlights: Range[] = []): void {
    if (!workspace.textDocuments.includes(document) || !window.visibleTextEditors.includes(editor))
      return;

    const started = processMillis();
    const langConfig = readConfiguration(document.languageId);
    const selectionMode = langConfig.selectionMode;
    const langLigatures = langConfig.ligatures;
    const contexts = langConfig.contexts;
    const langListedAreEnabled = langConfig.ligaturesListedAreEnabled;
    const matcher = getLigatureMatcher();

    for (let i = first; i <= last; ++i) {
      const line = document.lineAt(i).text;
      let match: RegExpExecArray;

      while ((match = matcher.exec(line))) {
        const index = match.index;
        let ligature = match[0];
        let selected = false;
        let shortened = false;
        const scope = scopeInfoApi.getScopeAt(document, new Position(i, index));
        const category = scope.category;
        const specificScope = _last(scope.scopes);

        // Did the matched ligature overshoot a token boundary?
        if (ligature.length > scope.text.length && !bleedThroughs.has(ligature)) {
          shortened = true;
          matcher.lastIndex -= ligature.length - scope.text.length;
          ligature = ligature.substr(0, scope.text.length);
        }

        if (selectionMode !== 'off' && editor.selections?.length > 0 &&
            (isInsert(editor.selections) || selectionMode !== 'cursor')) {
          const range = selectionMode === 'line' ?
            new Range(i, 0, i, line.length) : new Range(i, index, i, index + ligature.length);

          for (let j = 0; j < editor.selections.length && !selected; ++j) {
            const selection = editor.selections[j];

            selected = !!selection.intersection(range);
          }
        }

        const contextConfig = (langConfig.ligaturesByContext &&
          (langConfig.ligaturesByContext[specificScope] ?? langConfig.ligaturesByContext[category]));
        const contextLigatures = contextConfig?.ligatures ?? langLigatures;
        const listedAreEnabled = contextConfig?.ligaturesListedAreEnabled ?? langListedAreEnabled;
        const debug = contextConfig?.debug ?? langConfig.debug;

        if (shortened || selected || contextLigatures.has(ligature) !== listedAreEnabled || !contexts.has(category)) {
          for (let j = 0; j < ligature.length; ++j)
            (debug ? debugBreaks : breaks).push(new Range(i, index + j, i, index + j + 1));
        }
        else if (debug)
          highlights.push(new Range(i, index, i, index + ligature.length));
      }

      if (processMillis() > started + 50_000_000) {
        setTimeout(() => lookForLigatures(document, editor, i + 1, last, breaks, debugBreaks, highlights), 50);
        return;
      }
    }

    editor.setDecorations(breakNormal, breaks);
    editor.setDecorations(breakDebug, debugBreaks);
    editor.setDecorations(highlightLigature, highlights);
  }
}

function isValidDocument(document: TextDocument): boolean {
  return (document !== undefined && document.lineCount > 0 &&
    document.uri.scheme !== 'vscode' && document.uri.scheme !== 'output' /* &&
        this.settings.excludedLanguages.has(document.languageId) */);
}

function getEditors(document: TextDocument): TextEditor[] {
  const editors: TextEditor[] = [];

  for (const editor of window.visibleTextEditors) {
    if (editor.document === document)
      editors.push(editor);
  }

  return editors.length > 0 ? editors : undefined;
}

function isInsert(selections: Selection[]): boolean {
  return selections && selections.length === 1 && selections[0].start.isEqual(selections[0].end);
}

export function deactivate(): void {
  scopeInfoDeactivate();
}
