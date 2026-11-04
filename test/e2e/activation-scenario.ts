// Сценарии `activation.mjs`: что сделала сама активация. Имя функции — имя запуска.
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { results, step } from "./steps";

interface Api {
  hookIdle(): Promise<void>;
}

const settingsOf = (root: string) => path.join(root, ".claude", "settings.local.json");
const scriptOf = (root: string) => path.join(root, ".symphysis", "viewer", "hook.py");

function assertHookStands(root: string) {
  const groups = JSON.parse(fs.readFileSync(settingsOf(root), "utf8")).hooks.UserPromptSubmit;
  const own = groups.flatMap((g: any) => g.hooks).filter((h: any) => h.args?.some((a: string) => a.endsWith("/.symphysis/viewer/hook.py")));
  assert.equal(own.length, 1);
  assert.ok(path.isAbsolute(own[0].command));
  assert.ok(fs.existsSync(scriptOf(root)));
}

const RUNS: Record<string, () => Promise<void>> = {
  "Выключение в одном проекте": async () => {
    const off = process.env.SYMPHYSIS_E2E_OFF!;
    const on = process.env.SYMPHYSIS_E2E_ON!;
    assert.equal(vscode.workspace.workspaceFolders?.length, 2);
    assert.equal(vscode.workspace.getConfiguration("symphysis.hook", vscode.Uri.file(off)).get("enabled"), false);
    assert.equal(vscode.workspace.getConfiguration("symphysis.hook", vscode.Uri.file(on)).get("enabled"), true);
    assert.equal(fs.existsSync(settingsOf(off)), false, "в этом проекте записи нет");
    assert.equal(fs.existsSync(scriptOf(off)), false);
    assertHookStands(on);
  },
  "Первая активация ставит запись": async () => assertHookStands(process.env.SYMPHYSIS_E2E_ON!),
  "Запись удалена руками": async () => assertHookStands(process.env.SYMPHYSIS_E2E_ON!),
};

export async function run(): Promise<void> {
  const name = process.env.SYMPHYSIS_E2E_RUN!;
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "symphysis-vscode")!;
  const api = (await ext.activate()) as Api;
  await step(`«${name}»`, async () => {
    await api.hookIdle();
    await RUNS[name]();
  });
  fs.writeFileSync(process.env.SYMPHYSIS_E2E_RESULTS!, JSON.stringify({ tests: results, measures: {} }, null, 1), "utf8");
}
