// Вкладка схемы: одна на окно, рядом с просмотрщиком, сама не открывается. Файл читает плагин и следит за ним, сам в него не пишет (F-25, F-26, F-103).
import * as path from "node:path";
import * as vscode from "vscode";
import { pageHtml } from "./page";
import { readScheme, schemeFile } from "./project";
import type { JournalStore } from "./store";
import { asleepTab } from "./tabs";
import type { SchemeHostMessage, SchemePageMessage } from "../shared/protocol";

export const SCHEME_TYPE = "symphysis.scheme";
/** Какое изменение показать, когда VS Code вернёт вкладку после перезагрузки. Не стирается: читается, только если вкладка осталась. */
const SHOWN_KEY = "symphysis.shownScheme";

export interface SchemeDeps {
  context: vscode.ExtensionContext;
  store: JournalStore;
  showNode(key: string, id: string): void;
  currentKey(): string | null;
}

export class SchemePanel {
  private panel: vscode.WebviewPanel | null = null;
  private ready = false;
  private key: string | null = null;

  constructor(private readonly deps: SchemeDeps) {}

  /** Кнопка «схема» и команды: вторая вкладка не появляется, открытая получает фокус. `null` — изменения нет: вкладка пуста, пока журнал не откроют. */
  open(key: string | null): void {
    if (key) this.remember(key);
    if (this.panel) {
      this.panel.reveal(undefined, false);
      this.send();
    } else {
      // Новая встаёт в группу спящей и только потом закрывает её: последняя вкладка группы унесла бы и группу.
      const asleep = asleepTab(SCHEME_TYPE);
      this.create(asleep?.group.viewColumn ?? vscode.ViewColumn.Beside);
      if (asleep) void vscode.window.tabGroups.close(asleep);
    }
  }

  /** VS Code вернул вкладку после перезагрузки окна (F-125). Журнал мог смениться, пока она спала: вкладка следует за ним (F-64). */
  restore(panel: vscode.WebviewPanel): void {
    const key = this.deps.currentKey() ?? this.deps.context.workspaceState.get<string>(SHOWN_KEY);
    if (this.panel || !key || !this.deps.store.get(key)) {
      panel.dispose();
      return;
    }
    panel.webview.options = this.contentOptions();
    this.remember(key);
    this.attach(panel);
    this.send();
  }

  /** В просмотрщике открыт другой журнал: открытая вкладка показывает его схему, закрытая так и остаётся закрытой. */
  follow(key: string): void {
    if (!this.panel || key === this.key) return;
    this.remember(key);
    this.send();
  }

  /** `scheme.md` изменился на диске. */
  fileChanged(dir: string): void {
    if (this.panel && dir === this.key) this.send();
  }

  /** Для тестов: сообщения страницы. */
  readonly messages = new vscode.EventEmitter<SchemePageMessage>();
  /** Для тестов: страница как есть. */
  get webview(): vscode.Webview | null {
    return this.panel?.webview ?? null;
  }

  private remember(key: string): void {
    this.key = key;
    void this.deps.context.workspaceState.update(SHOWN_KEY, key);
  }

  private contentOptions(): vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.deps.context.extensionUri, "media")] };
  }

  private create(column: vscode.ViewColumn): void {
    this.attach(vscode.window.createWebviewPanel(SCHEME_TYPE, "Схема", { viewColumn: column, preserveFocus: false }, {
      ...this.contentOptions(),
      enableFindWidget: true,
      retainContextWhenHidden: true,
    }));
  }

  private attach(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    this.ready = false;
    panel.iconPath = vscode.Uri.joinPath(this.deps.context.extensionUri, "media", "icon.svg");
    panel.webview.html = pageHtml(panel.webview, this.deps.context, "scheme.js", { before: ["mermaid.min.js"], inlineStyles: true });
    panel.webview.onDidReceiveMessage((m: SchemePageMessage) => {
      this.messages.fire(m);
      void this.onMessage(m);
    });
    panel.onDidDispose(() => {
      this.panel = null;
      this.ready = false;
      this.key = null;
    });
  }

  private send(): void {
    if (!this.panel || !this.key) return;
    const name = path.basename(this.key);
    this.panel.title = `Схема: ${name}`;
    if (!this.ready) return;
    const m: SchemeHostMessage = { type: "scheme", view: { name, ...readScheme(this.key) } };
    void this.panel.webview.postMessage(m);
  }

  private async onMessage(m: SchemePageMessage): Promise<void> {
    switch (m.type) {
      case "schemeReady":
        this.ready = true;
        this.send();
        return;
      case "schemeNode":
        if (this.key) this.deps.showNode(this.key, m.id);
        return;
      case "schemeOpenFile": {
        if (!this.key) return;
        const at = m.line ? new vscode.Position(m.line - 1, 0) : null;
        await vscode.window.showTextDocument(vscode.Uri.file(schemeFile(this.key)), { viewColumn: vscode.ViewColumn.Active, preview: false, selection: at ? new vscode.Range(at, at) : undefined });
        return;
      }
    }
  }
}
