import { getLigatureMatcher, resetConfiguration, readConfiguration, SelectionMode } from './configuration';
import { registerCommand, showInfoMessage } from './extension-util';
import { last as _last, processMillis } from 'ks-util';
import { activate as scopeInfoActivate, deactivate as scopeInfoDeactivate, reloadGrammar } from './scope-info/scope-info';
import { ExtensionContext, Position, Range, TextDocument, TextEditor, window, workspace, Selection, ThemeColor } from 'vscode';

const breakNormal = window.createTextEditorDecorationType({ color: '' });
const breakDebug = window.createTextEditorDecorationType({ color: 'red', backgroundColor: new ThemeColor('editor.foreground') });
const highlightLigature = window.createTextEditorDecorationType({ color: 'green', backgroundColor: new ThemeColor('editor.foreground') });
const allLigatures = window.createTextEditorDecorationType({ backgroundColor: '#0000FF18' });
const bleedThroughs = new Set(['?:', '+=', '-=', '*=', '/=', '^=']);
let globalDebug: boolean = null;
let selectionModeOverride: SelectionMode = null;
const selectionModes: SelectionMode[] = [null, 'off', 'cursor', 'line', 'selection'];
let currentDocument: TextDocument;
let ligatureSuppression = true;

export function activate(context: ExtensionContext): void {
  const scopeInfoApi = scopeInfoActivate(context);

  registerCommand(context, 'extension.cycleLigatureDebug', cycleDebug);
  registerCommand(context, 'extension.cycleSelectionMode', cycleSelectionMode);
  registerCommand(context, 'extension.toggleLigatureSuppression', toggleLigatures);

  workspace.onDidChangeConfiguration(() => {
    resetConfiguration();
    selectionModeOverride = readConfiguration().selectionMode;
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

  selectionModeOverride = readConfiguration().selectionMode;
  init();

  function init(): void {
    workspace.textDocuments.forEach(document => reviewDocument(document));
  }

  function cycleDebug(): void {
    if (globalDebug == null)
      globalDebug = true;
    else if (globalDebug)
      globalDebug = false;
    else
      globalDebug = null;

    showInfoMessage('Ligature debug highlighting: ' + (globalDebug == null ? 'by settings' : (globalDebug ? 'all on' : 'all off')));

    if (currentDocument)
      reviewDocument(currentDocument);
  }

  function cycleSelectionMode(): void {
    selectionModeOverride = selectionModes[(Math.max(selectionModes.indexOf(selectionModeOverride), 0) + 1) % selectionModes.length];

    showInfoMessage('Ligature selection disable mode: ' + (selectionModeOverride ?? 'by settings'));

    if (currentDocument)
      reviewDocument(currentDocument);
  }

  function toggleLigatures(): void {
    ligatureSuppression = !ligatureSuppression;
    showInfoMessage('Ligature suppression by Ligatures Limited has been ' +
      (ligatureSuppression ? 'activated' : 'deactivated'));

    if (currentDocument)
      reviewDocument(currentDocument);
  }

  function reviewDocument(document: TextDocument, attempt = 1): void {
    if (attempt > 5)
      return;

    const editors = getEditors(document);

    if (!isValidDocument(document) || !editors)
      return;

    currentDocument = document;

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

    const background: Range[] = [];

    if (ligatureSuppression) {
      const started = processMillis();
      const langConfig = readConfiguration(document.languageId);
      const selectionMode = selectionModeOverride ?? langConfig.selectionMode;
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
          let category = scope.category;
          const specificScope = _last(scope.scopes);

          // Did the matched ligature overshoot a token boundary?
          if (ligature.length > scope.text.length && !bleedThroughs.has(ligature)) {
            shortened = true;
            matcher.lastIndex -= ligature.length - scope.text.length;
            ligature = ligature.substr(0, scope.text.length);
          }

          // 0x followed by a hex digit as a special case: the 0x part might be the lead-in to a numeric constant,
          // but treated as a separate keyword.
          if (/^0x[0-9a-f]$/i.test(ligature) && category === 'keyword' && index + ligature.length < line.length) {
            const nextScope = scopeInfoApi.getScopeAt(document, new Position(i, index + ligature.length));

            if (nextScope.category === 'number')
              category = 'number';
          }

          if (selectionMode !== 'off' && editor.selections?.length > 0 &&
              (isInsert(editor.selections, i, index, ligature.length) || selectionMode !== 'cursor')) {
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
          const debug = globalDebug ?? contextConfig?.debug ?? langConfig.debug;

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
    }
    else
      background.push(new Range(0, 0, last + 1, 0));

    editor.setDecorations(breakNormal, breaks);
    editor.setDecorations(breakDebug, debugBreaks);
    editor.setDecorations(highlightLigature, highlights);
    editor.setDecorations(allLigatures, background);
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

function isInsert(selections: Selection[], line: number, index: number, length: number): boolean {
  if (selections && selections.length === 1) {
    const s = selections[0].start;
    const e = selections[0].end;

    return (s.isEqual(e) || (s.line === line && e.line === line && s.character >= index && e.character <= index + length));
  }

  return false;
}

export function deactivate(): void {
  scopeInfoDeactivate();
}
