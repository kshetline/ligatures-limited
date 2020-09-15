// The technique used in the code below for suppressing the rendering of ligatures
// was derived from https://github.com/CoenraadS/vscode-Disable-Ligatures.
//
// This extension also replicates (and expands) the functionality provided by
// vscode-Disable-Ligatures.

import {
  ContextConfig, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_LINES, getLigatureMatcher, InternalConfig, ligaturesToRegex,
  readConfiguration, resetConfiguration, SelectionMode
} from './configuration';
import { registerCommand, showInfoMessage } from './extension-util';
import { last as _last, processMillis } from 'ks-util';
import {
  activate as scopeInfoActivate, deactivate as scopeInfoDeactivate, onChangeDocument, getLanguageIdFromScope,
  reloadGrammar, wasmReady
} from './scope-info/scope-info';
import {
  ExtensionContext, Position, Range, TextDocument, TextEditor, window, workspace, Selection, ThemeColor,
  TextEditorSelectionChangeEvent
} from 'vscode';

export const breakNormal = window.createTextEditorDecorationType({
  after: { contentText: '\u200A', width: '0' }
});
export const breakDebug = window.createTextEditorDecorationType({
  color: 'red',
  backgroundColor: new ThemeColor('editor.foreground'),
  after: { contentText: '\u200A', width: '0' }
});
export const highlightLigature = window.createTextEditorDecorationType({ color: 'green',
  backgroundColor: new ThemeColor('editor.foreground') });
export const allLigatures = window.createTextEditorDecorationType({ backgroundColor: '#0000FF18' });
export const ligatureDecorations = [breakNormal, breakDebug, highlightLigature, allLigatures];

const OPEN_DOCUMENT_DELAY = 100;
const MAX_TIME_FOR_PROCESSING_LINES = 100;
const PROCESS_YIELD_TIME = 50;
const WAIT_FOR_PARSE_RETRY_TIME = 250;
const MAX_PARSE_RETRY_ATTEMPTS = 5;
const RANGE_DELAY = 2000;

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

const openTimes = new Map<TextDocument, number>();
const openDocumentTimers = new Map<TextDocument, any>();
const selectionTimers = new Map<TextEditor, any>();
const visibleRanges = new Map<TextEditor, { range: Range, time: number }>();
const inProgress = new Map<TextEditor, { first: number, last: number, timer: any }>();
const savedSelections = new Map<TextEditor, Selection[]>();
const savedRanges = new Map<TextEditor, {
  breaks: Range[],
  debugBreaks: Range[],
  highlights: Range[],
  background: Range[]
}>();

export async function activate(context: ExtensionContext): Promise<void> {
  await wasmReady;
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
    const editors = window.visibleTextEditors;

    selectionTimers.forEach((timer, editor) => {
      if (!editors.includes(editor)) {
        clearTimeout(timer);
        selectionTimers.delete(editor);
      }
    });

    inProgress.forEach((progress, editor) => {
      if (!editors.includes(editor)) {
        if (progress.timer)
          clearTimeout(progress.timer);

        inProgress.delete(editor);
      }
    });

    Array.from(visibleRanges.keys()).forEach(editor => {
      if (!editors.includes(editor))
        visibleRanges.delete(editor);
    });

    for (const editor of editors)
      reviewDocument(editor.document);
  });

  window.onDidChangeTextEditorSelection(event => {
    const editor = event.textEditor;
    const doc = editor.document;

    if (!window.visibleTextEditors.includes(editor))
      savedSelections.delete(editor);
    else if (openDocumentTimers.has(doc) && getEditors(doc)) {
      if (selectionTimers.has(editor))
        clearTimeout(selectionTimers.get(editor));

      selectionTimers.set(editor, setTimeout(() => selectionChange(event), OPEN_DOCUMENT_DELAY));
    }
    else if (!getEditors(doc)) {
      const editors = getEditors(doc, true);

      if (editors)
        selectionChange(event, editors[0]);
    }
    else
      selectionChange(event);
  });

  function selectionChange(event: TextEditorSelectionChangeEvent, editor = event.textEditor): void {
    const doc = editor.document;
    const lastSelections = savedSelections.get(editor);

    savedSelections.set(editor, Array.from(event.selections));

    let first = doc.lineCount;
    let last = -1;
    let firstSkip: number;
    let lastSkip: number;
    const findSelectionBounds = (s: Selection) => {
      first = Math.min(s.anchor.line, s.active.line, first);
      last = Math.max(s.anchor.line, s.active.line, last);
    };

    event.selections.forEach(findSelectionBounds);

    if (lastSelections) {
      const saveFirst = first;
      const saveLast = last;

      first = doc.lineCount;
      last = -1;
      lastSelections.forEach(findSelectionBounds);

      if (first > saveLast) {
        firstSkip = saveLast + 1;
        lastSkip = first - 1;
        first = saveFirst;
      }
      else if (last < saveFirst) {
        firstSkip = last + 1;
        lastSkip = saveFirst - 1;
        last = saveLast;
      }
      else {
        first = Math.min(first, saveFirst);
        last = Math.max(last, saveLast);
      }
    }

    first = Math.min(first, doc.lineCount - 1);

    if (last >= 0 && first <= last)
      reviewDocument(doc, 1, first, last, firstSkip, lastSkip);
  }

  window.onDidChangeTextEditorVisibleRanges(event => {
    const range = (event.visibleRanges ?? [])[0];

    if (range)
      visibleRanges.set(event.textEditor, { range, time: processMillis() });
  });

  workspace.onDidChangeTextDocument(changeEvent => {
    if (changeEvent.contentChanges.length > 0) {
      onChangeDocument(changeEvent);

      const doc = changeEvent.document;
      let first = doc.lineCount;
      let last = -1;
      let linesChanged = 0;

      changeEvent.contentChanges.forEach(change => {
        first = Math.min(first, change.range.start.line);
        last = Math.max(last, change.range.end.line);
        linesChanged += change.range.end.line - change.range.start.line + 1;
      });

      last = Math.min(last + linesChanged, doc.lineCount - 1);

      if (last >= 0 && first <= last)
        reviewDocument(doc, 1, first, last);
    }
  });

  workspace.onDidOpenTextDocument(document => {
    if (openDocumentTimers.has(document))
      clearTimeout(openDocumentTimers.get(document));

    openTimes.set(document, processMillis());
    openDocumentTimers.set(document, setTimeout(() => reviewDocument(document), OPEN_DOCUMENT_DELAY));
  });

  workspace.onDidCloseTextDocument(document => {
    if (openDocumentTimers.has(document))
      clearTimeout(openDocumentTimers.get(document));

    openDocumentTimers.delete(document);
    openTimes.delete(document);
    maxSizeWarningFiles.delete(document);

    const editors = getEditors(document);

    if (editors)
      editors.forEach(editor => {
        if (selectionTimers.has(editor))
          clearTimeout(selectionTimers.get(editor));

        selectionTimers.delete(editor);
        visibleRanges.delete(editor);
        savedRanges.delete(editor);
        inProgress.delete(editor);
        savedSelections.delete(editor);
      });
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
      firstSkip?: number, lastSkip?: number): void {
    if (attempt > MAX_PARSE_RETRY_ATTEMPTS || first < 0)
      return;

    const editors = getEditors(document);

    if (!isValidDocument(document) || !editors)
      return;

    currentDocument = document;

    if (!scopeInfoApi.getScopeAt(document, new Position(0, 0))) {
      setTimeout(() => reviewDocument(document, ++attempt, first, last),
        WAIT_FOR_PARSE_RETRY_TIME);
      return;
    }

    editors.forEach(editor => {
      let ranges = savedRanges.get(editor);

      if (attempt === 1 && ranges && ranges.background.length === 0 && (first !== 0 || last !== document.lineCount - 1) && !inProgress.has(editor)) {
        const clearOldRanges = (r: Range[]) => {
          for (let i = 0; i < r.length; ++i) {
            const line = r[i].start.line;

            if (first <= line && line <= last && (firstSkip === undefined || line < firstSkip || line > lastSkip))
              r.splice(i--, 1);
          }
        };

        clearOldRanges(ranges.breaks);
        clearOldRanges(ranges.debugBreaks);
        clearOldRanges(ranges.highlights);
      }
      else {
        first = 0;
        last = document.lineCount - 1;
        firstSkip = lastSkip = undefined;
        ranges = undefined;
      }

      savedSelections.set(editor, editor.selections);
      lookForLigatures(document, editor, first, last, firstSkip, lastSkip, ranges?.breaks, ranges?.debugBreaks, ranges?.highlights);
    });
  }

  function clearRanges(r: Range[], first: number, last: number): void {
    for (let i = 0; i < r.length; ++i) {
      const line = r[i].start.line;

      if (first <= line && line <= last)
        r.splice(i--, 1);
    }
  };

  function lookForLigatures(document: TextDocument, editor: TextEditor, first: number, last: number,
      firstSkip?: number, lastSkip?: number,
      breaks: Range[] = [], debugBreaks: Range[] = [], highlights: Range[] = [], pass = 0): void {
    if (!workspace.textDocuments.includes(document) || !window.visibleTextEditors.includes(editor)) {
      inProgress.delete(editor);

      return;
    }

    if (pass === 0 && inProgress.has(editor)) {
      const currentRange = inProgress.get(editor);

      if (first > 0 || last < document.lineCount - 1) {
        first = Math.min(first, currentRange.first);
        last = Math.max(last, currentRange.last);
        clearRanges(breaks, first, last);
        clearRanges(debugBreaks, first, last);
        clearRanges(highlights, first, last);
        inProgress.set(editor, { first, last, timer: currentRange.timer });

        return;
      }
      else {
        if (currentRange.timer)
          clearTimeout(currentRange.timer);

        inProgress.delete(editor);
        firstSkip = lastSkip = undefined;
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

    firstSkip = firstSkip ?? document.lineCount;
    lastSkip = lastSkip ?? -1;

    let doSort = pass === 0 && (breaks.length > 0 || debugBreaks.length > 0 || highlights.length > 0);
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
      last = Math.min(last, document.lineCount - 1);

      const started = processMillis();
      const matcher = getLigatureMatcher();
      let firstInView = document.lineCount;
      let lastInView = -1;
      const processLines = (first0: number, last0: number, checkTime = true): boolean => {
        let lastTokenLanguage: string;
        let lastTokenConfig: InternalConfig | boolean;

        matcher.lastIndex = 0;

        for (let i = first0; i <= last0; ++i) {
          if ((firstSkip <= i && i <= lastSkip) || (firstInView <= i && i <= lastInView))
            continue;

          const line = document.lineAt(i).text;
          let match: RegExpExecArray;
          let lastHighlight: Range;
          let lastHighlightCategory: string;

          const extendedLength = (charEnd: number, category: string): number => {
            const saveIndex = matcher.lastIndex;
            const extendCandidate = line.substr(charEnd - 2, 3);
            let result = 0;

            matcher.lastIndex = (extendCandidate === '==/' ? 0 : 1); // Special case, since =/ by itself isn't a known ligature.

            if (extendCandidate.length === 3 && matcher.test(extendCandidate) &&
                scopeInfoApi.getScopeAt(document, new Position(i, charEnd + 1))?.category === category)
              result = 1;

            matcher.lastIndex = saveIndex;

            return result;
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
              selectionMode = selectionModeOverride ?? readConfiguration().selectionMode;
            }
            else {
              selectionMode = selectionModeOverride ?? langConfig.selectionMode;

              const langLigaturesMatch = langConfig.ligaturesMatch;
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
              const contextLigaturesMatch = contextConfig?.ligaturesMatch ?? langLigaturesMatch;
              const listedAreEnabled = contextConfig?.ligaturesListedAreEnabled ?? langListedAreEnabled;

              contextLigaturesMatch.lastIndex = 0;
              debug = globalDebug ?? contextConfig?.debug ?? langConfig.debug;
              suppress = shortened || contextLigaturesMatch.test(ligature) !== listedAreEnabled ||
                !matchesContext(contexts, specificScope, category);
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
              const length = ligature.length + extendedLength(index + ligature.length, category);
              const theBreaks = (debug ? debugBreaks : breaks);
              const lastBreak = _last(theBreaks);

              if (lastBreak && lastBreak.start.line === i && lastBreak.start.character === index)
                theBreaks.pop();

              for (let j = 0; j < length; ++j)
                theBreaks.push(new Range(i, index + j, i, index + j + 1));
            }
            else if (debug) {
              const length = ligature.length + extendedLength(index + ligature.length, category);
              let highlight = new Range(i, index, i, index + length);

              if (lastHighlight && lastHighlightCategory === category) {
                const diff = lastHighlight.end.character - highlight.start.character;

                if (diff === 0 || diff === 1) {
                  highlights.pop();
                  highlight = new Range(lastHighlight.start, highlight.end);
                }
              }

              highlights.push(highlight);
              lastHighlight = highlight;
              lastHighlightCategory = category;
            }
          }

          if (checkTime && processMillis() > started + MAX_TIME_FOR_PROCESSING_LINES) {
            inProgress.set(editor, {
              first: i + 1,
              last,
              timer: setTimeout(() => {
                const currentRange = inProgress.get(editor);

                if (currentRange)
                  lookForLigatures(document, editor, currentRange.first, currentRange.last, undefined, undefined,
                    breaks, debugBreaks, highlights, pass + 1);
              }, PROCESS_YIELD_TIME)
            });

            return true;
          }
        }

        return false;
      };

      // Take care of what's currently visible on screen first.
      if (pass === 0 && editor.visibleRanges?.length === 1) {
        let range = editor.visibleRanges[0];
        // Oddly enough, a visible range reported by a recent onDidChangeTextEditorVisibleRanges event
        // will be more accurate than the visible range info inside the editor object itself.
        const lastRange = visibleRanges.get(editor);

        if (lastRange && processMillis() < lastRange.time + RANGE_DELAY)
          range = lastRange.range;

        const viewFirst = Math.max(first, Math.min(range.start.line - 1, range.end.line - 1));
        const viewLast = Math.min(last, Math.max(range.start.line + 1, range.end.line + 1));

        processLines(viewFirst, viewLast, false);
        editor.setDecorations(breakNormal, breaks);
        editor.setDecorations(breakDebug, debugBreaks);
        editor.setDecorations(highlightLigature, highlights);
        editor.setDecorations(allLigatures, background);

        firstInView = viewFirst;
        lastInView = viewLast;
        doSort = true;
      }

      if (processLines(first, last))
        return;
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
    savedRanges.set(editor, { breaks, debugBreaks, highlights, background });
    inProgress.delete(editor);
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

  if (match && match.ligatures && !(match.ligaturesMatch instanceof RegExp))
    match.ligaturesMatch = ligaturesToRegex(match.ligatures);

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

function getEditors(document: TextDocument, tryHarder = false): TextEditor[] {
  let editors: TextEditor[] = window.visibleTextEditors.filter(editor => editor.document === document);

  if (editors.length === 0 && tryHarder && document.fileName.endsWith('.git')) {
    const name = document.fileName.substr(0, document.fileName.length - 4);

    editors = window.visibleTextEditors.filter(editor => editor.document.fileName === name);
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
