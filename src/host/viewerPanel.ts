// Вкладка просмотрщика: одна на окно, показывает выбранное изменение. «Внести» приходит только сообщением страницы —
// команды палитры и обработчика vscode:// к нему не ведут, иначе агент внесёт слово сам.
import * as vscode from "vscode";
import { applyFlow } from "./apply";
import type { CoreEnv } from "./core";
import { pageHtml } from "./page";
import { deleteDraft, readDraft, writeDraft, type ChangeRef } from "./project";
import type { ChangeState, JournalStore } from "./store";
import { DEFAULT_UI, type ApplyReport, type Colors, type CoreFailure, type HostMessage, type JournalView, type PageMessage, type UiState, type ViewMode } from "../shared/protocol";
import type { Draft } from "../shared/types";

const UI_KEY = "symphysis.ui";

export interface ViewerDeps {
  context: vscode.ExtensionContext;
  store: JournalStore;
  coreEnv(ref: ChangeRef): CoreEnv | CoreFailure;
  colors(): Colors;
  onShown(key: string | null): void;
  onDraft(key: string, draft: Draft): void;
}

const isFailure = (v: CoreEnv | CoreFailure): v is CoreFailure => "kind" in v;

function toView(state: ChangeState): JournalView {
  return { key: state.ref.dir, name: state.ref.name, payload: state.payload, failure: state.failure, loading: state.loading };
}

export class ViewerPanel {
  private panel: vscode.WebviewPanel | null = null;
  private ready = false;
  private key: string | null = null;
  private applying = false;

  constructor(private readonly deps: ViewerDeps) {}

  get currentKey(): string | null {
    return this.key;
  }

  open(key: string): void {
    this.key = key;
    // Боковая панель узнаёт о журнале раньше страницы: показ передаёт ей черновик, и он должен лечь к новому журналу, а не к прежнему.
    this.deps.onShown(key);
    if (this.panel) {
      this.panel.reveal(undefined, true);
      if (this.ready) this.show();
    } else {
      this.create();
    }
    this.deps.store.refresh(key);
  }

  /** Журнал обновился: страница получает новые данные, черновик у неё остаётся. */
  journalUpdated(key: string): void {
    const state = this.deps.store.get(key);
    if (this.panel && this.ready && key === this.key && state) void this.post({ type: "journal", view: toView(state) });
  }

  colorsChanged(): void {
    if (this.panel && this.ready) void this.post({ type: "colors", colors: this.deps.colors() });
  }

  reveal(id: string, mode?: ViewMode): void {
    if (this.panel && this.ready) {
      this.panel.reveal(undefined, true);
      void this.post({ type: "reveal", id, mode });
    }
  }

  /** Для тестов: сообщения страницы. */
  readonly messages = new vscode.EventEmitter<PageMessage>();
  /** Для тестов: страница как есть. */
  get webview(): vscode.Webview | null {
    return this.panel?.webview ?? null;
  }
  /** Для тестов: Ctrl+F на странице работает только с этой опцией. */
  get findWidget(): boolean {
    return !!this.panel?.options.enableFindWidget;
  }

  private post(m: HostMessage): Thenable<boolean> {
    return this.panel!.webview.postMessage(m);
  }

  private create(): void {
    const root = this.deps.context.extensionUri;
    const panel = vscode.window.createWebviewPanel("symphysis.viewer", "Журнал решений", { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, {
      enableScripts: true,
      enableFindWidget: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(root, "media")],
    });
    this.panel = panel;
    this.ready = false;
    panel.iconPath = vscode.Uri.joinPath(root, "media", "icon.svg");
    panel.webview.html = pageHtml(panel.webview, this.deps.context, "viewer.js");
    panel.webview.onDidReceiveMessage((m: PageMessage) => {
      this.messages.fire(m);
      void this.onMessage(m);
    });
    panel.onDidDispose(() => {
      this.panel = null;
      this.ready = false;
      this.key = null;
      this.deps.onShown(null);
    });
  }

  private show(): void {
    const state = this.key ? this.deps.store.get(this.key) : undefined;
    if (!this.panel || !state) return;
    this.panel.title = `Журнал: ${state.ref.name}`;
    const { draft, damaged } = readDraft(state.ref.root, state.ref.name);
    this.deps.onDraft(state.ref.dir, draft);
    void this.post({ type: "show", view: toView(state), draft, damagedDraft: damaged, colors: this.deps.colors(), ui: this.ui() });
  }

  private ui(): UiState {
    return { ...DEFAULT_UI, ...this.deps.context.workspaceState.get<Partial<UiState>>(UI_KEY, {}) };
  }

  private async onMessage(m: PageMessage): Promise<void> {
    switch (m.type) {
      case "ready":
        this.ready = true;
        this.show();
        return;
      case "draft": {
        const state = this.deps.store.get(m.key);
        if (!state) return;
        writeDraft(state.ref.root, state.ref.name, m.draft);
        this.deps.onDraft(m.key, m.draft);
        return;
      }
      case "ui":
        await this.deps.context.workspaceState.update(UI_KEY, m.ui);
        return;
      case "copy":
        await vscode.env.clipboard.writeText(m.text);
        return;
      case "reset":
        await this.reset(m.key);
        return;
      case "apply":
        await this.apply(m);
        return;
      case "openPythonSetting":
        await vscode.commands.executeCommand("workbench.action.openSettings", "symphysis.python");
        return;
    }
  }

  private async reset(key: string): Promise<void> {
    const state = this.deps.store.get(key);
    if (!state) return;
    const answer = await vscode.window.showWarningMessage(`Убрать весь черновик журнала «${state.ref.name}»? В журнал он не внесён и пропадёт.`, { modal: true }, "Сбросить");
    if (answer !== "Сбросить") return;
    deleteDraft(state.ref.root, state.ref.name);
    this.show();
  }

  private async apply(m: Extract<PageMessage, { type: "apply" }>): Promise<void> {
    const report = (result: ApplyReport) => this.post({ type: "applied", key: m.key, result });
    if (this.applying) return;
    const state = this.deps.store.get(m.key);
    if (!state) return void report({ stage: "error", text: "изменение не найдено" });
    const env = this.deps.coreEnv(state.ref);
    if (isFailure(env)) return void report({ stage: "error", text: `ядро недоступно (${env.kind})` });
    this.applying = true;
    try {
      const result = await applyFlow({ env, ref: state.ref, text: m.text, shownSha: m.shownSha, date: m.date });
      await report(result);
    } catch (e) {
      await report({ stage: "error", text: String(e) });
    } finally {
      this.applying = false;
      this.deps.store.refresh(m.key);
    }
  }
}
