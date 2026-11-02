// Что получает человек: расширение из установленного .vsix, обычный режим, тестового API и водителя нет. Страницу снаружи не потрогать,
// поэтому живость её скрипта видна по заголовку вкладки: хост ставит его только в ответ на «готово» со страницы.
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { results, sleep, step, until } from "./steps";

const ID = "symphysis.symphysis-vscode";
/** Белый список .vscodeignore: забытый файл молча даёт пустую панель, лишний — утечку исходников. */
const PACKAGE = [".vsixmanifest", "media/icon.svg", "media/mermaid.LICENSE", "media/mermaid.min.js", "media/scheme.js", "media/search.js", "media/viewer.css", "media/viewer.js", "out/extension.js", "package.json"];

export async function run(): Promise<void> {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const ext = vscode.extensions.getExtension(ID);
  const change = (name: string) => path.join(root, "openspec", "changes", name);
  const tab = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputWebview)?.label;

  await step("установлен пакет, а не исходники: каталог расширений, состав — ровно белый список", async () => {
    assert.ok(ext, "расширение не установлено");
    assert.ok(ext!.extensionPath.startsWith(process.env.SYMPHYSIS_E2E_EXTENSIONS!), ext!.extensionPath);
    const files = (fs.readdirSync(ext!.extensionPath, { recursive: true }) as string[])
      .filter((f) => fs.statSync(path.join(ext!.extensionPath, f)).isFile())
      .map((f) => f.replace(/\\/g, "/"))
      .sort();
    assert.deepEqual(files, PACKAGE);
  });

  await step("версия установленного: версия пакета и хеш коммита, как в имени файла", async () => {
    assert.equal(ext!.packageJSON.version, process.env.SYMPHYSIS_E2E_VERSION);
    assert.match(ext!.packageJSON.version, /^\d+\.\d+\.\d+\+[0-9a-f]+(\.dirty)?$/);
  });

  await step("активация в обычном режиме: тестового API нет", async () => {
    const api = await ext!.activate();
    assert.equal(ext!.isActive, true);
    assert.equal(api, undefined);
  });

  await step("вкладка просмотрщика: скрипт страницы из пакета работает и отвечает хосту", async () => {
    await vscode.commands.executeCommand("workbench.view.extension.symphysis");
    await vscode.commands.executeCommand("symphysis.openChange", change("с-атакой"));
    await until("заголовок вкладки", () => tab() === "Журнал: с-атакой");
    await vscode.commands.executeCommand("symphysis.openChange", change("изменение-один"));
    await until("другое изменение", () => tab() === "Журнал: изменение-один");
    await vscode.commands.executeCommand("symphysis.openChange", change("с-атакой"));
    await until("обратно", () => tab() === "Журнал: с-атакой");
  });

  await step("вкладка схемы: кнопка и команда объявлены пакетом, открывается рядом с просмотрщиком", async () => {
    await vscode.commands.executeCommand("symphysis.openScheme", change("с-атакой"));
    await until("вкладка схемы", () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.label === "Схема: с-атакой"));
  });

  await step("поиск и оглавления объявлены пакетом и открываются", async () => {
    const views = ext!.packageJSON.contributes.views.symphysis.map((v: { id: string }) => v.id);
    assert.deepEqual(views, ["symphysis.changes", "symphysis.search", "symphysis.toc", "symphysis.attackToc"]);
    await vscode.commands.executeCommand("symphysis.search.focus");
    await vscode.commands.executeCommand("symphysis.attackToc.focus");
    await vscode.commands.executeCommand("symphysis.search.focus");
  });

  await step("служебные команды просмотрщика в палитре не видны", async () => {
    const hidden = ext!.packageJSON.contributes.menus.commandPalette.filter((m: { when: string }) => m.when === "false").map((m: { command: string }) => m.command).sort();
    assert.deepEqual(hidden, ["symphysis.openChange", "symphysis.revealAttack", "symphysis.revealRecord"]);
  });

  fs.writeFileSync(process.env.SYMPHYSIS_E2E_RESULTS!, JSON.stringify({ tests: results, measures: {} }, null, 1), "utf8");
  const pause = Number(process.env.SYMPHYSIS_E2E_PAUSE_MS || 0);
  if (pause) await sleep(pause);
}
