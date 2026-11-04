// Вкладка просмотрщика: одна на окно, показывает выбранное изменение. «Внести» приходит только сообщением страницы —
// команды палитры и обработчика vscode:// к нему не ведут, иначе агент внесёт слово сам.
import * as vscode from "vscode";
import { applyFlow } from "./apply";
import type { CoreEnv } from "./core";
import { lineOf, resolveLink } from "./links";
import { pageHtml } from "./page";
import { deleteDraft, readDraft, readScheme, writeDraft } from "./project";
import type { ChangeState, JournalStore } from "./store";
import { asleepTab } from "./tabs";
import { DEFAULT_UI, type ApplyReport, type Colors, type CoreFailure, type HostMessage, type JournalView, type PageMessage, type UiState, type ViewMode } from "../shared/protocol";
import type { Draft } from "../shared/types";

export const VIEWER_TYPE = "symphysis.viewer";
const UI_KEY = "symphysis.ui";
/** Какое изменение показать, когда VS Code вернёт вкладку после перезагрузки. Не стирается: читается, только если вкладка осталась. */
const SHOWN_KEY = "symphysis.shownJournal";

export interface ViewerDeps {
  context: vscode.ExtensionContext;
  store: JournalStore;
  coreEnv(root: string): CoreEnv | CoreFailure;
  colors(): Colors;
  onShown(key: string | null): void;
  onDraft(key: string, draft: Draft): void;
  openScheme(key: string): void;
}

const isFailure = (v: CoreEnv | CoreFailure): v is CoreFailure => "kind" in v;

function toView(state: ChangeState): JournalView {
  return { key: state.ref.dir, name: state.ref.name, payload: state.payload, failure: state.failure, loading: state.loading, scheme: readScheme(state.ref.dir).text };
}

export class ViewerPanel {
  private panel: vscode.WebviewPanel | null = null;
  private ready = false;
  private key: string | null = null;
  private applying = false;
  private pendingNode: string | null = null;

  constructor(private readonly deps: ViewerDeps) {}

  get currentKey(): string | null {
    return this.key;
  }

  open(key: string, column: vscode.ViewColumn = vscode.ViewColumn.Active): void {
    this.key = key;
    void this.deps.context.workspaceState.update(SHOWN_KEY, key);
    // Боковая панель узнаёт о журнале раньше страницы: показ передаёт ей черновик, и он должен лечь к новому журналу, а не к прежнему.
    this.deps.onShown(key);
    if (this.panel) {
      this.panel.reveal(undefined, true);
      if (this.ready) this.show();
    } else {
      // Новая встаёт в группу спящей и только потом закрывает её: последняя вкладка группы унесла бы и группу.
      const asleep = asleepTab(VIEWER_TYPE);
      this.create(asleep?.group.viewColumn ?? column);
      if (asleep) void vscode.window.tabGroups.close(asleep);
    }
    this.deps.store.refresh(key);
  }

  /** VS Code вернул вкладку после перезагрузки окна (F-125). Показывать нечего или вкладка уже есть — закрывается. */
  restore(panel: vscode.WebviewPanel): void {
    const key = this.deps.context.workspaceState.get<string>(SHOWN_KEY);
    if (this.panel || !key || !this.deps.store.get(key)) {
      panel.dispose();
      return;
    }
    panel.webview.options = this.contentOptions();
    this.key = key;
    this.deps.onShown(key);
    this.attach(panel);
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

  /** Клик по узлу на вкладке схемы: просмотрщик закрыт или показывает другое — сначала открывается этот журнал (F-63). */
  showNode(key: string, id: string): void {
    if (this.panel && this.ready && key === this.key) {
      this.panel.reveal(undefined, true);
      void this.post({ type: "node", id });
    } else {
      this.pendingNode = id;
      // Рядом, а не поверх: активна вкладка схемы, и человек должен видеть и её, и карточки.
      this.open(key, vscode.ViewColumn.Beside);
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

  private contentOptions(): vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.deps.context.extensionUri, "media")] };
  }

  private create(column: vscode.ViewColumn): void {
    this.attach(vscode.window.createWebviewPanel(VIEWER_TYPE, "Журнал решений", { viewColumn: column, preserveFocus: false }, {
      ...this.contentOptions(),
      enableFindWidget: true,
      retainContextWhenHidden: true,
    }));
  }

  private attach(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    this.ready = false;
    panel.iconPath = vscode.Uri.joinPath(this.deps.context.extensionUri, "media", "icon.svg");
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
    if (this.pendingNode) {
      void this.post({ type: "node", id: this.pendingNode });
      this.pendingNode = null;
    }
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
      case "openScheme":
        this.deps.openScheme(m.key);
        return;
      case "openFile":
        await this.openFile(m.link, m.line);
        return;
      case "openPythonSetting":
        await vscode.commands.executeCommand("workbench.action.openSettings", "symphysis.python");
        return;
    }
  }

  /** Путь берётся из карты показанного вывода, из сообщения страницы он не приходит никогда (F-44, F-54). Рядом, предпросмотром, фокус остаётся в просмотрщике (F-45). */
  private async openFile(link: unknown, line: unknown): Promise<void> {
    const state = this.key ? this.deps.store.get(this.key) : undefined;
    const file = resolveLink(state?.payload?.file_links, link, state?.ref.root);
    if (!file) return;
    const at = lineOf(line);
    const selection = at ? new vscode.Range(at - 1, 0, at - 1, 0) : undefined;
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: true, selection });
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
    const env = this.deps.coreEnv(state.ref.root);
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
