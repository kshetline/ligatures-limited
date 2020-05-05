import { commands, ExtensionContext, window } from 'vscode';

const TOAST_TIMEOUT = 3000; // Three seconds

export function registerCommand(context: ExtensionContext, commandId: string, run: (...args: any[]) => void): void {
  context.subscriptions.push(commands.registerCommand(commandId, run));
}

export function toast(message: string): void {
  window.setStatusBarMessage(message, TOAST_TIMEOUT);
}

export function showInfoMessage(message: string): void {
  window.showInformationMessage(message);
}
