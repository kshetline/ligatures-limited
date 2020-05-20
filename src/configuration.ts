import { setCompactScope } from './scope-info/scope-info';
import { workspace } from 'vscode';

export type SelectionMode = 'cursor' | 'line' | 'off' | 'selection';

interface LLConfiguration {
  compactScopeDisplay?: boolean;
  contexts?: string | string[];
  debug?: boolean;
  disregardedLigatures: string | string[];
  inherit?: string;
  languages: Record<string, LLConfiguration>;
  ligatures?: string | string[];
  ligaturesByContext: Record<string, string | string[] | {
    debug: boolean,
    ligatures: string | string[]
  }>;
  selectionMode?: SelectionMode;
}

export interface ContextConfig {
  debug: boolean;
  ligatures: Set<string>;
  ligaturesListedAreEnabled: boolean;
}

export interface InternalConfig {
  compactScopeDisplay: boolean;
  contexts: Set<string>;
  debug: boolean;
  ligatures: Set<string>;
  ligaturesListedAreEnabled: boolean;
  selectionMode: SelectionMode;
  ligaturesByContext: Record<string, ContextConfig>;
}

const baseLigatures = String.raw`

.= .- := =:= == != === !== =/= <-< <<- <-- <- <-> -> --> ->> >-> <=< <<= <== <=> => ==>
=>> >=> >>= >>- >- <~> -< -<< =<< <~~ <~ ~~ ~> ~~> <<< << <= <> >= >> >>> {. {| [| <: :> |] |} .}
<||| <|| <| <|> |> ||> |||> <$ <$> $> <+ <+> +> <* <*> *> \\ \\\ \* /* */ /// // <// <!-- </> --> />
;; :: ::: .. ... ..< !! ?? %% && || ?. ?: ++ +++ -- --- ** *** ~= ~- www ff fi fl ffi ffl 0xF 9x9
-~ ~@ ^= ?= /= /== |= ||= #! ## ### #### #{ #[ ]# #( #? #_ #_(

`.trim().split(/\s+/);

const baseDisabledLigatures = new Set<string>(['ff', 'fi', 'fl', 'ffi', 'ffl', '0xF', '9x9']);
const baseLigatureContexts = new Set<string>(['operator', 'comment_marker', 'punctuation', 'number']);
const baseLigaturesByContext = {
  number: {
    debug: false,
    ligatures: new Set(baseDisabledLigatures),
    ligaturesListedAreEnabled: false
  }
};

baseLigaturesByContext.number.ligatures.delete('0xF');

let defaultConfiguration: InternalConfig;
const configurationsByLanguage = new Map<string, InternalConfig>();
let globalLigatures: Set<string>;
let globalMatchLigatures: RegExp;

// The \ before the second [ is considered unnecessary here by ESLine, but being left out
// is an error for some regex parsers.
// eslint-disable-next-line no-useless-escape
const escapeRegex = /[-\[\]/{}()*+?.\\^$|]/g;

export function resetConfiguration(): void {
  defaultConfiguration = undefined;
  configurationsByLanguage.clear();
}

export function getLigatureMatcher(): RegExp {
  // Reset before returning.
  globalMatchLigatures.lastIndex = 0;

  return globalMatchLigatures;
}

export function readConfiguration(language?: string, loopCheck = new Set<string>()): InternalConfig {
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
    const languageMap = new Map<string, string>();

    if (languages) {
      Object.keys(languages).forEach(key =>
        // eslint-disable-next-line no-useless-escape
        toStringArray(key.replace(/[\[\]]/g, ''), true).forEach(subKey => languageMap.set(subKey, key)));
    }

    let languageConfig = languages && languages[languageMap.get(language) ?? ''];
    let prefix = '';

    if (!languageConfig) {
      languageConfig = workspace.getConfiguration().get(`[${language}]`);
      prefix = 'ligaturesLimited.';
    }

    if (languageConfig) {
      const config = languageConfig.ligaturesLimited || {};

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
  else {
    const disregarded = toStringArray(workspace.getConfiguration().get('ligaturesLimited.disregardedLigatures'));

    globalLigatures = new Set(baseLigatures);
    disregarded.forEach(l => globalLigatures.delete(l));
  }

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
      ligaturesByContext: baseLigaturesByContext
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
  globalMatchLigatures = new RegExp(allLigatures.map(lg =>
    lg.replace(escapeRegex, '\\$&').replace('0xF', '0x[0-9a-fA-F]').replace('9x9', '\\dx\\d')
  ).join('|'), 'g');

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
  let enable = true;

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
