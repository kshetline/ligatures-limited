import { last as _last, processMillis } from 'ks-util';
import {
  activate as scopeInfoActivate, deactivate as scopeInfoDeactivate, reloadGrammar,
  setCompactScope
} from './scope-info/scope-info';
import { ExtensionContext, Position, Range, TextDocument, TextEditor, window, workspace, Selection } from 'vscode';

const basicLigatures = String.raw`.= .- := =:= == != === !== =/= <-< <<- <-- <- <-> -> --> ->> >-> <=< <<= <== <=> => ==>
  '=>> >=> >>= >>- >- <~> -< -<< =<< <~~ <~ ~~ ~> ~~> <<< << <= <> >= >> >>> {. {| [| <: :> |] |} .}
  '<||| <|| <| <|> |> ||> |||> <$ <$> $> <+ <+> +> <* <*> *> \\ \\\ \* */ /// // <// <!-- </> --> />
  ';; :: ::: .. ... ..< !! ?? %% && || ?. ?: ++ +++ -- --- ** *** ~= ~- www ff fi fl ffi ffl
  '-~ ~@ ^= ?= /= /== |= ||= #! ## ### #### #{ #[ ]# #( #? #_ #_('`.split(/\s+/);
const disabledLigatures = new Set<string>(['ff', 'fi', 'fl', 'ffi', 'ffl']);
const ligatureContexts = new Set<string>(['operator', 'comment_marker', 'punctuation']);
const escapeRegex = /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g;
const breakNormal = window.createTextEditorDecorationType({ color: '' });
const breakDebug = window.createTextEditorDecorationType({ color: 'red', backgroundColor: 'white' });

let matchLigatures: RegExp;

type SelectionMode = 'cursor' | 'line' | 'off' | 'selection';

interface LLConfiguration {
  additionalLigatures: string | string[];
  alwaysAllowed: string | string[];
  alwaysDisabled: string | string[];
  alwaysIgnored: string | string[];
  compactScope: boolean;
  debug: boolean;
  selectionMode: SelectionMode;

  languages: Record<string, {
    alwaysAllowed: string | string[];
    alwaysDisabled: string | string[];
  }>;
}

export function activate(context: ExtensionContext): void {
  const scopeInfoApi = scopeInfoActivate(context);
  let breakLigature = breakNormal;
  const highlightLigature = window.createTextEditorDecorationType({ color: 'green', backgroundColor: 'white' });
  let configuration = readConfiguration() as LLConfiguration;
  let debug = false;
  let selectionMode: SelectionMode = 'off';

  workspace.onDidChangeConfiguration(() => {
    configuration = readConfiguration();
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

  init();

  function init(): void {
    debug = !!configuration?.debug;

    if (debug)
      breakLigature = breakDebug;
    else
      breakLigature = breakNormal;

    setCompactScope(!!configuration?.compactScope);
    selectionMode = (configuration?.selectionMode?.toString().toLowerCase() || 'off') as SelectionMode;

    if (!/^(cursor|line|off|selection)$/.test(selectionMode))
      throw new Error('Invalid selectionMode');

    basicLigatures.sort((a, b) => b.length - a.length);
    matchLigatures = new RegExp(basicLigatures.map(lg => lg.replace(escapeRegex, '\\$&')).join('|'), 'g');
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
    breaks: Range[] = [], highlights: Range[] = []): void {
    if (!workspace.textDocuments.includes(document) || !window.visibleTextEditors.includes(editor))
      return;

    const started = processMillis();

    for (let i = first; i <= last; ++i) {
      const line = document.lineAt(i).text;
      let match: RegExpExecArray;

      while ((match = matchLigatures.exec(line))) {
        const index = match.index;
        let ligature = match[0];
        let selected = false;
        let shortened = false;
        const scope = scopeInfoApi.getScopeAt(document, new Position(i, index));
        const category = scope.category;
        const specificScope = _last(scope.scopes);

        // Did the matched ligature overshoot a token boundary?
        if (ligature.length > scope.text.length) {
          shortened = true;
          matchLigatures.lastIndex -= ligature.length - scope.text.length;
          ligature = ligature.substr(0, scope.text.length);
        }

        if (selectionMode !== 'off' && editor.selections?.length > 0 && (isInsert(editor.selections) || selectionMode !== 'cursor')) {
          const range = selectionMode === 'line' ?
            new Range(i, 0, i, line.length) : new Range(i, index, i, index + ligature.length);

          for (let j = 0; j < editor.selections.length && !selected; ++j) {
            const selection = editor.selections[j];

            selected = !!selection.intersection(range);
          }
        }

        // console.log('match: %s, token: %s, line: %s, pos: %s, ', ligature, scope.text, i, index, scope.category); // , scope.scopes.join(', '));

        if (shortened || selected || disabledLigatures.has(ligature) ||
          (!ligatureContexts.has(category) && !ligatureContexts.has(specificScope))) {
          for (let j = 0; j < ligature.length; ++j)
            breaks.push(new Range(i, index + j, i, index + j + 1));
        }
        else if (debug)
          highlights.push(new Range(i, index, i, index + ligature.length));
      }

      if (processMillis() > started + 50) {
        setTimeout(() => lookForLigatures(document, editor, i + 1, last, breaks, highlights), 50);
        return;
      }
    }

    editor.setDecorations(breakLigature, breaks);

    if (debug)
      editor.setDecorations(highlightLigature, highlights);
  }
}

function readConfiguration(): any {
  return workspace.getConfiguration().get('ligaturesLimited') as any;
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
