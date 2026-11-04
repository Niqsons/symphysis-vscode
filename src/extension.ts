// Точка входа: Python и ядро, данные журналов, слежение за файлами (Р5), боковая панель, вкладка просмотрщика, запуски хука клиента.
import * as path from "node:path";
import * as vscode from "vscode";
import { viewJson, type CoreEnv, type ViewResult } from "./host/core";
import { resolveGit } from "./host/hookGit";
import { HookRunner } from "./host/hookRunner";
import { tasksFor } from "./host/helpTasks";
import { findTools, installDirOf, listChanges, type ChangeRef } from "./host/project";
import { resolvePython, type PythonResolution } from "./host/python";
import { SearchView } from "./host/searchView";
import { AttackTocProvider, ChangesProvider, TocProvider } from "./host/sidebar";
import { SCHEME_TYPE, SchemePanel } from "./host/schemePanel";
import { computeHelp, StepHelpRunner, type HelpTarget } from "./host/stepHelp";
import { JournalStore, keyOf } from "./host/store";
import { VIEWER_TYPE, ViewerPanel } from "./host/viewerPanel";
import type { Colors, CoreFailure, HelpOutcome } from "./shared/protocol";

const REFRESH_DELAY_MS = 150;
const CONCURRENT_RUNS = 2;
const CHANGES = path.join("openspec", "changes");

const workspaceDirs = () => (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath);

export function activate(context: vscode.ExtensionContext) {
  let python: PythonResolution | null = null;
  const pythonNow = (): PythonResolution => {
    if (!python?.ok) python = resolvePython(process.env, workspaceDirs(), vscode.workspace.getConfiguration("symphysis").get<string>("python") || undefined);
    return python;
  };

  // Уровень машины: значение из файла настроек проекта сюда не доходит, иначе проект выбирал бы запускаемый код (`security.md`).
  const toolsPath = () => vscode.workspace.getConfiguration("symphysis").get<string>("toolsPath") || undefined;

  const coreEnv = (root: string): CoreEnv | CoreFailure => {
    const tools = findTools(root, toolsPath());
    if ("kind" in tools) return tools;
    const py = pythonNow();
    if (!py.ok) return { kind: "no-python", reason: py.reason, tried: py.tried };
    return { python: py.path, tools: tools.dir, cwd: root, installDir: tools.installDir };
  };

  // Для сквозных тестов: сколько раз считался `view-json`.
  let viewRuns = 0;
  const run = async (ref: ChangeRef): Promise<ViewResult> => {
    viewRuns++;
    if (!ref.hasJournal) return { ok: false, failure: { kind: "no-journal" } };
    const env = coreEnv(ref.root);
    return "kind" in env ? { ok: false, failure: env } : viewJson(env, ref);
  };

  const colors = (): Colors => {
    const c = vscode.workspace.getConfiguration("symphysis.colors");
    return { signal: c.get("signal", "#FF5555"), accent: c.get("accent", "#FFB86C"), muted: c.get("muted", "#6272A4") };
  };

  const store: JournalStore = new JournalStore({
    list: () => workspaceDirs().flatMap(listChanges),
    run,
    concurrency: CONCURRENT_RUNS,
    onUpdate: (key) => {
      changes.refresh();
      if (key === viewer.currentKey) {
        toc.refresh();
        attackToc.refresh();
        attackView.message = attackToc.message();
        search.refresh();
      }
      viewer.journalUpdated(key);
    },
  });
  const changes = new ChangesProvider(store, () => workspaceDirs().length > 1);
  const toc = new TocProvider(store);
  const tocView = vscode.window.createTreeView("symphysis.toc", { treeDataProvider: toc });
  const attackToc = new AttackTocProvider(store);
  const attackView = vscode.window.createTreeView("symphysis.attackToc", { treeDataProvider: attackToc });
  attackView.message = attackToc.message();
  const search = new SearchView({ context, store, colors, reveal: (t) => viewer.reveal(t.id, t.mode) });
  const viewer: ViewerPanel = new ViewerPanel({
    context, store, coreEnv, colors,
    onShown: (key) => {
      toc.show(key);
      attackToc.show(key);
      search.show(key);
      const name = key ? store.get(key)?.ref.name : undefined;
      tocView.description = name;
      attackView.description = name;
      attackView.message = attackToc.message();
      // Открытый журнал считает свой шаг сразу: числа задач в шапке приходят из этого расчёта (13.1).
      if (key) { scheme.follow(key); recalcHelp(); }
    },
    onDraft: (key, draft) => {
      toc.setDraft(key, draft);
      search.setDraft(key, draft);
    },
    openScheme: (key) => scheme.open(key),
    tasksOf: (key) => tasksFor(key, lastHelp),
  });
  // Одна точка, куда приходит ответ расчёта справки: вкладка показывает его, а считается и при закрытой вкладке, пока открыт журнал.
  // Последний ответ хранится для строки счётчиков просмотрщика (следующая единица).
  let lastHelp: { target: HelpTarget; outcome: HelpOutcome } | null = null;
  const help = new StepHelpRunner({
    compute: (target) => computeHelp(target, coreEnv),
    onResult: (target, outcome) => { lastHelp = { target, outcome }; scheme.helpAnswered(target, outcome); viewer.tasksChanged(); },
  });
  // Справка считается, только пока её видно или открыт журнал (F-42). Файлы менялись, а смотреть было некому: пересчёт при следующем показе.
  let helpStale = false;
  let helpTimer: NodeJS.Timeout | undefined;
  const helpWanted = () => scheme.helpVisible() || viewer.currentKey !== null;
  const recalcHelp = () => {
    if (helpWanted()) {
      helpStale = false;
      help.request(scheme.helpTarget());
    } else {
      helpStale = true;
    }
  };
  // Склейка записей: агент пишет файлы сериями. Таймер только для склейки, опроса нет (F-25).
  const helpSoon = () => {
    clearTimeout(helpTimer);
    helpTimer = setTimeout(recalcHelp, REFRESH_DELAY_MS);
  };
  const helpIfStale = () => { if (helpStale && helpWanted()) recalcHelp(); };
  const scheme: SchemePanel = new SchemePanel({
    context,
    showNode: (key, id) => viewer.showNode(key, id),
    currentKey: () => viewer.currentKey,
    activeChanges: () => workspaceDirs().flatMap(listChanges),
    workspaceRoots: workspaceDirs,
    requestHelp: (target) => help.request(target),
    helpShown: helpIfStale,
    installDir: () => {
      const value = toolsPath();
      return value ? installDirOf(value) : undefined;
    },
  });

  // Сохранения склеиваются: автосохранение пишет каждые несколько секунд, агент — сериями.
  const timers = new Map<string, NodeJS.Timeout>();
  const refreshSoon = (key: string) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      store.sync();
      changes.refresh();
      store.refresh(key);
    }, REFRESH_DELAY_MS));
  };
  const onChangeFile = (root: string) => (uri: vscode.Uri) => {
    const name = path.relative(path.join(root, CHANGES), uri.fsPath).split(path.sep)[0];
    if (!name || name === "archive" || name.startsWith("..")) return;
    refreshSoon(path.join(root, CHANGES, name));
  };

  // Хук клиента: активация этого не ждёт. Настройка по папке, чтобы её можно было выключить в одном проекте (F-106).
  const hook = new HookRunner({
    extensionPath: context.extensionPath,
    enabled: (root) => vscode.workspace.getConfiguration("symphysis.hook", vscode.Uri.file(root)).get("enabled", true),
    python: pythonNow,
    toolsPath,
    git: () => resolveGit(process.env, workspaceDirs()),
    window: vscode.window,
    memory: context.workspaceState,
  });
  const hookAll = () => workspaceDirs().forEach((root) => hook.request(root));

  let watchers: vscode.Disposable[] = [];
  const watch = () => {
    watchers.forEach((w) => w.dispose());
    watchers = workspaceDirs().flatMap((root) => {
      const folder = vscode.Uri.file(root);
      const on = onChangeFile(root);
      const journalWatchers = ["openspec/changes/*/decisions.json", "openspec/changes/*/attack/*.md", "openspec/changes/*"].map((glob) => {
        const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, glob));
        return [w, w.onDidChange(on), w.onDidCreate(on), w.onDidDelete(on)];
      });
      // Всё, что лежит в каталоге изменения, даёт только пересчёт справки: новый артефакт появляется без правки списка в плагине (F-26). Журнал по этому не считается.
      const helpWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "openspec/changes/*/**"));
      const onHelpFile = (uri: vscode.Uri) => {
        const name = path.relative(path.join(root, CHANGES), uri.fsPath).split(path.sep)[0];
        if (name && name !== "archive" && !name.startsWith("..")) helpSoon();
      };
      journalWatchers.push([helpWatcher, helpWatcher.onDidChange(onHelpFile), helpWatcher.onDidCreate(onHelpFile), helpWatcher.onDidDelete(onHelpFile)]);
      // Схема: вкладка рисует сразу, просмотрщик узнаёт через обычное перечитывание журнала (подсказка «узел не найден»).
      const schemeWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "openspec/changes/*/scheme.md"));
      const onScheme = (uri: vscode.Uri) => { scheme.fileChanged(path.dirname(uri.fsPath)); on(uri); };
      journalWatchers.push([schemeWatcher, schemeWatcher.onDidChange(onScheme), schemeWatcher.onDidCreate(onScheme), schemeWatcher.onDidDelete(onScheme)]);
      const tools = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, ".symphysis/tools/journal.py"));
      const recheck = () => hook.request(root);
      const all = () => { store.refreshAll(); changes.refresh(); recheck(); helpSoon(); };
      // Файл настроек только перепроверяет условие хука: журнал по нему не считается.
      const config = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "openspec/config.yaml"));
      return [...journalWatchers.flat(), tools, tools.onDidChange(all), tools.onDidCreate(all), tools.onDidDelete(all), config, config.onDidChange(recheck), config.onDidCreate(recheck), config.onDidDelete(recheck)];
    });
  };
  watch();

  store.refreshAll();
  changes.refresh();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("symphysis.changes", changes),
    tocView,
    attackView,
    vscode.window.registerWebviewViewProvider("symphysis.search", search),
    vscode.window.registerWebviewPanelSerializer(VIEWER_TYPE, { deserializeWebviewPanel: async (panel) => viewer.restore(panel) }),
    vscode.window.registerWebviewPanelSerializer(SCHEME_TYPE, { deserializeWebviewPanel: async (panel) => scheme.restore(panel) }),
    vscode.commands.registerCommand("symphysis.refresh", () => { python = null; store.refreshAll(); changes.refresh(); hookAll(); helpSoon(); }),
    vscode.commands.registerCommand("symphysis.openChange", (key?: string) => {
      const target = key ?? store.list()[0]?.ref.dir;
      if (target) viewer.open(target);
    }),
    vscode.commands.registerCommand("symphysis.openScheme", (key?: string) => {
      const target = key ?? viewer.currentKey ?? store.list()[0]?.ref.dir;
      if (target) scheme.open(target, "scheme");
    }),
    // Без журнала и без изменений тоже: вкладка открывается всегда, какое изменение показать, решает она сама (F-40, F-41).
    vscode.commands.registerCommand("symphysis.openHelp", () => scheme.open(viewer.currentKey, "help")),
    vscode.commands.registerCommand("symphysis.revealRecord", (id: string) => viewer.reveal(id)),
    vscode.commands.registerCommand("symphysis.revealAttack", (anchor: string) => viewer.reveal(anchor, "attack")),
    // Окружение справки сменилось: отказ на вкладке не должен пережить свою причину. Расчёт, шедший в этот момент, отброшен сверкой цели, новый его заменяет.
    vscode.workspace.onDidChangeWorkspaceFolders(() => { watch(); store.refreshAll(); changes.refresh(); hookAll(); helpSoon(); }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("symphysis.colors")) { viewer.colorsChanged(); search.refresh(); }
      if (e.affectsConfiguration("symphysis.python")) { python = null; store.refreshAll(); changes.refresh(); hookAll(); helpSoon(); }
      if (e.affectsConfiguration("symphysis.toolsPath")) { store.refreshAll(); changes.refresh(); hookAll(); helpSoon(); }
      if (e.affectsConfiguration("symphysis.hook.enabled")) hookAll();
    }),
    { dispose: () => { watchers.forEach((w) => w.dispose()); timers.forEach(clearTimeout); clearTimeout(helpTimer); } },
  );

  hookAll();

  if (context.extensionMode === vscode.ExtensionMode.Test) return { store, viewer, scheme, changes, toc, attackToc, search, keyOf, hookIdle: () => hook.whenIdle(), viewRuns: () => viewRuns, helpAnswer: () => lastHelp };
  return undefined;
}

export function deactivate() {}
