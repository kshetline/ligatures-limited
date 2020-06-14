// The technique used in the code below for suppressing the rendering of ligatures
// was derived from https://github.com/CoenraadS/vscode-Disable-Ligatures.
//
// This extension also replicates (and expands) the functionality provided by
// vscode-Disable-Ligatures.

import {
  ContextConfig, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_LINES, getLigatureMatcher, InternalConfig, readConfiguration,
  resetConfiguration, SelectionMode
} from './configuration';
import { registerCommand, showInfoMessage } from './extension-util';
import { last as _last, processMillis } from 'ks-util';
import { activate as scopeInfoActivate, deactivate as scopeInfoDeactivate, getLanguageIdFromScope, reloadGrammar } from './scope-info/scope-info';
import { ExtensionContext, Position, Range, TextDocument, TextEditor, window, workspace, Selection, ThemeColor } from 'vscode';

export const breakNormal = window.createTextEditorDecorationType({ color: '' });
export const breakDebug = window.createTextEditorDecorationType({ color: 'red', backgroundColor: new ThemeColor('editor.foreground') });
export const highlightLigature = window.createTextEditorDecorationType({ color: 'green', backgroundColor: new ThemeColor('editor.foreground') });
export const allLigatures = window.createTextEditorDecorationType({ backgroundColor: '#0000FF18' });
export const ligatureDecorations = [breakNormal, breakDebug, highlightLigature, allLigatures];

const MAX_TIME_FOR_PROCESSING_LINES = 100;
const PROCESS_YIELD_TIME = 50;
const WAIT_FOR_PARSE_RETRY_TIME = 250;
const MAX_PARSE_RETRY_ATTEMPTS = 5;

const bleedThroughs = new Set(['?:', '+=', '-=', '*=', '/=', '^=']);
const SLASH3 = String.raw`\\\ `.trim();
let globalDebug: boolean = null;
let selectionModeOverride: SelectionMode = null;
const selectionModes: SelectionMode[] = [null, 'off', 'cursor', 'line', 'selection'];
let currentDocument: TextDocument;
let ligatureSuppression = true;
let maxLines = DEFAULT_MAX_LINES;
let maxFileSize = DEFAULT_MAX_FILE_SIZE;
const maxSizeWarningFiles = new Set<TextDocument>();
let globalLigatureWarningEnabled = true;
let globalMaxSizeWarningEnabled = true;

const inProgress = new Map<TextDocument, { first: number, last: number }>();
const savedSelections = new Map<TextDocument, Selection[]>();
const savedRanges = new Map<TextDocument, {
  breaks: Range[],
  debugBreaks: Range[],
  highlights: Range[],
  background: Range[]
}>();

export function activate(context: ExtensionContext): void {
  const scopeInfoApi = scopeInfoActivate(context);

  registerCommand(context, 'ligaturesLimited.cycleLigatureDebug', cycleDebug);
  registerCommand(context, 'ligaturesLimited.cycleSelectionMode', cycleSelectionMode);
  registerCommand(context, 'ligaturesLimited.toggleLigatureSuppression', toggleLigatures);

  workspace.onDidChangeConfiguration(() => {
    resetConfiguration();

    const config = readConfiguration();

    maxFileSize = config.maxFileSize;
    maxLines = config.maxLines;
    selectionModeOverride = config.selectionMode;
    reloadGrammar();
    init();
  }, null, context.subscriptions);

  window.onDidChangeVisibleTextEditors(() => {
    for (const editor of window.visibleTextEditors)
      reviewDocument(editor.document);
  });

  window.onDidChangeTextEditorSelection(event => {
    if (window.visibleTextEditors.includes(event.textEditor)) {
      const doc = event.textEditor.document;
      const ranges = savedRanges.get(doc);
      const lastSelections = savedSelections.get(doc);

      savedSelections.set(doc, Array.from(event.selections));

      if (ranges && ranges.background.length === 0) {
        let first = doc.lineCount;
        let last = -1;
        const findSelectionBounds = (s: Selection) => {
          first = Math.min(s.anchor.line, s.active.line, first);
          last = Math.max(s.anchor.line, s.active.line, last);
        };
        const clearOldRanges = (r: Range[]) => {
          for (let i = 0; i < r.length; ++i) {
            const line = r[i].start.line;

            if (first <= line && line <= last)
              r.splice(i--, 1);
          }
        };

        event.selections.forEach(findSelectionBounds);

        if (lastSelections)
          lastSelections.forEach(findSelectionBounds);

        if (first < doc.lineCount && first <= last) {
          clearOldRanges(ranges.breaks);
          clearOldRanges(ranges.debugBreaks);
          clearOldRanges(ranges.highlights);
          reviewDocument(doc, 0, first, last, ranges.breaks, ranges.debugBreaks, ranges.highlights);
        }
      }
      else {
        savedSelections.delete(doc);
        reviewDocument(doc);
      }
    }
    else if (event.textEditor.document)
      savedSelections.delete(event.textEditor.document);
  });

  workspace.onDidChangeTextDocument(changeEvent => {
    if (changeEvent.contentChanges.length > 0)
      reviewDocument(changeEvent.document);
  });

  workspace.onDidOpenTextDocument(document => {
    reviewDocument(document);
  });

  workspace.onDidCloseTextDocument(document => {
    inProgress.delete(document);
    maxSizeWarningFiles.delete(document);
    savedRanges.delete(document);
    savedSelections.delete(document);
  });

  selectionModeOverride = readConfiguration().selectionMode;
  init();

  function init(): void {
    if (!workspace.getConfiguration().get('editor.fontLigatures') && globalLigatureWarningEnabled) {
      const option1 = 'OK';
      const option2 = "Don't warn again this session.";
      window.showWarningMessage('Ligature fonts are not enabled',
        option1, option2).then(selection => {
        if (selection === option2)
          globalLigatureWarningEnabled = false;
      });
    }

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

  function reviewDocument(document: TextDocument, attempt = 1, first = 0, last = document.lineCount - 1,
      breaks?: Range[], debugBreaks?: Range[], highlights?: Range[]): void {
    if (attempt > MAX_PARSE_RETRY_ATTEMPTS)
      return;

    const editors = getEditors(document);

    if (!isValidDocument(document) || !editors)
      return;

    currentDocument = document;

    if (!scopeInfoApi.getScopeAt(document, new Position(0, 0))) {
      setTimeout(() => reviewDocument(document, ++attempt, first, last, breaks, debugBreaks, highlights),
        WAIT_FOR_PARSE_RETRY_TIME);
      return;
    }

    editors.forEach(editor => lookForLigatures(document, editor, first, last, breaks, debugBreaks, highlights));
  }

  function lookForLigatures(document: TextDocument, editor: TextEditor, first: number, last: number,
      breaks: Range[] = [], debugBreaks: Range[] = [], highlights: Range[] = [], pass = 0): void {
    if (!workspace.textDocuments.includes(document) || !window.visibleTextEditors.includes(editor))
      return;
    else if (pass === 0 && inProgress.has(document)) {
      if (first > 0 || last < document.lineCount - 1) {
        const currentRange = inProgress.get(document);
        inProgress.set(document, { first: Math.min(first, currentRange.first), last: Math.max(last, currentRange.last) });
        return;
      }
      else {
        inProgress.delete(document);
        breaks.length = 0;
        debugBreaks.length = 0;
        highlights.length = 0;
      }
    }

    const docLanguage = document.languageId;
    const docLangConfig = readConfiguration(docLanguage);

    if (typeof docLangConfig === 'object' && docLangConfig.deactivated) {
      editor.setDecorations(allLigatures, []); // This is only needed to signal unit tests that this method has completed.

      return;
    }

    const doSort = pass === 0 && (breaks.length > 0 || debugBreaks.length > 0 || highlights.length > 0);
    const background: Range[] = [];
    const fileSize = document.offsetAt(new Position(document.lineCount, 0));

    if ((maxLines > 0 && document.lineCount > maxLines) || (maxFileSize > 0 && fileSize > maxFileSize)) {
      if (globalMaxSizeWarningEnabled && !maxSizeWarningFiles.has(document)) {
        const option1 = "Don't warn again for this document.";
        const option2 = "Don't warn again this session.";
        window.showWarningMessage('Because of file size, all ligatures in this document will be displayed.',
          option1, option2).then(selection => {
          if (selection === option1)
            maxSizeWarningFiles.add(document);
          else if (selection === option2)
            globalMaxSizeWarningEnabled = false;
        });
      }
    }
    else if (ligatureSuppression) {
      const started = processMillis();
      let lastTokenLanguage: string;
      let lastTokenConfig: InternalConfig | boolean;
      const matcher = getLigatureMatcher();

      for (let i = first; i <= last; ++i) {
        const line = document.lineAt(i).text;
        let match: RegExpExecArray;
        let lastHighlight: Range;
        let lastHighlightCategory: string;

        const checkHighlightExtension = (): void => {
          if (lastHighlight) {
            const saveIndex = matcher.lastIndex;
            const extendCandidate = line.substr(lastHighlight.end.character - 2, 3);

            matcher.lastIndex = 1;

            if (extendCandidate.length === 3 && matcher.test(extendCandidate)) {
              const candidateCategory = scopeInfoApi.getScopeAt(document, new Position(i, lastHighlight.end.character + 1))?.category;

              if (candidateCategory === lastHighlightCategory) {
                highlights.pop();
                highlights.push(new Range(lastHighlight.start, new Position(lastHighlight.end.line, lastHighlight.end.character + 1)));
              }
            }

            matcher.lastIndex = saveIndex;
          }
        };

        while ((match = matcher.exec(line))) {
          const index = match.index;
          let ligature = match[0];
          let selected = false;
          let shortened = false;
          const scope = scopeInfoApi.getScopeAt(document, new Position(i, index));
          let category = scope.category;
          const specificScope = _last(scope.scopes);
          const language = getTokenLanguage(docLanguage, specificScope);
          let langConfig = docLangConfig;
          let suppress: boolean;
          let debug: boolean;
          let selectionMode: SelectionMode;

          if (language !== docLanguage) {
            langConfig = (lastTokenConfig && lastTokenLanguage === language) ? lastTokenConfig :
              lastTokenConfig = readConfiguration(lastTokenLanguage = language);
          }

          if (typeof langConfig === 'boolean') {
            suppress = !langConfig;
            debug = globalDebug;
            selectionMode = readConfiguration().selectionMode;
          }
          else {
            selectionMode = selectionModeOverride ?? langConfig.selectionMode;

            const langLigatures = langConfig.ligatures;
            const contexts = langConfig.contexts;
            const langListedAreEnabled = langConfig.ligaturesListedAreEnabled;

            // Did the matched ligature overshoot a token boundary?
            if (ligature.length > scope.text.length &&
                !bleedThroughs.has(ligature) && !(category === 'string' && ligature === SLASH3)) {
              shortened = true;
              matcher.lastIndex -= ligature.length - scope.text.length;
              ligature = ligature.substr(0, scope.text.length);
            }

            // 0x followed by a hex digit is a special case: the 0x part might be the lead-in to a numeric constant,
            // but treated as a separate keyword.
            // The same applies to 0o followed by an octal digit, or 0b followed by a binary digit.
            if (/^0(x[0-9a-fA-F]|o[0-7]|b[01])$/.test(ligature) && category === 'keyword' && index + ligature.length < line.length) {
              const nextScope = scopeInfoApi.getScopeAt(document, new Position(i, index + ligature.length));

              if (nextScope.category === 'number')
                category = 'number';
            }

            const contextConfig = findContextConfig(langConfig, specificScope, category);
            const contextLigatures = contextConfig?.ligatures ?? langLigatures;
            const listedAreEnabled = contextConfig?.ligaturesListedAreEnabled ?? langListedAreEnabled;

            debug = globalDebug ?? contextConfig?.debug ?? langConfig.debug;
            suppress = shortened || contextLigatures.has(ligature) !== listedAreEnabled || !matchesContext(contexts, specificScope, category);
          }

          if (selectionMode !== 'off' && editor.selections?.length > 0 &&
              (isInsert(editor.selections, i, index, ligature.length) || selectionMode !== 'cursor')) {
            const range = selectionMode === 'line' ?
              new Range(i, 0, i, line.length) : new Range(i, index, i, index + ligature.length);

            for (let j = 0; j < editor.selections.length && !selected; ++j) {
              const selection = editor.selections[j];

              selected = (selectionMode === 'line' ? selection.active.line === i : !!selection.intersection(range));
            }
          }

          if (suppress || selected) {
            for (let j = 0; j < ligature.length; ++j)
              (debug ? debugBreaks : breaks).push(new Range(i, index + j, i, index + j + 1));

            checkHighlightExtension();
          }
          else if (debug) {
            let highlight = new Range(i, index, i, index + ligature.length);

            if (lastHighlight && lastHighlight.end.character === highlight.start.character && lastHighlightCategory === category) {
              highlights.pop();
              highlight = new Range(lastHighlight.start, highlight.end);
            }
            else
              checkHighlightExtension();

            highlights.push(highlight);
            lastHighlight = highlight;
            lastHighlightCategory = category;
          }
        }

        checkHighlightExtension();

        if (processMillis() > started + MAX_TIME_FOR_PROCESSING_LINES) {
          inProgress.set(document, { first: i + 1, last });
          setTimeout(() => {
            const currentRange = inProgress.get(document);

            if (currentRange)
              lookForLigatures(document, editor, currentRange.first, currentRange.last, breaks, debugBreaks, highlights, pass + 1);
          }, PROCESS_YIELD_TIME);
          return;
        }
      }
    }
    else
      background.push(new Range(0, 0, last + 1, 0));

    if (doSort) {
      const sort = (a: Range, b: Range) => a.start.line === b.start.line ? a.start.character - b.start.character : a.start.line - b.start.line;

      breaks.sort(sort);
      debugBreaks.sort(sort);
      highlights.sort(sort);
    }

    editor.setDecorations(breakNormal, breaks);
    editor.setDecorations(breakDebug, debugBreaks);
    editor.setDecorations(highlightLigature, highlights);
    editor.setDecorations(allLigatures, background);
    inProgress.delete(document);
    savedRanges.set(document, { breaks, debugBreaks, highlights, background });
  }
}

function getTokenLanguage(docLanguage: string, scope: string): string {
  const id = (/^.+\.(.+)$/.exec(scope) ?? [])[1];

  if (!id || !/^(html|markdown|xhtml|xml)$/.test(docLanguage))
    return docLanguage;

  return getLanguageIdFromScope(scope) ?? docLanguage;
}

function findContextConfig(config: InternalConfig, scope: string, category: string): ContextConfig {
  const byContext = config.ligaturesByContext;

  if (!byContext)
    return undefined;

  let match = byContext[category];

  while (!match && scope && !(match = byContext[scope]))
    scope = (/^(.+)\../.exec(scope) ?? [])[1];

  return match;
}

function matchesContext(contexts: Set<String>, scope: string, category: string): boolean {
  if (!contexts)
    return false;

  let matches = contexts.has(category);

  while (!matches && scope && !(matches = contexts.has(scope)))
    scope = (/^(.+)\../.exec(scope) ?? [])[1];

  return matches;
}

function isValidDocument(document: TextDocument): boolean {
  return (document !== undefined && document.lineCount > 0 &&
    document.uri.scheme !== 'vscode' && document.uri.scheme !== 'output');
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
