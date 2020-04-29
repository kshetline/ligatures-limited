import {
  Disposable, Position, Range, TextDocument, TextDocumentChangeEvent, TextDocumentContentChangeEvent,
  TextLine, workspace
} from 'vscode';
import * as textUtil from './text-util';
import { IGrammar, IToken, StackElement } from 'vscode-textmate';
import { last } from 'ks-util';

export interface Token {
  range: Range;
  text: string;
  scopes: string[];
  category: string;
}

export interface ScopeInfoAPI {
  getScopeAt(document: TextDocument, position: Position): Token;
  getGrammar(scopeName: string): Promise<IGrammar>;
  getScopeForLanguage(language: string): string;
}

export class DocumentController implements Disposable {
  private subscriptions: Disposable[] = [];

  // Stores the state for each line
  private grammarState: StackElement[] = [];
  private grammar: IGrammar;

  public constructor(doc: TextDocument, textMateGrammar: IGrammar,
    private document = doc,
  ) {
    this.grammar = textMateGrammar;

    // Parse whole document
    const docRange = new Range(0, 0, this.document.lineCount, 0);
    this.reparsePretties(docRange);

    this.subscriptions.push(workspace.onDidChangeTextDocument(e => {
      if (e.document === this.document)
        this.onChangeDocument(e);
    }));
  }

  public dispose(): void {
    this.subscriptions.forEach(s => s.dispose());
  }

  private refreshTokensOnLine(line: TextLine): { tokens: IToken[], invalidated: boolean } {
    if (!this.grammar)
      return { tokens: [], invalidated: false };

    const prevState = this.grammarState[line.lineNumber - 1] || null;
    const lineTokens = this.grammar.tokenizeLine(line.text, prevState);
    const invalidated = !this.grammarState[line.lineNumber] || !lineTokens.ruleStack.equals(this.grammarState[line.lineNumber]);
    this.grammarState[line.lineNumber] = lineTokens.ruleStack;

    return { tokens: lineTokens.tokens, invalidated: invalidated };
  }

  public getScopeAt(position: Position): Token | null {
    if (!this.grammar)
      return null;

    position = this.document.validatePosition(position);
    const state = this.grammarState[position.line - 1] || null;
    const line = this.document.lineAt(position.line);
    const tokens = this.grammar.tokenizeLine(line.text, state);

    for (const t of tokens.tokens) {
      if (t.startIndex <= position.character && position.character < t.endIndex)
        return {
          range: new Range(position.line, t.startIndex, position.line, t.endIndex),
          text: line.text.substring(t.startIndex, t.endIndex),
          scopes: t.scopes,
          category: this.scopesToCategory(t.scopes)
        };
    }

    return null;
  }

  private scopesToCategory(scopes: string[]): string {
    if (scopes.length > 0) {
      let scope = last(scopes);

      if (/\b(invalid|illegal)\b/.test(scope) && scopes.length > 1)
        scope = scopes[scopes.length - 2];

      if (/\boperator|accessor|arrow\b/.test(scope))
        return 'operator';
      else if (/^string\.regexp\b/.test(scope))
        return 'regexp';
      else if (/^string\b/.test(scope))
        return 'string';
      else if (/^punctuation\.definition\.comment\b/.test(scope))
        return 'comment_marker';
      else if (/\bcomment\b/.test(scope))
        return 'comment';
      else if (/^(variable\.language|storage)\b/.test(scope))
        return 'keyword';
      else if (/^(support\.)?variable\b/.test(scope))
        return 'variable';
      else if (/^constant\.numeric\b/.test(scope))
        return 'number';
      else if (/^constant\.language\b/.test(scope))
        return 'keyword';
      else if (/^constant\b/.test(scope))
        return 'constant';
      else if (/\bfunction\b/.test(scope))
        return 'function';
      else if (/\bproperty-name\b/.test(scope))
        return 'property_name';
      else if (/^support\.type\b/.test(scope))
        return 'type';
      else if (/\bname\.tag\b/.test(scope))
        return 'tag';
      else if (/\battribute-name\b/.test(scope))
        return 'attribute_name';
      else if (/\btext\b/.test(scope))
        return 'text';
      else if (/^(keyword|storage\.type)\b/.test(scope))
        return 'keyword';
      else if (/(^punctuation)|(\bbrace)\b/.test(scope))
        return 'punctuation';
      else if (/\bmarkdown$/.test(scope)) // For now, consider all Markdown that isn't punctuation to be text.
        return 'text';
    }

    return 'other';
  }

  private reparsePretties(range: Range): void {
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

  private applyChanges(changes: readonly TextDocumentContentChangeEvent[]): void {
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

  private onChangeDocument(event: TextDocumentChangeEvent): void {
    this.applyChanges(event.contentChanges);
  }

  public refresh(): void {
    this.grammarState = [];
    const docRange = new Range(0, 0, this.document.lineCount, 0);
    this.reparsePretties(docRange);
  }
}
