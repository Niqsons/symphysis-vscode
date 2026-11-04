// Вкладка схемы и справки: одна на окно, рядом с просмотрщиком, сама не открывается, показывает одно из двух (F-17, F-40, F-107).
// Страниц две, у схемы mermaid, у справки React: переключатель заменяет страницу. `scheme.md` читает плагин и следит за ним, сам в него не пишет (F-25, F-26, F-103).
import * as path from "node:path";
import * as vscode from "vscode";
import { lineOf, resolveLink, resolveSkill } from "./links";
import { openBeside } from "./openFile";
import { pageHtml } from "./page";
import { changeDir, readScheme, schemeFile, type ChangeRef } from "./project";
import { chooseTarget, sameTarget, type HelpTarget } from "./stepHelp";
import { asleepTab } from "./tabs";
import type { HelpHostMessage, HelpOutcome, HelpPageMessage, PanelView, SchemeHostMessage, SchemePageMessage } from "../shared/protocol";

export const SCHEME_TYPE = "symphysis.scheme";
/** Последнее показанное изменение: его показывает вкладка при закрытом просмотрщике и после перезагрузки (F-41). Не стирается: изменение могло уйти, это проверяется при чтении. */
const SHOWN_KEY = "symphysis.shownScheme";
/** Выбор «схема | справка». Записи нет — выбора ещё не было (F-40). */
const PANEL_KEY = "symphysis.panelView";

export interface SchemeDeps {
  context: vscode.ExtensionContext;
  showNode(key: string, id: string): void;
  currentKey(): string | null;
  /** Изменения рабочей области, как они лежат на диске сейчас. */
  activeChanges(): ChangeRef[];
  workspaceRoots(): string[];
  requestHelp(target: HelpTarget): void;
  /** Вкладку показали снова (она лежала под другой): справка могла устареть, пока на неё не смотрели. */
  helpShown(): void;
  /** Настройка `symphysis.toolsPath`: от неё открываются скиллы из каталога установки (F-91). */
  toolsPath(): string | undefined;
}

const SCHEME_PAGE = "scheme.js";
const HELP_PAGE = "help.js";

export class SchemePanel {
  private panel: vscode.WebviewPanel | null = null;
  private ready = false;
  private key: string | null = null;
  private view: PanelView = "scheme";
  private page: string | null = null;
  private outcome: HelpOutcome | null = null;

  constructor(private readonly deps: SchemeDeps) {}

  /** Кнопка и команды: вторая вкладка не появляется, открытая получает фокус. `view` — положение, которое просит команда; кнопка его не просит: последний выбор. */
  open(key: string | null, view?: PanelView): void {
    if (view) void this.memory.update(PANEL_KEY, view);
    const shown = key ?? this.liveKey();
    if (shown) this.remember(shown);
    else this.forget();
    this.view = this.positionFor(shown);
    if (this.panel) {
      this.panel.reveal(undefined, false);
      this.show();
    } else {
      // Новая встаёт в группу спящей и только потом закрывает её: последняя вкладка группы унесла бы и группу.
      const asleep = asleepTab(SCHEME_TYPE);
      this.create(asleep?.group.viewColumn ?? vscode.ViewColumn.Beside);
      this.show();
      if (asleep) void vscode.window.tabGroups.close(asleep);
    }
  }

  /**
   * VS Code вернул вкладку после перезагрузки окна (F-125). Журнал мог смениться, пока она спала: вкладка следует за ним (F-64).
   * Изменения больше нет: схеме показывать нечего, вкладка закрывается; справка на месте и выбирает заново. Вкладка без изменения возвращается и показывает справку (F-24).
   */
  restore(panel: vscode.WebviewPanel): void {
    const key = this.deps.currentKey() ?? this.memory.get<string>(SHOWN_KEY) ?? null;
    const alive = key !== null && this.isActive(key);
    if (this.panel || (key !== null && !alive && this.memory.get<PanelView>(PANEL_KEY) !== "help")) {
      panel.dispose();
      return;
    }
    panel.webview.options = this.contentOptions();
    if (alive) this.remember(key);
    this.view = this.positionFor(alive ? key : null);
    this.attach(panel);
    this.show();
  }

  /** В просмотрщике открыт другой журнал: открытая вкладка показывает его, закрытая так и остаётся закрытой. */
  follow(key: string): void {
    if (!this.panel || key === this.key) return;
    this.remember(key);
    this.show();
  }

  /** `scheme.md` изменился на диске. */
  fileChanged(dir: string): void {
    if (this.panel && dir === this.key && this.page === SCHEME_PAGE) this.send();
  }

  /** Ответ расчёта справки. Пока показана схема, цель меняется и без нового расчёта: ответ для прежней цели не показывается (F-41). */
  helpAnswered(target: HelpTarget, outcome: HelpOutcome): void {
    if (!this.panel || !sameTarget(target, this.target())) return;
    if ("roots" in target) {
      // Изменение выбрало ядро: одно активное дальше показывается как последнее показанное. Иначе вкладка без изменения.
      const change = outcome.kind === "output" ? outcome.output.change : null;
      if (change && outcome.kind === "output") this.remember(changeDir(outcome.root, change));
      else this.forget();
    }
    this.outcome = outcome;
    this.paint();
  }

  /** Справку видно: вкладка не под другой и показана справка, а не схема. Считать для невидимой незачем (F-42). */
  helpVisible(): boolean {
    return !!this.panel && this.panel.visible && this.view === "help";
  }

  /** Для тестов: вкладка на виду, а не под другой. */
  visible(): boolean {
    return !!this.panel && this.panel.visible;
  }

  /** Что считать для справки сейчас: за просмотрщиком, затем последнее показанное, затем все папки (F-41). */
  helpTarget(): HelpTarget {
    return this.target();
  }

  /** Для тестов: сообщения страницы. */
  readonly messages = new vscode.EventEmitter<SchemePageMessage | HelpPageMessage>();
  /** Для тестов: страница как есть. */
  get webview(): vscode.Webview | null {
    return this.panel?.webview ?? null;
  }

  private get memory(): vscode.Memento {
    return this.deps.context.workspaceState;
  }

  private isActive(key: string): boolean {
    return this.deps.activeChanges().some((r) => r.dir === key);
  }

  /** Что показать, когда изменение не названо: за просмотрщиком, затем последнее показанное, если оно ещё есть. */
  private liveKey(): string | null {
    const key = this.deps.currentKey() ?? this.memory.get<string>(SHOWN_KEY) ?? null;
    return key !== null && this.isActive(key) ? key : null;
  }

  /** Без сохранённого выбора показывается схема, без изменения — справка (F-40). «Схему» без изменения выбирает только сам человек, переключателем. */
  private positionFor(key: string | null): PanelView {
    return key ? this.memory.get<PanelView>(PANEL_KEY) ?? "scheme" : "help";
  }

  private target(): HelpTarget {
    return chooseTarget(this.deps.currentKey(), this.key, this.deps.workspaceRoots(), this.deps.activeChanges());
  }

  /** Ответ расчёта про другое изменение показывать нельзя: при смене он забывается. */
  private remember(key: string): void {
    if (key !== this.key) this.outcome = null;
    this.key = key;
    void this.memory.update(SHOWN_KEY, key);
  }

  private forget(): void {
    if (this.key !== null) this.outcome = null;
    this.key = null;
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
    this.page = null;
    panel.iconPath = vscode.Uri.joinPath(this.deps.context.extensionUri, "media", "icon.svg");
    panel.webview.onDidReceiveMessage((m: SchemePageMessage | HelpPageMessage) => {
      this.messages.fire(m);
      void this.onMessage(m);
    });
    panel.onDidChangeViewState(() => {
      if (panel.visible) this.deps.helpShown();
    });
    panel.onDidDispose(() => {
      this.panel = null;
      this.ready = false;
      this.page = null;
      this.key = null;
      this.outcome = null;
    });
  }

  /** Показать и, если показана справка, посчитать. Показ расчёта не ждёт: на экране прежний ответ, пока не придёт новый (F-53). */
  private show(): void {
    this.paint();
    if (this.view === "help") this.deps.requestHelp(this.target());
  }

  /** Схема без изменения идёт на странице справки: рисовать нечего, mermaid не нужен. Новая страница получит данные, когда скажет о готовности. */
  private paint(): void {
    if (!this.panel) return;
    const page = this.view === "scheme" && this.key ? SCHEME_PAGE : HELP_PAGE;
    if (page === this.page) return this.send();
    this.page = page;
    this.ready = false;
    const webview = this.panel.webview;
    webview.html = page === SCHEME_PAGE
      ? pageHtml(webview, this.deps.context, SCHEME_PAGE, { before: ["mermaid.min.js"], inlineStyles: true })
      : pageHtml(webview, this.deps.context, HELP_PAGE);
  }

  /** Заголовок называет показанное и ставится вместе с данными: у пакета живость страницы видна только по нему (`test/e2e/vsix-scenario.ts`). */
  private send(): void {
    if (!this.panel || !this.ready) return;
    const name = this.key ? path.basename(this.key) : null;
    const what = this.view === "scheme" ? "Схема" : "Справка";
    this.panel.title = name ? `${what}: ${name}` : what;
    if (this.page === SCHEME_PAGE && this.key && name) {
      const m: SchemeHostMessage = { type: "scheme", view: { name, ...readScheme(this.key) } };
      void this.panel.webview.postMessage(m);
    } else {
      const m: HelpHostMessage = { type: "help", view: { panel: this.view, key: this.key, name, outcome: this.outcome, pluginVersion: String(this.deps.context.extension.packageJSON.version) } };
      void this.panel.webview.postMessage(m);
    }
  }

  private async onMessage(m: SchemePageMessage | HelpPageMessage): Promise<void> {
    switch (m.type) {
      case "schemeReady":
      case "helpReady":
        // Ответ прежней страницы на замену не считается: новая скажет о себе сама.
        if ((m.type === "schemeReady") !== (this.page === SCHEME_PAGE)) return;
        this.ready = true;
        this.send();
        return;
      case "panelView":
        if (m.view !== "scheme" && m.view !== "help") return;
        this.view = m.view;
        void this.memory.update(PANEL_KEY, m.view);
        this.show();
        return;
      case "helpRefresh":
        // «Обновить» считает сразу, минуя склейку записей.
        this.deps.requestHelp(this.target());
        return;
      case "helpChoose":
        // Ключ приходит со страницы: только из того, что есть на диске (`security.md`). Выбор запоминается как последнее показанное (F-41).
        if (!this.isActive(m.key)) return;
        this.remember(m.key);
        this.show();
        return;
      case "helpOpenFile": {
        // Ключ приходит со страницы: путь берётся из карты показанного вывода, остального не открывается (F-44, F-54).
        const shown = this.outcome?.kind === "output" ? this.outcome : null;
        const file = shown ? resolveLink(shown.output.file_links, m.link, shown.root) : null;
        if (file) await openBeside(file, lineOf(m.line));
        return;
      }
      case "helpOpenSkill": {
        // Страница называет скилл по имени; файл ищется в поле `skills` показанного вывода и только внутри каталога установки (F-91).
        const shown = this.outcome?.kind === "output" ? this.outcome : null;
        const file = shown ? resolveSkill(shown.output.steps.flatMap((p) => p.skills ?? []), m.name, this.deps.toolsPath()) : null;
        if (file) await openBeside(file, null);
        return;
      }
      case "openPythonSetting":
        await vscode.commands.executeCommand("workbench.action.openSettings", "symphysis.python");
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
