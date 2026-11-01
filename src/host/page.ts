// Разметка страницы расширения: одна строгая CSP на вкладку просмотрщика и вид в боковой панели. Водитель тестов — только в ExtensionMode.Test.
import * as crypto from "node:crypto";
import * as vscode from "vscode";

export function pageHtml(webview: vscode.Webview, context: vscode.ExtensionContext, script: string): string {
  const media = vscode.Uri.joinPath(context.extensionUri, "media");
  const uri = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(media, f));
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [`default-src 'none'`, `img-src ${webview.cspSource} data:`, `font-src ${webview.cspSource}`, `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`].join("; ");
  const scripts = [script];
  if (context.extensionMode === vscode.ExtensionMode.Test) scripts.unshift("test-driver.js");
  const tags = scripts.map((s) => `<script nonce="${nonce}" src="${uri(s)}"></script>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="${uri("viewer.css")}"></head><body><div id="root"></div>${tags}</body></html>`;
}
