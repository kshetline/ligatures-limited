import * as assert from 'assert';
import { before } from 'mocha';
import vscode, { Extension } from 'vscode';
// import * as myExtension from '../../src/extension';

suite('Extension Tests', () => {
  let extension: Extension<any>;

  vscode.window.showInformationMessage('Start all tests.');

  before(() => {
    extension = vscode.extensions.getExtension('kshetline.ligatures-limited');
  });

  test('extension loads', () => {
    assert.ok(extension);
  });
});
