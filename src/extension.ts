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
  inherit?: string;
  languages: Record<string, LLConfiguration>;
  ligatures?: string | string[];
  ligaturesByContext: Record<string, string | string[] | {
    debug: boolean,
    ligatures: string | string[]
  }>;
  selectionMode?: SelectionMode;
}

interface InternalConfig {
  compactScopeDisplay: boolean;
  contexts: Set<string>;
  debug: boolean;
  ligatures: Set<string>;
  ligaturesListedAreEnabled: boolean;
  selectionMode: SelectionMode;

  ligaturesByContext: Record<string, {
    debug: boolean;
    ligatures: Set<string>;
    ligaturesListedAreEnabled: boolean;
  }>;
}

const baseLigatures = String.raw`.= .- := =:= == != === !== =/= <-< <<- <-- <- <-> -> --> ->> >-> <=< <<= <== <=> => ==>
  '=>> >=> >>= >>- >- <~> -< -<< =<< <~~ <~ ~~ ~> ~~> <<< << <= <> >= >> >>> {. {| [| <: :> |] |} .}
  '<||| <|| <| <|> |> ||> |||> <$ <$> $> <+ <+> +> <* <*> *> \\ \\\ \* /* */ /// // <// <!-- </> --> />
  ';; :: ::: .. ... ..< !! ?? %% && || ?. ?: ++ +++ -- --- ** *** ~= ~- www ff fi fl ffi ffl
  '-~ ~@ ^= ?= /= /== |= ||= #! ## ### #### #{ #[ ]# #( #? #_ #_('`.split(/\s+/);
const baseDisabledLigatures = new Set<string>(['ff', 'fi', 'fl', 'ffi', 'ffl']);
const baseLigatureContexts = new Set<string>(['operator', 'comment_marker', 'punctuation']);

let defaultConfiguration: InternalConfig;
const configurationsByLanguage = new Map<string, InternalConfig>();
let globalLigatures: Set<string>;
let globalMatchLigatures: RegExp;

const escapeRegex = /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g;
const breakNormal = window.createTextEditorDecorationType({ color: '' });
const breakDebug = window.createTextEditorDecorationType({ color: 'red', backgroundColor: 'white' });
const highlightLigature = window.createTextEditorDecorationType({ color: 'green', backgroundColor: 'white' });

export function activate(context: ExtensionContext): void {
  const scopeInfoApi = scopeInfoActivate(context);

  workspace.onDidChangeConfiguration(() => {
    defaultConfiguration = undefined;
    configurationsByLanguage.clear();
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
        if (ligature.length > scope.text.length && ligature !== '?:') {
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

function readConfiguration(language?: string, loopCheck = new Set<string>()): InternalConfig {
  if (language && !defaultConfiguration)
    defaultConfiguration = readConfiguration(null, loopCheck);
  else if (!language && defaultConfiguration)
    return defaultConfiguration;

  let userConfig: LLConfiguration;
  let template: InternalConfig;

  if (language) {
    if (configurationsByLanguage.has(language))
      return configurationsByLanguage.get(language);

    if (loopCheck.has(language))
      throw new Error('Unresolved language inheritance for: ' + Array.from(loopCheck).join(', '));

    // Getting language-specific settings for your own extension is a bit of a hack, sorry to say!
    const languages = workspace.getConfiguration().get('ligaturesLimited.languages');
    let languageConfig = languages && (languages[language] || languages[`[${language}]`]);
    let prefix = '';

    if (!languageConfig) {
      languageConfig = workspace.getConfiguration().get(`[${language}]`);
      prefix = 'ligaturesLimited.';
    }

    if (languageConfig) {
      const config = languageConfig['ligaturesLimited'] || {};

      config.compactScopeDisplay = languageConfig[`${prefix}compactScopeDisplay`] ?? config.compactScopeDisplay;
      config.contexts = languageConfig[`${prefix}contexts`] ?? config.contexts;
      config.debug = languageConfig[`${prefix}debug`] ?? config.debug;
      config.inherit = languageConfig[`${prefix}inherit`] ?? config.inherit;
      config.ligatures = languageConfig[`${prefix}ligatures`] ?? config.ligatures;
      config.ligaturesByContext = languageConfig[`${prefix}ligaturesByContext`] ?? config.ligaturesByContext;
      config.selectionMode = languageConfig[`${prefix}selectionMode`] ?? config.selectionMode;

      Object.keys(config).forEach(key => {
        const value = config[key];

        if (value) {
          if (!userConfig)
            userConfig = {} as any;

          userConfig[key] = value;
        }
      });
    }

    if (userConfig) {
      template = defaultConfiguration;

      if (userConfig.inherit) {
        loopCheck.add(language);
        template = readConfiguration(userConfig.inherit, loopCheck);
      }
    }
  }
  else
    globalLigatures = new Set(baseLigatures);

  if (!userConfig) {
    userConfig = workspace.getConfiguration().get('ligaturesLimited');

    if (userConfig?.inherit && !language)
      throw new Error('"inherit" is not a valid property for the root ligaturesLimited configuration.');
  }

  if (!template) {
    template = {
      compactScopeDisplay: false,
      contexts: baseLigatureContexts,
      debug: false,
      ligatures: new Set(baseDisabledLigatures),
      ligaturesListedAreEnabled: false,
      selectionMode: 'cursor' as SelectionMode,
      ligaturesByContext: {}
    };
  }

  const internalConfig = {
    compactScopeDisplay: !!(userConfig?.compactScopeDisplay ?? template.compactScopeDisplay),
    contexts: new Set(template.contexts),
    debug: userConfig?.debug ?? template.debug,
    ligatures: new Set(template.ligatures),
    ligaturesListedAreEnabled: template.ligaturesListedAreEnabled,
    selectionMode: (userConfig?.selectionMode?.toLowerCase() ?? template.selectionMode) as SelectionMode,
    ligaturesByContext: clone(template.ligaturesByContext)
  };

  if (!/^(cursor|line|off|selection)$/.test(internalConfig.selectionMode))
    throw new Error('Invalid selectionMode');

  setCompactScope(internalConfig.compactScopeDisplay);

  applyContextList(internalConfig.contexts, userConfig?.contexts);
  internalConfig.ligaturesListedAreEnabled = applyLigatureList(internalConfig.ligatures, userConfig?.ligatures,
    internalConfig.ligaturesListedAreEnabled);

  const contextKeys = Object.keys(userConfig?.ligaturesByContext ?? {});

  for (const key of contextKeys) {
    let config = userConfig.ligaturesByContext[key];
    const contexts = toStringArray(key, true);
    let debug = internalConfig.debug;

    if (typeof config === 'object' && !Array.isArray(config)) {
      debug = config.debug ?? debug;
      config = config.ligatures;
    }

    if (contexts.length < 1)
      continue;

    const contextConfig = {
      debug,
      ligatures: new Set(internalConfig.ligatures),
      ligaturesListedAreEnabled: internalConfig.ligaturesListedAreEnabled,
    };

    contextConfig.ligaturesListedAreEnabled = applyLigatureList(contextConfig.ligatures, config,
      contextConfig.ligaturesListedAreEnabled);

    contexts.forEach(context => {
      internalConfig.ligaturesByContext[context] = contextConfig;
      internalConfig.contexts.add(context);
    });
  }

  const allLigatures = Array.from(globalLigatures);

  allLigatures.sort((a, b) => b.length - a.length); // Sort from longest to shortest
  globalMatchLigatures = new RegExp(allLigatures.map(lg => lg.replace(escapeRegex, '\\$&')).join('|'), 'g');

  if (!language)
    defaultConfiguration = internalConfig;
  else
    configurationsByLanguage.set(language, internalConfig);

  return internalConfig;
}

function toStringArray(s: string | string[], allowComma = false): string[] {
  if (Array.isArray(s))
    return s;
  else if (s)
    return s.trim().split(allowComma ? /\s*?[,\s]\s*/ : /\s+/);
  else
    return [];
}

function applyLigatureList(ligatureList: Set<string>, specs: string | string[], listedAreEnabled = false): boolean {
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
        ligatureList.clear();
        addToList = listedAreEnabled = true;
        removeFromList = false;
      }
      else if (spec === 'X') {
        ligatureList.clear();
        addToList = true;
        removeFromList = listedAreEnabled = false;
      }
      else
        throw new Error('Invalid ligature specification');
    }
    else if (spec.length > 1) {
      globalLigatures.add(spec);

      if (addToList)
        ligatureList.add(spec);
      else if (removeFromList)
        ligatureList.delete(spec);
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
