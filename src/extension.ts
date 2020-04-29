import { processMillis } from 'ks-util';
import { activate as scopeInfoActivate, deactivate as scopeInfoDeactivate } from './scope-info/scope-info';
import { ExtensionContext, Range, TextDocument, TextEditor, window, workspace, Position } from 'vscode';

const basicLigatures = ('.= .- := =:= == != === !== =/= <-< <<- <-- <- <-> -> --> ->> >-> <=< <<= <== <=> => ==> ' +
  '=>> >=> >>= >>- >- <~> -< -<< =<< <~~ <~ ~~ ~> ~~> <<< << <= <> >= >> >>> {. {| [| <: :> |] |} .} ' +
  '<||| <|| <| <|> |> ||> |||> <$ <$> $> <+ <+> +> <* <*> *> \\\\ \\\\\\ \\* */ /// // <// <!== </> --> /> ' +
  ';; :: ::: .. ... ..< !! ?? %% && || ?. ?: ++ +++ -- --- ** *** ~= ~- www ' +
  '-~ ~@ ^= ?= /= /== |= ||= #! ## ### #### #{ #[ ]# #( #? #_ #_(').split(/\s+/);
const disabledLigatures = new Set<string>();
const escapeRegex = /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g;
let matchLigatures: RegExp;

export function activate(context: ExtensionContext): void {
  const scopeInfoApi = scopeInfoActivate(context);
  const decoration = window.createTextEditorDecorationType({ color: '' });
  let configuration = readConfiguration();

  basicLigatures.sort((a, b) => b.length - a.length);
  matchLigatures = new RegExp(basicLigatures.map(lg => lg.replace(escapeRegex, '\\$&')).join('|'), 'g');
  workspace.textDocuments.forEach(document => openDocument(document));

  workspace.onDidChangeConfiguration(configChangeEvent => {
    configuration = readConfiguration();
  }, null, context.subscriptions);

  window.onDidChangeVisibleTextEditors(() => {
    for (const editor of window.visibleTextEditors)
      openDocument(editor.document);
  });

  workspace.onDidChangeTextDocument(changeEvent => {
    if (changeEvent.contentChanges.length > 0)
      openDocument(changeEvent.document);
  });

  workspace.onDidCloseTextDocument(document => {
    console.log('onDidCloseTextDocument:', document);
  });

  workspace.onDidOpenTextDocument(document => {
    openDocument(document);
  });

  function openDocument(document: TextDocument, attempt = 1): void {
    if (attempt > 5)
      return;

    const editor = getFirstEditor(document);

    if (!isValidDocument(document) || !editor)
      return;

    if (!scopeInfoApi.getScopeAt(document, new Position(0, 0))) {
      setTimeout(() => openDocument(document, ++attempt), 250);
      return;
    }

    lookForLigatures(document, editor, 0, document.lineCount - 1);
  }

  function lookForLigatures(document: TextDocument, editor: TextEditor, first: number, last: number): void {
    const ranges: Range[] = [];
    const started = processMillis();

    for (let i = first; i <= last; ++i) {
      const line = document.lineAt(i).text;
      let match: RegExpExecArray;

      while ((match = matchLigatures.exec(line))) {
        const index = match.index;
        const ligature = match[0];
        const scope = scopeInfoApi.getScopeAt(document, new Position(i, index));
        // console.log('match: %s, token: %s, line: %s, pos: %s, ', ligature, scope.text, i, index, scope.category); // , scope.scopes.join(', '));

        if (scope.category !== 'operator') {
          for (let j = 0; j < ligature.length; ++j)
            ranges.push(new Range(i, index + j, i, index + j + 1));
        }
      }

      if (processMillis() > started + 100) {
        setTimeout(() => lookForLigatures(document, editor, i + 1, last), 100);
        break;
      }
    }

    editor.setDecorations(decoration, ranges);
  }
}

function readConfiguration(): any {
  return workspace.getConfiguration().get('ligaturesLimited') as any;
}

function isValidDocument(document: TextDocument): boolean {
  return (document !== undefined && document.lineCount > 0 &&
    document.uri.scheme !== 'vscode' && document.uri.scheme !== 'output' && document.languageId === 'typescript' /* &&
        this.settings.excludedLanguages.has(document.languageId) */);
}

function getFirstEditor(document: TextDocument): TextEditor {
  for (const editor of window.visibleTextEditors) {
    if (editor.document === document)
      return editor;
  }

  return undefined;
}

export function deactivate(): void {
  scopeInfoDeactivate();
}
