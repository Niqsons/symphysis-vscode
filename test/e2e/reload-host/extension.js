// Этапы теста перезагрузки. После каждой перезагрузки или перезапуска окна расширение активируется заново и берёт следующий этап из файла.
// Страницу отсюда не видно: что показано, говорит заголовок вкладки.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const JOURNAL = "Журнал: со-схемой";
const SCHEME = "Схема: со-схемой";
const HELP = "Справка: со-схемой";
const FILE = "intent.md";

const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
const cfg = JSON.parse(fs.readFileSync(path.join(root, "reload-probe.json"), "utf8"));
const changes = path.join(root, "openspec", "changes");
const change = path.join(changes, "со-схемой");
const other = path.join(changes, "другое");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);
const layout = () => vscode.window.tabGroups.all.map((g) => g.tabs.map((t) => t.label).sort());
const flat = () => layout().flat();
const same = (expected) => JSON.stringify(layout()) === JSON.stringify(expected.map((g) => [...g].sort()));
const openJournal = (key = change) => vscode.commands.executeCommand("symphysis.openChange", key);
const openScheme = (key = change) => vscode.commands.executeCommand("symphysis.openScheme", key);
const openHelp = () => vscode.commands.executeCommand("symphysis.openHelp");
/** Что отвечает форк: шим читает файл при каждом вызове, ответы готовит `reload.mjs`. */
const forkAnswers = (name) => fs.writeFileSync(path.join(cfg.fork, "scenario.json"), cfg.scenarios[name], "utf8");
/** Заголовок вернувшейся вкладки помнит сам VS Code: то, что решил плагин, видно только после того, как он её поднял и страница ответила. */
const pluginDecided = () => sleep(3000);

async function until(what, check, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return;
    await sleep(100);
  }
  throw new Error(`${what}: не дождались, раскладка ${JSON.stringify(layout())}`);
}

async function step(name, fn) {
  const start = Date.now();
  const report = readJson(cfg.results, { tests: [], measures: {} });
  try {
    await fn();
    report.tests.push({ name, ok: true, ms: Date.now() - start });
  } catch (e) {
    report.tests.push({ name, ok: false, error: e.message ?? String(e) });
  }
  fs.writeFileSync(cfg.results, JSON.stringify(report, null, 1), "utf8");
}

const STAGES = [
  async () => {
    await step("журнал и схема открыты рядом", async () => {
      await openJournal();
      await until("журнал", () => flat().includes(JOURNAL));
      await openScheme();
      await until("обе вкладки", () => same([[JOURNAL], [SCHEME]]));
    });
    return "reload";
  },
  async () => {
    await step("«Перезагрузка окна»: Ctrl+R: журнал и схема на своих местах, пустых групп нет (F-125)", () => until("раскладка", () => same([[JOURNAL], [SCHEME]])));
    await step("выбор изменения и «схема» после перезагрузки не добавляют ни вкладок, ни групп", async () => {
      await openJournal();
      await openScheme();
      await sleep(1000);
      assert.deepEqual(layout(), [[JOURNAL], [SCHEME]]);
    });
    return "reload";
  },
  async () => {
    await step("журнал уходит под файл в своей группе", async () => {
      await until("раскладка", () => same([[JOURNAL], [SCHEME]]));
      const doc = await vscode.workspace.openTextDocument(path.join(root, FILE));
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      await until("файл поверх журнала", () => vscode.window.tabGroups.all[0].activeTab?.label === FILE);
    });
    return "reload";
  },
  async () => {
    await step("Ctrl+R: вкладка журнала под файлом на месте", () => until("раскладка", () => same([[FILE, JOURNAL], [SCHEME]])));
    await step("«Вкладка под другой вкладкой»: выбор изменения при спящей вкладке: второй журнал не появился, он показан в той же группе (F-125)", async () => {
      await openJournal();
      await until("журнал показан", () => vscode.window.tabGroups.all[0].activeTab?.label === JOURNAL);
      await sleep(1000);
      assert.deepEqual(layout(), [[JOURNAL, FILE].sort(), [SCHEME]]);
    });
    return "relaunch";
  },
  async () => {
    await step("«Перезагрузка окна»: полный перезапуск окна: журнал и схема на своих местах (F-125)", () => until("раскладка", () => same([[FILE, JOURNAL], [SCHEME]])));
    await step("команда справки: та же вкладка показывает справку, заголовок называет её", async () => {
      await openHelp();
      await until("заголовок", () => same([[FILE, JOURNAL], [HELP]]));
    });
    return "reload";
  },
  async () => {
    await step("«Выбор сохранился»: показана справка, окно перезагружено: показана справка", async () => {
      await pluginDecided();
      assert.deepEqual(layout(), [[FILE, JOURNAL].sort(), [HELP]]);
    });
    await step("журнал закрыт, справка осталась", async () => {
      await vscode.window.tabGroups.close(vscode.window.tabGroups.all[0]);
      await until("раскладка", () => same([[HELP]]));
    });
    return "reload";
  },
  async () => {
    await step("«Просмотрщик закрыт»: вкладка показывала изменение, окно перезагружено: показывает его же", async () => {
      await pluginDecided();
      assert.deepEqual(layout(), [[HELP]]);
    });
    forkAnswers("другое");
    fs.mkdirSync(path.join(changes, "archive"), { recursive: true });
    fs.renameSync(change, path.join(changes, "archive", "2026-11-04-со-схемой"));
    return "reload";
  },
  async () => {
    await step("«Справка, изменения больше нет»: заархивировано, окно перезагружено: вкладка на месте, изменение выбрано заново", () => until("заголовок", () => same([["Справка: другое"]])));
    await step("журнал и схема другого изменения открыты, переключатель на «схема»", async () => {
      await openJournal(other);
      await until("журнал", () => flat().includes("Журнал: другое"));
      await openScheme(other);
      await until("схема", () => flat().includes("Схема: другое"));
    });
    forkAnswers("пусто");
    fs.rmSync(other, { recursive: true, force: true });
    return "reload";
  },
  async () => {
    await step("«Изменения больше нет»: после Ctrl+R вкладок журнала и схемы нет", async () => {
      // Сразу после старта вкладок может не быть просто потому, что VS Code их ещё не поднял: проверяется то, что осталось.
      await sleep(4000);
      assert.deepEqual(flat().filter((l) => /^(Журнал|Схема|Справка)/.test(l)), []);
    });
    await step("команда справки без изменений: заголовок «Справка»", async () => {
      await openHelp();
      await until("заголовок", () => flat().includes("Справка"));
    });
    return "reload";
  },
  async () => {
    await step("«Перезагрузка без изменения» и «Вкладка без изменения»: вкладка на месте, показана справка", async () => {
      await pluginDecided();
      assert.deepEqual(layout(), [["Справка"]]);
    });
    return "done";
  },
];

exports.activate = () => {
  void (async () => {
    const state = readJson(cfg.state, { stage: 0 });
    const finish = await STAGES[state.stage]();
    fs.writeFileSync(cfg.state, JSON.stringify({ stage: state.stage + 1, phase: finish }), "utf8");
    // Запись плагина в workspaceState доходит не мгновенно: человек тоже не жмёт Ctrl+R в ту же секунду.
    await sleep(1000);
    // Вызов рвётся вместе с хостом: его отказ здесь не ошибка.
    vscode.commands.executeCommand(finish === "reload" ? "workbench.action.reloadWindow" : "workbench.action.quit").then(undefined, () => {});
  })();
};
exports.deactivate = () => {};
