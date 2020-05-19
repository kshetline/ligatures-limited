import assert from 'assert';
import { after, before, it } from 'mocha';
import path from 'path';
import { commands, Extension, extensions, Uri, window } from 'vscode';
// import * as myExtension from '../../src/extension';

suite('Extension Tests', () => {
  let extension: Extension<any>;
  const projectFolder = Uri.file(path.join(__dirname, '../../../test/suite/sample-project'));

  window.showInformationMessage('Start all tests.');

  before(() => {
    extension = extensions.getExtension('kshetline.ligatures-limited');
    const cmd = commands.executeCommand('vscode.openFolder', projectFolder).then(
      () => console.log('opened'),
      () => console.log('didn\'t open'));
    console.log('before');
    return cmd;
  });

  after(() => {
    console.log('after');
  });

  it('should load and activate extension', () => {
    assert.ok(extension);
    assert.ok(extension.isActive);
  });

  it('second test', () => {
    assert.ok(true);
  });
});
