// Точка входа: Python и ядро, данные журналов, слежение за файлами (Р5), боковая панель, вкладка просмотрщика.
import * as path from "node:path";
import * as vscode from "vscode";
import { viewJson, type CoreEnv, type ViewResult } from "./host/core";
import { findTools, listChanges, type ChangeRef } from "./host/project";
import { resolvePython, type PythonResolution } from "./host/python";
import { ChangesProvider, TocProvider } from "./host/sidebar";
import { JournalStore, keyOf } from "./host/store";
import { ViewerPanel } from "./host/viewerPanel";
import type { Colors, CoreFailure } from "./shared/protocol";

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

  const coreEnv = (ref: ChangeRef): CoreEnv | CoreFailure => {
    const tools = findTools(ref.root);
    if (!tools) return { kind: "no-tools", root: ref.root };
    const py = pythonNow();
    if (!py.ok) return { kind: "no-python", reason: py.reason, tried: py.tried };
    return { python: py.path, tools, cwd: ref.root };
  };

  const run = async (ref: ChangeRef): Promise<ViewResult> => {
    if (!ref.hasJournal) return { ok: false, failure: { kind: "no-journal" } };
    const env = coreEnv(ref);
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
      if (key === viewer.currentKey) toc.refresh();
      viewer.journalUpdated(key);
    },
  });
  const changes = new ChangesProvider(store, () => workspaceDirs().length > 1);
  const toc = new TocProvider(store);
  const tocView = vscode.window.createTreeView("symphysis.toc", { treeDataProvider: toc });
  const viewer: ViewerPanel = new ViewerPanel({
    context, store, coreEnv, colors,
    onShown: (key) => {
      toc.show(key);
      tocView.description = key ? store.get(key)?.ref.name : undefined;
    },
    onDraft: (key, draft) => toc.setDraft(key, draft),
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
      const tools = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, ".symphysis/tools/journal.py"));
      const all = () => { store.refreshAll(); changes.refresh(); };
      return [...journalWatchers.flat(), tools, tools.onDidChange(all), tools.onDidCreate(all), tools.onDidDelete(all)];
    });
  };
  watch();

  store.refreshAll();
  changes.refresh();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("symphysis.changes", changes),
    tocView,
    vscode.commands.registerCommand("symphysis.refresh", () => { python = null; store.refreshAll(); changes.refresh(); }),
    vscode.commands.registerCommand("symphysis.openChange", (key?: string) => {
      const target = key ?? store.list()[0]?.ref.dir;
      if (target) viewer.open(target);
    }),
    vscode.commands.registerCommand("symphysis.revealRecord", (id: string) => viewer.reveal(id)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { watch(); store.refreshAll(); changes.refresh(); }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("symphysis.colors")) viewer.colorsChanged();
      if (e.affectsConfiguration("symphysis.python")) { python = null; store.refreshAll(); changes.refresh(); }
    }),
    { dispose: () => { watchers.forEach((w) => w.dispose()); timers.forEach(clearTimeout); } },
  );

  if (context.extensionMode === vscode.ExtensionMode.Test) return { store, viewer, keyOf };
  return undefined;
}

export function deactivate() {}
