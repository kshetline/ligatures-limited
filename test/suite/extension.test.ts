import chai, { expect } from 'chai';
import spies from 'chai-spies';
import { before, it, suite } from 'mocha';
import path from 'path';
import { commands, Extension, extensions, Range, TextEditor, TextEditorDecorationType, Uri, window } from 'vscode';
import { breakNormal, allLigatures, ligatureDecorations } from '../../src/extension';

chai.use(spies);

type DecorationMap = Map<string, Range[]>;

function findEditor(name: string): TextEditor {
  const editors = Array.from(window.visibleTextEditors);

  for (const editor of editors) {
    const fileName = editor.document.fileName.replace(/^.*[/\\]/, '');

    if (fileName === name)
      return editor;
  }

  return undefined;
}

function isCorrectlyDecorated(map: DecorationMap, line: number, column: number, width: number, decoration: TextEditorDecorationType): boolean {
  const checkRange = new Range(line - 1, column - 1, line - 1, column + width - 1);

  if (!decoration) {
    const keys = Array.from(map.keys());

    for (const key of keys) {
      const ranges = map.get(key);

      for (const range of ranges) {
        if (range.contains(checkRange))
          return false;
      }
    }

    return true;
  }

  const ranges = map.get(decoration.key);

  if (!ranges)
    return false;

  for (const range of ranges) {
    if (range.intersection(checkRange))
      --width;
  }

  return width === 0;
}

async function getDecorations(fileName: string): Promise<DecorationMap> {
  const docFile = Uri.file(path.join(__dirname, `../../../test/suite/sample-project/${fileName}`));
  await commands.executeCommand('vscode.open', docFile);
  const editor = findEditor('sample.html');
  const decorations = new Map<string, Range[]>();
  let gotDecorations: (map: DecorationMap) => void;

  expect(editor).to.be.ok;

  chai.spy.on(editor, 'setDecorations', (...params: any) => {
    const decoration: TextEditorDecorationType = params[0];
    const ranges: Range[] = params[1];

    expect(decoration).to.be.ok;

    if (ligatureDecorations.includes(decoration)) {
      if (decoration === breakNormal)
        decorations.clear();

      decorations.set(decoration.key, ranges);

      if (decoration === allLigatures)
        gotDecorations(decorations);
    }
  });

  return new Promise <Map<string, Range[]>>(resolve => gotDecorations = resolve);
}

suite('Extension Tests', () => {
  let extension: Extension<any>;
  window.showInformationMessage('Start all tests.');

  before(() => {
    extension = extensions.getExtension('kshetline.ligatures-limited');
  });

  it('should load and activate extension', () => {
    expect(extension).to.be.ok;
    expect(extension.isActive).to.be.ok;
  });

  it('should find ligatures in HTML document', async function () {
    this.slow(1000);
    this.timeout(2000);
    const decorations = await getDecorations('sample.html');
    expect(decorations).to.be.ok;

    expect(isCorrectlyDecorated(decorations, 7, 5, 2, null), 'foo').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 7, 8, 3, breakNormal), 'bar').to.be.ok;
  });
});
