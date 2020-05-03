import { last as _last, processMillis } from 'ks-util';
import {
  activate as scopeInfoActivate, deactivate as scopeInfoDeactivate, reloadGrammar,
  setCompactScope
} from './scope-info/scope-info';
import { ExtensionContext, Position, Range, TextDocument, TextEditor, window, workspace, Selection } from 'vscode';

type SelectionMode = 'cursor' | 'line' | 'off' | 'selection';

interface LLConfiguration {
  compactScopeDisplay?: boolean;
  contexts?: string | string[];
  debug?: boolean;
  ligatures?: string | string[];
  selectionMode?: SelectionMode;

  byLanguage?: Record<string, {
    contexts?: string | string[];
    debug?: boolean;
    inherit?: string;
    ligatures?: string | string[];

    byContext?: Record<string, {
      ligatures?: string | string[];
    }>;
  }>;
}

type InternalConfig = Record<string, {
  debug: boolean;
  contexts: Set<string>;
  ligatures: Set<string>;
  ligaturesListedAreEnabled: boolean;

  byContext: Record<string, {
    ligatures: Set<string>;
    ligaturesListedAreEnabled: boolean;
  }>;
}>;

const baseLigatures = String.raw`.= .- := =:= == != === !== =/= <-< <<- <-- <- <-> -> --> ->> >-> <=< <<= <== <=> => ==>
  '=>> >=> >>= >>- >- <~> -< -<< =<< <~~ <~ ~~ ~> ~~> <<< << <= <> >= >> >>> {. {| [| <: :> |] |} .}
  '<||| <|| <| <|> |> ||> |||> <$ <$> $> <+ <+> +> <* <*> *> \\ \\\ \* /* */ /// // <// <!-- </> --> />
  ';; :: ::: .. ... ..< !! ?? %% && || ?. ?: ++ +++ -- --- ** *** ~= ~- www ff fi fl ffi ffl
  '-~ ~@ ^= ?= /= /== |= ||= #! ## ### #### #{ #[ ]# #( #? #_ #_('`.split(/\s+/);
const baseDisabledLigatures = new Set<string>(['ff', 'fi', 'fl', 'ffi', 'ffl']);
const baseLigatureContexts = new Set<string>(['operator', 'comment_marker', 'punctuation']);

let configuration: LLConfiguration;
let internalConfig: InternalConfig = {};
let globalDebug = false;
let globalLigatureContexts: Set<string>;
let globalLigatures: Set<string>;
let globalListedLigatures: Set<string>;
let globalListedAreEnabled = false;
let globalMatchLigatures: RegExp;
let selectionMode: SelectionMode = 'off';

const escapeRegex = /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g;
const breakNormal = window.createTextEditorDecorationType({ color: '' });
const breakDebug = window.createTextEditorDecorationType({ color: 'red', backgroundColor: 'white' });
const highlightLigature = window.createTextEditorDecorationType({ color: 'green', backgroundColor: 'white' });

export function activate(context: ExtensionContext): void {
  const scopeInfoApi = scopeInfoActivate(context);

  workspace.onDidChangeConfiguration(() => {
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
    breaks: Range[] = [], highlights: Range[] = []): void {
    if (!workspace.textDocuments.includes(document) || !window.visibleTextEditors.includes(editor))
      return;

    const started = processMillis();
    const langConfig = internalConfig[document.languageId];
    const langLigatures = langConfig?.ligatures ?? globalListedLigatures;
    const contexts = langConfig?.contexts ?? globalLigatureContexts;
    const langListedAreEnabled = langConfig?.ligaturesListedAreEnabled ?? globalListedAreEnabled;
    const debug = langConfig?.debug ?? globalDebug;

    for (let i = first; i <= last; ++i) {
      const line = document.lineAt(i).text;
      let match: RegExpExecArray;

      while ((match = globalMatchLigatures.exec(line))) {
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
          globalMatchLigatures.lastIndex -= ligature.length - scope.text.length;
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

        const contextConfig = (langConfig?.byContext && (langConfig.byContext[specificScope] ?? langConfig.byContext[category]));
        const contextLigatures = contextConfig?.ligatures ?? langLigatures;
        const listedAreEnabled = contextConfig?.ligaturesListedAreEnabled ?? langListedAreEnabled;

        if (shortened || selected || contextLigatures.has(ligature) !== listedAreEnabled ||
          (!contexts.has(category) && !globalLigatureContexts.has(specificScope))) {
          for (let j = 0; j < ligature.length; ++j)
            breaks.push(new Range(i, index + j, i, index + j + 1));
        }
        else if (debug)
          highlights.push(new Range(i, index, i, index + ligature.length));
      }

      if (processMillis() > started + 50_000_000) {
        setTimeout(() => lookForLigatures(document, editor, i + 1, last, breaks, highlights), 50);
        return;
      }
    }

    if (debug) {
      editor.setDecorations(breakNormal, []);
      editor.setDecorations(breakDebug, breaks);
      editor.setDecorations(highlightLigature, highlights);
    }
    else {
      editor.setDecorations(breakDebug, []);
      editor.setDecorations(breakNormal, breaks);
      editor.setDecorations(highlightLigature, []);
    }
  }
}

function readConfiguration(): void {
  configuration = workspace.getConfiguration().get('ligaturesLimited') as LLConfiguration;
  internalConfig = {};
  globalLigatures = new Set(baseLigatures);
  globalListedLigatures = new Set(baseDisabledLigatures);
  globalLigatureContexts = new Set(baseLigatureContexts);
  globalDebug = !!configuration?.debug;
  setCompactScope(!!configuration?.compactScopeDisplay);
  selectionMode = (configuration?.selectionMode?.toString().toLowerCase() || 'off') as SelectionMode;

  if (!/^(cursor|line|off|selection)$/.test(selectionMode))
    throw new Error('Invalid selectionMode');

  applyContextList(globalLigatureContexts, configuration?.contexts);
  globalListedAreEnabled = applyLigatureList(globalListedLigatures, configuration?.ligatures, false);

  const unresolvedInheritance = new Set<string>();
  let lastResolvedCount = Number.MAX_SAFE_INTEGER;
  const languageKeys = Object.keys(configuration?.byLanguage ?? {});

  while (true) {
    for (const key of languageKeys) {
      const lConfig = configuration?.byLanguage[key];
      const languages = toStringArray(key).map(l => l.replace(/[[\]]/g, '').trim());

      if (languages.length < 1 || internalConfig[languages[0]])
        continue;

      let langConfig = {
        debug: !!(lConfig.debug ?? globalDebug),
        contexts: new Set(globalLigatureContexts),
        ligatures: new Set(globalListedLigatures),
        ligaturesListedAreEnabled: globalListedAreEnabled,
        byContext: {}
      };

      if (lConfig.inherit) {
        langConfig = internalConfig[lConfig.inherit];

        if (!langConfig) {
          languages.forEach(l => unresolvedInheritance.add(l));
          continue;
        }
        else
          langConfig = clone(langConfig);
      }

      applyContextList(new Set(globalLigatureContexts), lConfig?.contexts);
      langConfig.ligaturesListedAreEnabled = applyLigatureList(langConfig.ligatures, lConfig?.ligatures, langConfig.ligaturesListedAreEnabled);

      const contextKeys = Object.keys(lConfig.byContext ?? {});

      for (const cKey of contextKeys) {
        const cConfig = lConfig.byContext[cKey];
        const contexts = toStringArray(cKey);

        if (contexts.length < 1)
          continue;

        const contextConfig = {
          ligatures: new Set(langConfig.ligatures),
          ligaturesListedAreEnabled: langConfig.ligaturesListedAreEnabled,
        };

        contextConfig.ligaturesListedAreEnabled = applyLigatureList(contextConfig.ligatures, cConfig.ligatures, contextConfig.ligaturesListedAreEnabled);
        contexts.forEach(context => {
          langConfig.byContext[context] = contextConfig;
          langConfig.contexts.add(context);
        });
      }

      languages.forEach(language => internalConfig[language] = langConfig);
    }

    if (unresolvedInheritance.size === 0 || unresolvedInheritance.size >= lastResolvedCount)
      break;

    lastResolvedCount = unresolvedInheritance.size;
    unresolvedInheritance.clear();
  }

  if (unresolvedInheritance.size > 0)
    throw new Error('Unresolved language inheritance for: ' + Array.from(unresolvedInheritance).join(', '));

  const allLigatures = Array.from(globalLigatures);

  allLigatures.sort((a, b) => b.length - a.length); // Sort from longest to shortest
  globalMatchLigatures = new RegExp(allLigatures.map(lg => lg.replace(escapeRegex, '\\$&')).join('|'), 'g');
}

function toStringArray(s: string | string[], allowComma = false): string[] {
  if (Array.isArray(s))
    return s;
  else if (s)
    return s.trim().split(allowComma ? /\s*?[,\s]\s*/ : /\s+/);
  else
    return [];
}

function applyLigatureList(ligatureToDisable: Set<string>, specs: string | string[], listedAreEnabled = false): boolean {
  let addToList = false;
  let removeFromList = false;

  toStringArray(specs).forEach(spec => {
    if (spec.length === 1) {
      spec = spec.toUpperCase();

      if (spec === '+')
        addToList = !(removeFromList = !listedAreEnabled);
      else if (spec === '-')
        addToList = !(removeFromList = listedAreEnabled);
      else if (spec === '0' || spec === 'O') {
        ligatureToDisable.clear();
        addToList = listedAreEnabled = true;
        removeFromList = false;
      }
      else if (spec === 'X') {
        ligatureToDisable.clear();
        addToList = true;
        removeFromList = listedAreEnabled = false;
      }
      else
        throw new Error('Invalid ligature specification');
    }
    else if (spec.length > 1) {
      globalLigatures.add(spec);

      if (addToList)
        ligatureToDisable.add(spec);
      else if (removeFromList)
        ligatureToDisable.delete(spec);
    }
  });

  return listedAreEnabled;
}

function applyContextList(contextsToEnable: Set<string>, specs: string | string[]): void {
  let enable = false;

  toStringArray(specs, true).forEach(spec => {
    if (spec.length === 1) {
      if (spec === '+')
        enable = true;
      else if (spec === '-')
        enable = false;
      else if (spec === '0') {
        contextsToEnable.clear();
        enable = true;
      }
      else
        throw new Error('Invalid context specification');
    }
    else if (spec.length > 1) {
      if (enable)
        contextsToEnable.add(spec);
      else
        contextsToEnable.delete(spec);
    }
  });
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

// This is an ad hoc deep clone function for InternalConfig, not very generalizable beyond that.
function clone<T>(original: T): T {
  if (!original)
    return original;

  const theClone = Object.assign({}, original) as any;

  Object.keys(theClone).forEach(key => {
    if (theClone[key] instanceof Set)
      theClone[key] = new Set(theClone[key]);
    else if (typeof theClone[key] === 'object')
      theClone[key] = clone(theClone[key]);
  });

  return theClone;
}

export function deactivate(): void {
  scopeInfoDeactivate();
}
