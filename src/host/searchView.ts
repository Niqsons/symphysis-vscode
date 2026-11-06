// Поиск в боковой панели: вид со страницей, потому что поля ввода у TreeView нет. Ищет в журнале, открытом во вкладке; запрос живёт здесь — вид можно закрыть и открыть.
import * as vscode from "vscode";
import { emptyDraft } from "../shared/logic";
import type { Colors, RevealTarget, SearchHostMessage, SearchOutcome, SearchPageMessage } from "../shared/protocol";
import { search } from "../shared/search";
import type { Draft } from "../shared/types";
import { pageHtml } from "./page";
import type { JournalStore } from "./store";

export interface SearchDeps {
  context: vscode.ExtensionContext;
  store: JournalStore;
  colors(): Colors;
  reveal(target: RevealTarget): void;
}

export class SearchView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private query = "";
  private key: string | null = null;
  private draft: Draft = emptyDraft();

  /** Для тестов: сообщения страницы. */
  readonly messages = new vscode.EventEmitter<unknown>();
  /** Для тестов: страница как есть. */
  get webview(): vscode.Webview | null {
    return this.view?.webview ?? null;
  }

  constructor(private readonly deps: SearchDeps) {}

  show(key: string | null): void {
    this.key = key;
    this.draft = emptyDraft();
    this.publish();
  }

  setDraft(key: string, draft: Draft): void {
    if (key !== this.key) return;
    this.draft = draft;
    if (this.query.trim()) this.publish();
  }

  refresh(): void {
    this.publish();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.deps.context.extensionUri, "media")] };
    view.webview.html = pageHtml(view.webview, this.deps.context, "search.js");
    view.webview.onDidReceiveMessage((m: SearchPageMessage) => {
      this.messages.fire(m);
      this.onMessage(m);
    });
    view.onDidDispose(() => {
      this.view = null;
    });
  }

  private onMessage(m: SearchPageMessage): void {
    switch (m.type) {
      case "searchReady":
        this.publish();
        return;
      case "searchQuery":
        this.query = m.query;
        this.publish();
        return;
      case "searchOpen":
        this.deps.reveal(m.target);
        return;
    }
  }

  private publish(): void {
    if (!this.view) return;
    const state = this.key ? this.deps.store.get(this.key) : undefined;
    const outcome: SearchOutcome = state?.payload ? search(state.payload, this.draft, this.query) : { kind: "empty" };
    const message: SearchHostMessage = { type: "searchState", query: this.query, scope: state?.ref.name ?? null, outcome, colors: this.deps.colors() };
    void this.view.webview.postMessage(message);
  }
}
