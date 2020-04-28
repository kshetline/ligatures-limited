import { activate as scopeInfoActivate, deactivate as scopeInfoDeactivate } from './scope-info/scope-info';
import { ExtensionContext, TextDocument, TextEditor, window, workspace, Position } from 'vscode';

export function activate(context: ExtensionContext): void {
  const scopeInfoApi = scopeInfoActivate(context);
  const decoration = window.createTextEditorDecorationType({ color: '' });
  let configuration = readConfiguration();

  workspace.onDidChangeConfiguration(configChangeEvent => {
    configuration = readConfiguration();
  }, null, context.subscriptions);

  window.onDidChangeVisibleTextEditors(() => {
    for (const editor of window.visibleTextEditors)
      openDocument(editor.document);
  });

  workspace.onDidChangeTextDocument(changeEvent => {
    if (changeEvent.contentChanges.length > 0) {
      console.log(changeEvent);
    }
  });

  workspace.onDidCloseTextDocument(document => {
    console.log(document);
  });

  workspace.onDidOpenTextDocument(document => {
    openDocument(document);
  });

  function openDocument(document: TextDocument): void {
    if (isValidDocument(document) && getFirstEditor(document)) {
      console.log(document, scopeInfoApi.getScopeAt(document, new Position(0, 0)));
    }
  }

  // function disableLigatures(event: TextEditorSelectionChangeEvent) {
  //   const editor = event.textEditor;

  //   const positions = selectionsToMap(event.selections);
  //   const ranges: Range[] = [];

  //   for (const [lineNumber, charPositions] of positions) {
  //     const text = editor.document.lineAt(lineNumber).text;

  //     for (const position of charPositions) {
  //       let match: RegExpExecArray | null;
  //       // tslint:disable-next-line:no-conditional-assignment
  //       while ((match = configuration.regex.exec(text)) !== null) {
  //         if (configuration.mode === "Line") {
  //           ranges.push(...matchLine(lineNumber, match));
  //         }
  //         else if (configuration.mode === "Cursor") {
  //           ranges.push(...matchCursor(lineNumber, position, match));
  //         }
  //         else {
  //           throw new Error("Invalid Mode");
  //         }
  //       }
  //     }
  //   }

  //   editor.setDecorations(decoration, ranges);
  // }

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

    console.log('not found');
    return undefined;
  }
}

export function deactivate(): void {
  scopeInfoDeactivate();
}
