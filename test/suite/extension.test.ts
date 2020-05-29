import chai, { expect } from 'chai';
import spies from 'chai-spies';
import { before, it, suite } from 'mocha';
import path from 'path';
import { commands, Extension, extensions, Range, TextEditor, TextEditorDecorationType, Uri, window } from 'vscode';
import { breakNormal, breakDebug, highlightLigature, allLigatures, ligatureDecorations } from '../../src/extension';

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
    const intersection = range.intersection(checkRange);

    if (intersection)
      width -= intersection.end.character - intersection.start.character;
  }

  return width === 0;
}

async function getDecorations(fileName: string): Promise<DecorationMap> {
  const docFile = Uri.file(path.join(__dirname, `../../../test/suite/sample-project/${fileName}`));
  await commands.executeCommand('vscode.open', docFile);
  const editor = findEditor(fileName);
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

    expect(isCorrectlyDecorated(decorations, 7, 5, 2, null), 'css /*').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 7, 8, 3, breakNormal), 'css ===').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 7, 12, 3, null), 'css www').to.be.ok;

    expect(isCorrectlyDecorated(decorations, 13, 8, 3, breakNormal), 'js www in lc').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 13, 12, 2, breakNormal), 'js == in lc').to.be.ok;

    expect(isCorrectlyDecorated(decorations, 14, 8, 3, null), 'js www in bc').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 14, 12, 2, breakNormal), 'js => in bc').to.be.ok;

    expect(isCorrectlyDecorated(decorations, 15, 17, 3, null), 'js ===').to.be.ok;

    expect(isCorrectlyDecorated(decorations, 16, 18, 2, null), 'js =>').to.be.ok;

    expect(isCorrectlyDecorated(decorations, 21, 32, 3, null), 'html www in link').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 21, 54, 3, breakNormal), 'html www in text').to.be.ok;
  });

  it('should find no suppressed ligatures in sample Markdown', async function () {
    this.slow(1000);
    this.timeout(2000);
    const decorations = await getDecorations('sample.md');
    expect(decorations).to.be.ok;
    expect(Array.from(decorations.values()).reduce((count, range) => count + range.length, 0)).to.equal(0);
  });

  it('should find debug ligatures in TypeScript document', async function () {
    this.slow(1500);
    this.timeout(2500);
    await commands.executeCommand('ligaturesLimited.cycleLigatureDebug');
    await new Promise<void>(resolve => setTimeout(() => resolve(), 500));
    const decorations = await getDecorations('sample.ts');
    expect(decorations).to.be.ok;

    expect(isCorrectlyDecorated(decorations, 1, 4, 3, breakDebug), 'ts www in lc').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 1, 8, 3, breakDebug), 'ts !== in lc').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 1, 12, 2, breakDebug), 'ts <= in lc').to.be.ok;

    expect(isCorrectlyDecorated(decorations, 2, 4, 3, highlightLigature), 'ts www in bc').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 2, 8, 3, breakDebug), 'ts !== in bc').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 2, 12, 2, breakDebug), 'ts >= in lc').to.be.ok;

    expect(isCorrectlyDecorated(decorations, 9, 9, 2, highlightLigature), 'ts <=').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 9, 19, 2, highlightLigature), 'ts >=').to.be.ok;
    expect(isCorrectlyDecorated(decorations, 9, 29, 2, breakDebug), 'ts !=').to.be.ok;

    expect(isCorrectlyDecorated(decorations, 10, 19, 2, highlightLigature), 'ts =>').to.be.ok;
  });
});
