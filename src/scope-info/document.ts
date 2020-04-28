import * as vscode from 'vscode';
import * as textUtil from './text-util';
import { IGrammar, IToken, StackElement } from 'vscode-textmate';

export interface Token {
  range: vscode.Range;
  text: string;
  scopes: string[];
}

export interface ScopeInfoAPI {
  getScopeAt(document: vscode.TextDocument, position: vscode.Position): Token | null;
  getGrammar(scopeName: string): Promise<IGrammar | null>;
  getScopeForLanguage(language: string): string | null;
}

const debugging = false;
const activeEditorDecorationTimeout = 20;
const inactiveEditorDecorationTimeout = 200;

export class DocumentController implements vscode.Disposable {
  private subscriptions: vscode.Disposable[] = [];

  // Stores the state for each line
  private grammarState: StackElement[] = [];
  private grammar: IGrammar;

  public constructor(doc: vscode.TextDocument, textMateGrammar: IGrammar,
    private document = doc,
  ) {
    this.grammar = textMateGrammar;

    // Parse whole document
    const docRange = new vscode.Range(0, 0, this.document.lineCount, 0);
    this.reparsePretties(docRange);

    this.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document === this.document)
        this.onChangeDocument(e);
    }));
  }

  public dispose(): void {
    this.subscriptions.forEach(s => s.dispose());
  }


  private refreshTokensOnLine(line: vscode.TextLine): { tokens: IToken[], invalidated: boolean } {
    if (!this.grammar)
      return { tokens: [], invalidated: false };
    const prevState = this.grammarState[line.lineNumber - 1] || null;
    const lineTokens = this.grammar.tokenizeLine(line.text, prevState);
    const invalidated = !this.grammarState[line.lineNumber] || !lineTokens.ruleStack.equals(this.grammarState[line.lineNumber]);
    this.grammarState[line.lineNumber] = lineTokens.ruleStack;
    return { tokens: lineTokens.tokens, invalidated: invalidated };
  }

  public getScopeAt(position: vscode.Position): Token | null {
    if (!this.grammar)
      return null;
    position = this.document.validatePosition(position);
    const state = this.grammarState[position.line - 1] || null;
    const line = this.document.lineAt(position.line);
    const tokens = this.grammar.tokenizeLine(line.text, state);
    for (const t of tokens.tokens) {
      if (t.startIndex <= position.character && position.character < t.endIndex)
        return { range: new vscode.Range(position.line, t.startIndex, position.line, t.endIndex), text: line.text.substring(t.startIndex, t.endIndex), scopes: t.scopes };
    }
    return null;
  }

  private reparsePretties(range: vscode.Range): void {
    range = this.document.validateRange(range);

    const startCharacter = 0;

    let invalidatedTokenState = false;

    // Collect new pretties
    const lineCount = this.document.lineCount;
    let lineIdx;
    for (lineIdx = range.start.line; lineIdx <= range.end.line || (invalidatedTokenState && lineIdx < lineCount); ++lineIdx) {
      const line = this.document.lineAt(lineIdx);
      const { tokens: tokens, invalidated: invalidated } = this.refreshTokensOnLine(line);
      invalidatedTokenState = invalidated;
    }
  }

  private applyChanges(changes: readonly vscode.TextDocumentContentChangeEvent[]): void {
    const sortedChanges =
      changes.slice(0).sort((change1, change2) => change1.range.start.isAfter(change2.range.start) ? -1 : 1);
    for (const change of sortedChanges) {
      try {
        const delta = textUtil.toRangeDelta(change.range, change.text);
        const editRange = textUtil.rangeDeltaNewRange(delta);

        const reparsed = this.reparsePretties(editRange);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private onChangeDocument(event: vscode.TextDocumentChangeEvent): void {
    this.applyChanges(event.contentChanges);
  }

  public refresh(): void {
    this.grammarState = [];
    const docRange = new vscode.Range(0, 0, this.document.lineCount, 0);
    this.reparsePretties(docRange);
  }
}
