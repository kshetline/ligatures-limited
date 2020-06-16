// The code below, and elsewhere in this same scope-info directory, heavily
// borrows from https://github.com/siegebell/scope-info, by C. J. Bell.
//
// This extension also replicates and augments the hover information provided
// by the original scope-info.

import { DocumentController, ScopeInfoAPI, Token } from './document';
import { registerCommand, showInfoMessage } from '../extension-util';
import fs from 'fs';
import * as oniguruma from 'vscode-oniguruma-wasm';
import { join } from 'path';
import {
  Disposable, ExtensionContext, Extension, extensions, Hover, languages, Position, Range, TextDocument, TextDocumentChangeEvent, Uri, workspace
} from 'vscode';
import { IGrammar, IRawGrammar, parseRawGrammar, Registry, RegistryOptions } from 'vscode-textmate';

const documents = new Map<Uri, DocumentController>();
const cachedGrammars = new Map<string, IGrammar | Promise<IGrammar>>();
const baseOnigPath = 'node_modules/vscode-oniguruma-wasm/release/onig.wasm';
let onigPath = join(__dirname, '../../..', baseOnigPath);

if (!fs.existsSync(onigPath))
  onigPath = join(__dirname, '..', baseOnigPath);

const wasm = fs.readFileSync(onigPath).buffer;

oniguruma.loadWASM(wasm);

export let textMateRegistry: Registry;

interface ExtensionGrammar {
  language?: string;
  scopeName?: string;
  path?: string;
  embeddedLanguages?: { [scopeName: string]: string };
  injectTo?: string[];
}

interface ExtensionPackage {
  contributes?: {
    languages?: {
      id: string;
      configuration: string
    }[];
    grammars?: ExtensionGrammar[];
  };
}

let compactScope = true;
const languageIds = new Map<string, string>();

function getLanguages(): ExtensionGrammar[] {
  try {
    return extensions.all
      .filter(x => x.packageJSON && x.packageJSON.contributes && x.packageJSON.contributes.grammars)
      .reduce((a: ExtensionGrammar[], b) => [...a, ...(b.packageJSON as ExtensionPackage).contributes.grammars], []);
  }
  catch {}

  return [];
}

export function onChangeDocument(event: TextDocumentChangeEvent): void {
  documents.forEach(key => { if (key.document === event.document) key.onChangeDocument(event); });
}

export function getLanguageIdFromScope(scope: string): string {
  const id = (/^.+\.(.+)$/.exec(scope) ?? [])[1];

  if (!id)
    return undefined;

  if (languageIds.has(id))
    return languageIds.get(id);

  const suffix = '.' + id;
  const extLanguages = getLanguages();

  for (const language of extLanguages) {
    if (language.language && language.scopeName?.endsWith(suffix)) {
      languageIds[id] = language.language;

      return language.language;
    }
  }

  return undefined;
}

function getLanguageScopeName(languageId: string): string {
  const extLanguages = getLanguages();
  const matchingLanguages = extLanguages.filter(g => g.language === languageId);

  if (matchingLanguages.length > 0)
    return matchingLanguages[0].scopeName;

  return undefined;
}

interface GrammarAndExtensionPath {
  grammar: ExtensionGrammar;
  path: string;
}

function groupGrammarsAndPath(grammars: ExtensionGrammar[], extension: Extension<any>): GrammarAndExtensionPath[] {
  if (!grammars)
    return [];

  return grammars.map(grammar => ({ grammar, path: extension.extensionPath }));
}

async function getLanguageGrammar(scopeName: string): Promise<IRawGrammar> {
  try {
    const extLanguages =
      extensions.all
        .filter(x => x.packageJSON && x.packageJSON.contributes && x.packageJSON.contributes.grammars)
        .reduce((a: GrammarAndExtensionPath[], b) =>
          [...a, ...groupGrammarsAndPath((b.packageJSON as ExtensionPackage).contributes.grammars, b)], []);
    const matchingLanguages = extLanguages.filter(g => g.grammar.scopeName === scopeName);

    if (matchingLanguages.length > 0) {
      const path = join(matchingLanguages[0].path, matchingLanguages[0].grammar.path);
      const content = fs.readFileSync(path).toString();

      return parseRawGrammar(content, path);
    }
  }
  catch (err) { }

  return undefined;
}

const grammarLocator: RegistryOptions = {
  getInjections: null,
  loadGrammar: scopeName => getLanguageGrammar(scopeName),
  onigLib: Promise.resolve({
    createOnigScanner: sources => new oniguruma.OnigScanner(sources),
    createOnigString: str => new oniguruma.OnigString(str)
  })
};

async function provideHoverInfo(subscriptions: Disposable[]): Promise<void> {
  const allLanguages =
    (await languages.getLanguages())
      .filter(x => getLanguageScopeName(x) !== undefined);

  allLanguages.push('plaintext');

  subscriptions.push(languages.registerHoverProvider(allLanguages, {
    provideHover: (doc: { uri: Uri; }, pos: Position): Hover => {
      if (!isHoverEnabled())
        return;

      const token = getScopeAt(doc as TextDocument, pos);

      if (token) {
        const text = token.text.substr(0, 64).replace(/\r\n|\r|\n/g, '↵ ') + (token.text.length > 64 ? '...' : '');
        let scopeLines = token.scopes;

        if (compactScope)
          scopeLines = [scopeLines.join(', ')];

        return {
          contents: [`Token: \`${text}\``, `Category: \`${token.category}\``, ...scopeLines],
          range: token.range
        };
      }
    }
  }));
}

function getScopeAt(document: TextDocument, position: Position): Token {
  if (document.languageId === 'plaintext') {
    return {
      category: 'text',
      range: new Range(0, 0, document.lineCount, document.lineAt(Math.max(document.lineCount - 1, 0))?.text?.length ?? 0),
      scopes: [],
      text: document.getText(new Range(0, 0, Math.min(document.lineCount, 10), 0))
    };
  }

  try {
    const prettyDoc = documents.get(document.uri);

    if (prettyDoc?.hasEditor())
      return prettyDoc.getScopeAt(position);
  }
  catch (err) { }

  return null;
}

export function activate(context: ExtensionContext): ScopeInfoAPI {
  registerCommand(context, 'ligaturesLimited.toggleScopeHover', toggleScopeHover);
  context.subscriptions.push(workspace.onDidOpenTextDocument(openDocument));
  context.subscriptions.push(workspace.onDidCloseTextDocument(closeDocument));
  provideHoverInfo(context.subscriptions);
  reloadGrammar();

  return {
    getScopeAt,
    getScopeForLanguage(language: string): string {
      return getLanguageScopeName(language) || null;
    },
    async getGrammar(scopeName: string): Promise<IGrammar> {
      try {
        if (textMateRegistry)
          return await loadGrammar(scopeName);
      }
      catch (err) { }

      return null;
    }
  };
}

let hoverEnabled = false;

export function isHoverEnabled(): boolean {
  return hoverEnabled;
}

export function setHover(enabled: boolean): void {
  hoverEnabled = enabled;
}

export function setCompactScope(enabled: boolean): void {
  compactScope = enabled;
}

/** Re-read the settings and recreate substitutions for all documents */
export function reloadGrammar(): void {
  try {
    textMateRegistry = new Registry(grammarLocator);
    cachedGrammars.clear();
  }
  catch (err) {
    textMateRegistry = undefined;
    console.error(err);
  }

  // Recreate the documents
  unloadDocuments();

  for (const doc of workspace.textDocuments)
    openDocument(doc);
}

function toggleScopeHover(): void {
  hoverEnabled = !hoverEnabled;
  showInfoMessage('Scope info on hover: ' + (hoverEnabled ? 'on' : 'off'));
}

function loadGrammar(scopeName: string): Promise<IGrammar> {
  if (cachedGrammars.has(scopeName)) {
    const grammar = cachedGrammars.get(scopeName);

    if (grammar instanceof Promise)
      return grammar;
    else
      return Promise.resolve(grammar);
  }

  const newGrammar = textMateRegistry.loadGrammar(scopeName);

  cachedGrammars.set(scopeName, newGrammar);

  return newGrammar;
}

async function openDocument(doc: TextDocument): Promise<void> {
  try {
    const prettyDoc = documents.get(doc.uri);

    if (prettyDoc?.hasEditor())
      prettyDoc.refresh();
    else if (textMateRegistry) {
      const scopeName = getLanguageScopeName(doc.languageId);

      if (scopeName) {
        const grammar = await loadGrammar(scopeName);

        documents.set(doc.uri, new DocumentController(doc, grammar));
      }
    }
  }
  catch (err) {
    console.error(err);
  }
}

function closeDocument(doc: TextDocument): void {
  const prettyDoc = documents.get(doc.uri);

  if (prettyDoc)
    documents.delete(doc.uri);
}

function unloadDocuments(): void {
  documents.clear();
}

export function deactivate(): void {
  unloadDocuments();
}
