// Сценарии `activation.mjs`: что сделала сама активация. Имя функции — имя запуска.
// `activate` тест не зовёт ни в одном запуске: он поднял бы плагин и там, где событие активации не сработало (F-39).
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { driver, results, sleep, step, until } from "./steps";

interface Api {
  hookIdle(): Promise<void>;
  changes: { getChildren(): { ref: { name: string } }[] };
  scheme: { messages: vscode.EventEmitter<any>; webview: vscode.Webview | null };
}
type Ext = vscode.Extension<Api>;

const settingsOf = (root: string) => path.join(root, ".claude", "settings.local.json");
const scriptOf = (root: string) => path.join(root, ".symphysis", "viewer", "hook.py");

function assertHookStands(root: string) {
  const groups = JSON.parse(fs.readFileSync(settingsOf(root), "utf8")).hooks.UserPromptSubmit;
  const own = groups.flatMap((g: any) => g.hooks).filter((h: any) => h.args?.some((a: string) => a.endsWith("/.symphysis/viewer/hook.py")));
  assert.equal(own.length, 1);
  assert.ok(path.isAbsolute(own[0].command));
  assert.ok(fs.existsSync(scriptOf(root)));
}

const activated = (ext: Ext) => until("плагин активирован событием", () => ext.isActive);
const hookDone = async (ext: Ext) => {
  await activated(ext);
  await ext.exports.hookIdle();
};

/** Команда кнопки и палитры работает и без журнала: вкладка на месте. Что на ней показано — забота сценария «Команда палитры». */
async function assertHelpOpens() {
  await vscode.commands.executeCommand("symphysis.openHelp");
  await until("вкладка", () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith("symphysis.scheme")));
}

const RUNS: Record<string, (ext: Ext) => Promise<void>> = {
  "«Выключение в одном проекте»": async (ext) => {
    await hookDone(ext);
    const off = process.env.SYMPHYSIS_E2E_OFF!;
    const on = process.env.SYMPHYSIS_E2E_ON!;
    assert.equal(vscode.workspace.workspaceFolders?.length, 2);
    assert.equal(vscode.workspace.getConfiguration("symphysis.hook", vscode.Uri.file(off)).get("enabled"), false);
    assert.equal(vscode.workspace.getConfiguration("symphysis.hook", vscode.Uri.file(on)).get("enabled"), true);
    assert.equal(fs.existsSync(settingsOf(off)), false, "в этом проекте записи нет");
    assert.equal(fs.existsSync(scriptOf(off)), false);
    assertHookStands(on);
  },
  "«Первая активация ставит запись»": async (ext) => {
    await hookDone(ext);
    assertHookStands(process.env.SYMPHYSIS_E2E_ON!);
  },
  "«Запись удалена руками»": async (ext) => {
    await hookDone(ext);
    assertHookStands(process.env.SYMPHYSIS_E2E_ON!);
  },
  "«Проект без журнала»": async (ext) => {
    await hookDone(ext);
    assert.deepEqual(ext.exports.changes.getChildren().map((c) => c.ref.name), ["без-журнала"]);
    assertHookStands(process.env.SYMPHYSIS_E2E_ON!);
    await assertHelpOpens();
  },
  "«Пустой проект, боковая панель»": async (ext) => {
    // Контроль: окно открыто, панель закрыта, плагина нет. Без него «активирован событием» в других запусках ничего бы не значило.
    await sleep(2000);
    assert.equal(ext.isActive, false, "пустая папка не должна поднимать плагин при открытии окна");
    await vscode.commands.executeCommand("workbench.view.extension.symphysis");
    await activated(ext);
    // Заголовок и строку списка рисует сам VS Code, из хоста расширения их не прочитать: проверяется то, из чего он их рисует.
    const { commands, menus, viewsWelcome } = ext.packageJSON.contributes;
    assert.deepEqual(menus["view/title"].find((m: { command: string }) => m.command === "symphysis.openHelp"), { command: "symphysis.openHelp", when: "view == symphysis.changes", group: "navigation" });
    assert.ok(commands.find((c: { command: string }) => c.command === "symphysis.openHelp").icon, "кнопка в заголовке рисуется значком");
    assert.deepEqual(ext.exports.changes.getChildren(), [], "список пуст, поэтому VS Code показывает строку о каталоге");
    assert.ok(viewsWelcome.find((w: { view: string }) => w.view === "symphysis.changes").contents.includes("нет каталога openspec/changes"));
    await assertHelpOpens();
  },
  "«Команда палитры»": async (ext) => {
    await activated(ext);
    assert.deepEqual(ext.exports.changes.getChildren(), [], "изменений нет");
    await vscode.commands.executeCommand("symphysis.openHelp");
    const drive = driver(() => ext.exports.scheme.webview, ext.exports.scheme.messages);
    const help = await until("текущий шаг", async () => {
      const r = await drive("helpSnapshot").catch(() => null);
      return r?.current ? r : null;
    }, 25000);
    assert.match(help.current, /intent/);
    assert.match(help.current, /ход человека/);
    assert.equal(help.panel, "справка");
    assert.ok(help.currentInList, "текущий шаг не отмечен в списке");
    assert.deepEqual(help.violations, []);
    await until("заголовок вкладки без изменения", () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.label === "Справка"));
  },
};

export async function run(): Promise<void> {
  const name = process.env.SYMPHYSIS_E2E_RUN!;
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "symphysis-vscode")! as Ext;
  await step(name, () => RUNS[name](ext));
  fs.writeFileSync(process.env.SYMPHYSIS_E2E_RESULTS!, JSON.stringify({ tests: results, measures: {} }, null, 1), "utf8");
}
