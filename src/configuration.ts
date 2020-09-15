import { setCompactScope } from './scope-info/scope-info';
import { workspace } from 'vscode';
import { showErrorMessage } from './extension-util';

export type SelectionMode = 'cursor' | 'line' | 'off' | 'selection';
export const DEFAULT_MAX_LINES = 20_000;
export const DEFAULT_MAX_FILE_SIZE = 35_000_000;

// The \ escape before the second [ is considered unnecessary here by ESLint,
// but being left out is an error for some regex parsers.
// eslint-disable-next-line no-useless-escape
const charsNeedingRegexEscape = /[-\[\]/{}()*+?.\\^$|]/g;

interface LLConfiguration {
  compactScopeDisplay?: boolean;
  contexts?: string | string[];
  debug?: boolean;
  disregardedLigatures: string | string[];
  inherit?: string;
  languages: Record<string, LLConfiguration | boolean>;
  ligatures?: string | string[];
  ligaturesByContext: Record<string, string | string[] | {
    debug: boolean,
    ligatures: string | string[]
  }>;
  maxFileSize: number,
  maxLines: number;
  selectionMode?: SelectionMode;
}

export interface ContextConfig {
  debug: boolean;
  ligatures: Set<string>;
  ligaturesMatch: RegExp;
  ligaturesListedAreEnabled: boolean;
}

export interface InternalConfig {
  compactScopeDisplay: boolean;
  contexts: Set<string>;
  deactivated: boolean;
  debug: boolean;
  ligatures: Set<string>;
  ligaturesMatch: RegExp;
  ligaturesByContext: Record<string, ContextConfig>;
  ligaturesListedAreEnabled: boolean;
  maxFileSize: number,
  maxLines: number,
  selectionMode: SelectionMode;
}

const FALLBACK_CONFIG: InternalConfig = {
  compactScopeDisplay: false,
  contexts: new Set<string>(),
  deactivated: false,
  debug: false,
  ligatures: new Set<string>(),
  ligaturesMatch: /\x00/,
  ligaturesByContext: {},
  ligaturesListedAreEnabled: false,
  maxFileSize: DEFAULT_MAX_FILE_SIZE,
  maxLines: DEFAULT_MAX_LINES,
  selectionMode: 'cursor'
};

const baseLigatures = String.raw`

  .= ..= .- := =:= == != === !== =/= <-< <<- <-- <- <-> -> --> ->> >-> <=< <<= <== <=> => ==> =!= =:=
  =>> >=> >>= >>- >- <~> -< -<< =<< <~~ <~ ~~ ~> ~~> <<< << <= <> >= >> >>> {. {| [| <: :> |] |} .}
  <||| <|| <| <|> |> ||> |||> <$ <$> $> <+ <+> +> <* <*> *> \\ \\\ \* /* */ /// // </ <!-- </> --> />
  ;; :: ::: .. ... ..< !! ?? %% && <:< || ?. ?: ++ +++ -- --- ** *** ~= ~- www ff fi fl ffi ffl
  -~ ~@ ^= ?= /= /== |= ||= #! ## ### #### #{ #[ ]# #( #? #_ #: #= #_( #{} =~ !~ 9x9 0xF 0o7 0b1
  |- |-- -| --| |== =| ==| /==/ ==/ /=/ <~~> =>= =<= :>: :<: /\ \/ _|_ ||- :< >: ::=
  <==== ==== ====> <====> <--- ---- ---> <---> |--- ---| |=== ===| /=== ===/ <~~~ ~~~> <~~~>

`.trim().split(/\s+/);

/* eslint-disable quote-props */
const patternSubstitutions: any = {
  '####': '#{4,}',
  '<====': '<={4,}',
  '====': '={4,}',
  '====>': '={4,}>',
  '<====>': '<={4,}>',
  '<---': '<-{3,}',
  '----': '-{4,}',
  '--->': '-{3,}>',
  '<--->': '<-{3,}>',
  '|---': '\\|-{3,}',
  '---|': '-{3,}\\|',
  '|===': '\\|={3,}',
  '===|': '={3,}\\|',
  '/===': '\\/={3,}',
  '===/': '={3,}\\/',
  '<~~~': '<~{3,}',
  '~~~>': '~{3,}>',
  '<~~~>': '<~{3,}>',
  '0xF': '0x[0-9a-fA-F]',
  '0o7': '0o[0-7]',
  '0b1': '(?<![0-9a-fA-FxX])0b[01]',
  '9x9': '\\dx\\d'
};
/* eslint-enable quote-props */

let disregarded: string[] = [];
const defaultDisregarded = ['ff', 'fi', 'fl', 'ffi', 'ffl'];
const baseDisabledLigatures = new Set<string>(['ff', 'fi', 'fl', 'ffi', 'ffl', 'www', '0xF', '0o7', '0b1', '9x9']);
const baseLanguages = {
  markdown: true
};
const baseLigatureContexts = new Set<string>(['operator', 'comment_marker', 'punctuation', 'number']);
const baseLigaturesByContext = {
  number: {
    debug: false,
    ligatures: new Set(baseDisabledLigatures),
    ligaturesMatch: null as RegExp,
    ligaturesListedAreEnabled: false
  }
};

baseLigaturesByContext.number.ligatures.delete('0xF');
baseLigaturesByContext.number.ligatures.delete('0o7');
baseLigaturesByContext.number.ligatures.delete('0b1');
baseLigaturesByContext.number.ligaturesMatch = ligaturesToRegex(baseLigaturesByContext.number.ligatures);

let defaultConfiguration: InternalConfig;
const configurationsByLanguage = new Map<string, InternalConfig>();
let globalLigatures: Set<string>;
let globalMatchLigatures: RegExp;

export function resetConfiguration(): void {
  defaultConfiguration = undefined;
  configurationsByLanguage.clear();
}

export function getLigatureMatcher(): RegExp {
  // Reset before returning.
  globalMatchLigatures.lastIndex = 0;

  return globalMatchLigatures;
}

export function readConfiguration(): InternalConfig;
export function readConfiguration(language: string): InternalConfig | boolean;

export function readConfiguration(language?: string): InternalConfig | boolean {
  try {
    const config = readConfigurationAux(language);

    if (typeof config === 'object' && config.ligatures && !(config.ligaturesMatch instanceof RegExp))
      config.ligaturesMatch = ligaturesToRegex(config.ligatures);

    return config;
  }
  catch (e) {
    console.error(e);
    showErrorMessage(`Ligatures Limited configuration error: ${e.message}`);
    return language ? true : FALLBACK_CONFIG;
  }
}

function readConfigurationAux(language?: string, loopCheck = new Set<string>()): InternalConfig | boolean {
  if (language && !defaultConfiguration)
    defaultConfiguration = readConfigurationAux(null, loopCheck) as InternalConfig;
  else if (!language && defaultConfiguration)
    return defaultConfiguration;

  let userConfig: LLConfiguration | boolean;
  let template: InternalConfig | boolean;
  let deactivated = false;

  if (language) {
    if (configurationsByLanguage.has(language))
      return configurationsByLanguage.get(language);

    if (loopCheck.has(language))
      throw new Error('Unresolved language inheritance for: ' + Array.from(loopCheck).join(', '));

    // Getting language-specific settings for your own extension is a bit of a hack, sorry to say!
    const languages = workspace.getConfiguration().get('ligaturesLimited.languages');
    const languageMap = new Map<string, string>();
    const vsLanguageConfig = workspace.getConfiguration(null, null).get(`[${language}]`);

    deactivated = !((vsLanguageConfig ?? {})['editor.fontLigatures'] ??
      workspace.getConfiguration().get('editor.fontLigatures'));

    if (languages) {
      Object.keys(languages).forEach(key =>
        // eslint-disable-next-line no-useless-escape
        toStringArray(key.replace(/[\[\]]/g, ''), true).forEach(subKey => languageMap.set(subKey, key)));
    }

    let languageConfig = languages && languages[languageMap.get(language) ?? ''];
    let prefix = '';

    if (languageConfig == null && vsLanguageConfig) {
      languageConfig = vsLanguageConfig;
      prefix = 'ligaturesLimited.';
    }

    if (typeof languageConfig === 'boolean')
      userConfig = languageConfig;
    else if (languageConfig) {
      const config = languageConfig.ligaturesLimited ?? baseLanguages[language] ?? {};

      if (typeof config === 'boolean')
        userConfig = config;
      else {
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
    }
    else
      userConfig = baseLanguages[language];

    if (userConfig && typeof userConfig !== 'boolean') {
      template = defaultConfiguration;

      if (userConfig.inherit) {
        loopCheck.add(language);
        template = readConfigurationAux(userConfig.inherit, loopCheck);

        if (typeof template === 'object')
          template.ligaturesMatch = null;
      }
    }
  }
  else {
    disregarded = toStringArray(workspace.getConfiguration().get('ligaturesLimited.disregardedLigatures'));
    defaultDisregarded.filter(lig => !disregarded.includes(lig)).forEach(lig => disregarded.push(lig));
    globalLigatures = new Set(baseLigatures);
    disregarded.forEach(l => globalLigatures.delete(l));
  }

  if (userConfig == null) {
    userConfig = workspace.getConfiguration().get('ligaturesLimited');

    if (typeof userConfig === 'boolean')
      throw new Error('true/false values are not valid for the root ligaturesLimited configuration.');
    else if (userConfig?.inherit && !language)
      throw new Error('"inherit" is not a valid property for the root ligaturesLimited configuration.');
  }

  if (typeof userConfig === 'boolean')
    return userConfig;
  else if (typeof template === 'boolean')
    return template;

  if (!template) {
    template = {
      compactScopeDisplay: false,
      contexts: baseLigatureContexts,
      deactivated,
      debug: false,
      ligatures: new Set(baseDisabledLigatures),
      ligaturesMatch: null as RegExp,
      ligaturesByContext: baseLigaturesByContext,
      ligaturesListedAreEnabled: false,
      maxFileSize: DEFAULT_MAX_FILE_SIZE,
      maxLines: DEFAULT_MAX_LINES,
      selectionMode: 'cursor' as SelectionMode
    };
  }

  const internalConfig = {
    compactScopeDisplay: !!(userConfig?.compactScopeDisplay ?? template.compactScopeDisplay),
    contexts: new Set(template.contexts),
    deactivated,
    debug: userConfig?.debug ?? template.debug,
    ligatures: new Set(template.ligatures),
    ligaturesMatch: template.ligaturesMatch,
    ligaturesByContext: clone(template.ligaturesByContext),
    ligaturesListedAreEnabled: template.ligaturesListedAreEnabled,
    maxFileSize: userConfig?.maxFileSize ?? template.maxFileSize,
    maxLines: userConfig?.maxLines ?? template.maxLines,
    selectionMode: (userConfig?.selectionMode?.toLowerCase() ?? template.selectionMode) as SelectionMode
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
      ligaturesMatch: internalConfig.ligaturesMatch,
      ligaturesListedAreEnabled: internalConfig.ligaturesListedAreEnabled,
    };

    contextConfig.ligaturesListedAreEnabled = applyLigatureList(contextConfig.ligatures, config,
      contextConfig.ligaturesListedAreEnabled);

    contexts.forEach(context => {
      internalConfig.ligaturesByContext[context] = contextConfig;
      internalConfig.contexts.add(context);
    });
  }

  globalMatchLigatures = ligaturesToRegex(globalLigatures);

  if (!language)
    defaultConfiguration = internalConfig;
  else
    configurationsByLanguage.set(language, internalConfig);

  return internalConfig;
}

export function ligaturesToRegex(ligatures: string[] | Set<string>): RegExp {
  if (!Array.isArray(ligatures))
    ligatures = Array.from(ligatures);

  ligatures.sort((a, b) => b.length - a.length); // Sort from longest to shortest

  return new RegExp(ligatures.map(lig => patternSubstitutions[lig] ??
    generatePattern(lig, ligatures as string[])).join('|'), 'g');
}

// The major purpose of this function is escaping ligature characters so that they
// can be used in a regex, but for some ligatures it's also important to make sure
// certain characters don't precede or follow a ligature to establish a valid match.
function generatePattern(ligature: string, allLigatures: string[]): string {
  const leadingSet = new Set<string>();
  const trailingSet = new Set<string>();
  const len = ligature.length;

  // Give triangles (◁, ▷) and diamonds (♢) formed using < and > higher priority.
  if (/^[>|]/.test(ligature))
    leadingSet.add('<');

  if (/[|<]$/.test(ligature))
    trailingSet.add('>');

  for (const other of allLigatures) {
    if (other.length <= len)
      break;

    let index = 0;

    while ((index = other.indexOf(ligature, index)) >= 0) {
      if (index > 0)
        leadingSet.add(other.charAt(index - 1));

      if (index + len < other.length)
        trailingSet.add(other.charAt(index + len));

      ++index;
    }
  }

  // Handle ligatures which are supposed to blend with combinatory arrow ligatures
  const connectionTweaks = {
    '-': /^[-<>|]+$/,
    '=': /^[=<>|]+$/,
    '~': /^[~<>|]+$/
  };

  Object.keys(connectionTweaks).forEach(key => {
    if (ligature.startsWith(key) && connectionTweaks[key].test(ligature))
      leadingSet.delete(key);

    if (ligature.endsWith(key) && connectionTweaks[key].test(ligature))
      trailingSet.delete(key);
  });

  const leading = createLeadingOrTrailingClass(leadingSet);
  const trailing = createLeadingOrTrailingClass(trailingSet);
  let pattern = '';

  if (leading) // Create negative lookbehind, so this ligature isn't matched if preceded by these characters.
    pattern += `(?<!${leading})`;

  pattern += escapeForRegex(ligature);

  if (trailing) // Create negative lookahead, so this ligature isn't matched if followed by these characters.
    pattern += `(?!${trailing})`;

  return pattern;
}

function createLeadingOrTrailingClass(set: Set<string>): string {
  if (set.size === 0)
    return '';
  else if (set.size === 1)
    return escapeForRegex(set.values().next().value);

  let klass = '[';

  // If present, dash (`-`) must go first, in case it's the start of a [] class pattern
  if (set.has('-')) {
    klass += '-';
    set.delete('-');
  }

  Array.from(set.values()).forEach(c => klass += escapeForRegex(c));

  return klass + ']';
}

function escapeForRegex(s: string): string {
  return s.replace(charsNeedingRegexEscape, '\\$&');
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
  let enable = true;

  toStringArray(specs, true).forEach(spec => {
    if (spec.length === 1) {
      if (spec === '+')
        enable = true;
      else if (spec === '-')
        enable = false;
      else if (spec === '0' || spec.toUpperCase() === 'O') {
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
