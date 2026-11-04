// Что делает сама активация и что требует своего окна: настоящий VS Code, свой запуск на каждый случай, потому что в одном окне вторую активацию не устроить.
// Новый запуск: строка в RUNS и функция с тем же именем в activation-scenario.ts.
import { runTests } from "@vscode/test-electron";
import fs from "node:fs";
import path from "node:path";
import { FORK_APPLY, forkScenario, forkStatus, forkStatusAll, installForkShim } from "../fork-shim.mjs";
import { tempDir } from "../temp-dir.mjs";
import { addChange, cleanEnv, CODE, finish, fixtures, projectWithTools, repo, report, SYMPHYSIS } from "./harness.mjs";

const work = tempDir("symphysis-activation-");

/** Проект с журналом, инструментами и следом Claude Code. `settings` — настройки папки. */
function project(name, settings) {
  const dir = path.join(work, "проекты", name);
  projectWithTools(dir);
  fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(addChange(dir, "изменение-один"), "decisions.json"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  if (settings) {
    fs.mkdirSync(path.join(dir, ".vscode"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".vscode", "settings.json"), JSON.stringify(settings), "utf8");
  }
  return dir;
}

function twoFolders() {
  const off = project("выключен", { "symphysis.hook.enabled": false });
  const on = project("включён");
  const open = path.join(work, "две папки.code-workspace");
  fs.writeFileSync(open, JSON.stringify({ folders: [{ path: off }, { path: on }] }), "utf8");
  return { open, env: { SYMPHYSIS_E2E_OFF: off, SYMPHYSIS_E2E_ON: on } };
}

const again = project("вторая активация");

/** `openspec/` есть, журнала нет ни в одном изменении и файлов в изменении нет вовсе. Инструменты и след клиента на месте: активация обязана поставить и хук. */
function withoutJournal() {
  const dir = path.join(work, "проекты", "без журнала");
  projectWithTools(dir);
  addChange(dir, "без-журнала");
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  return { open: dir, env: { SYMPHYSIS_E2E_ON: dir } };
}

function emptyFolder() {
  const dir = path.join(work, "проекты", "пустой проект");
  fs.mkdirSync(dir, { recursive: true });
  return { open: dir, env: {} };
}

/** Инструменты есть, изменений нет. `step_help.py` настоящий, форк шимом: его в этой среде может не быть. */
function noChanges() {
  const dir = path.join(work, "проекты", "без изменений");
  projectWithTools(dir);
  fs.mkdirSync(path.join(dir, "openspec", "changes"), { recursive: true });
  return { open: dir, env: installForkShim(SYMPHYSIS, path.join(work, "шим форка"), { status_all: forkStatusAll() }).env };
}

/** Файл рабочей области с одной папкой, вторая и третья добавляются по ходу сценария. Ответы шима на этапы лежат рядом: сценарий их подставляет. */
function changingFolders() {
  const folder = (name) => path.join(work, "проекты", name);
  const first = folder("первая папка");
  projectWithTools(first);
  fs.mkdirSync(path.join(first, "openspec", "changes"), { recursive: true });
  const second = folder("вторая папка");
  projectWithTools(second);
  addChange(second, "новое");
  const third = folder("третья папка");
  fs.mkdirSync(third, { recursive: true });
  const open = path.join(work, "папки.code-workspace");
  fs.writeFileSync(open, JSON.stringify({ folders: [{ path: first }] }), "utf8");
  const fork = installForkShim(SYMPHYSIS, path.join(work, "шим форка папок"), { status_all: { ...forkStatusAll(), hang: 6 } });
  const dir = path.dirname(fork.file);
  fs.writeFileSync(path.join(dir, "без-задержки.json"), forkScenario({ status_all: forkStatusAll() }), "utf8");
  fs.writeFileSync(path.join(dir, "вторая-папка.json"), forkScenario({ status_all: forkStatusAll("новое"), status: forkStatus(second, "новое"), apply: FORK_APPLY }), "utf8");
  return { open, env: { ...fork.env, SYMPHYSIS_E2E_FORK: dir, SYMPHYSIS_E2E_FIRST: first, SYMPHYSIS_E2E_SECOND: second, SYMPHYSIS_E2E_THIRD: third } };
}

/** `name` — имя запуска и сценария, `prepare` — что открыть и что передать сценарию. Запуски идут по порядку, каталог проекта между ними общий. */
const RUNS = [
  { name: "«Выключение в одном проекте»", prepare: twoFolders },
  { name: "«Первая активация ставит запись»", prepare: () => ({ open: again, env: { SYMPHYSIS_E2E_ON: again } }) },
  {
    name: "«Запись удалена руками»",
    prepare: () => {
      // Файла нет, только если упал прошлый запуск: тогда этот покажет своё, а не оборвёт прогон.
      const settings = path.join(again, ".claude", "settings.local.json");
      if (fs.existsSync(settings)) fs.unlinkSync(settings);
      return { open: again, env: { SYMPHYSIS_E2E_ON: again } };
    },
  },
  { name: "«Проект без журнала»", prepare: withoutJournal },
  { name: "«Пустой проект, боковая панель»", prepare: emptyFolder },
  { name: "«Команда палитры»", prepare: noChanges },
  { name: "папки меняются при открытой справке: расчёт в момент добавления не оставляет вкладку на «Считается…», новая папка появляется, ушедшая исчезает", prepare: changingFolders },
];

cleanEnv();

const results = path.join(repo, "out", "e2e", "activation-results.json");
let code = 0;
for (const [i, run] of RUNS.entries()) {
  const { open, env } = run.prepare();
  fs.rmSync(results, { force: true });
  console.log(`--- запуск: ${run.name}`);
  try {
    await runTests({
      vscodeExecutablePath: CODE,
      extensionDevelopmentPath: repo,
      extensionTestsPath: path.join(repo, "out", "e2e", "activation-scenario.js"),
      extensionTestsEnv: { SYMPHYSIS_E2E_RESULTS: results, SYMPHYSIS_E2E_RUN: run.name, ...env },
      launchArgs: [open, "--disable-extensions", "--user-data-dir", path.join(work, `profile-${i}`), "--extensions-dir", path.join(work, `extensions-${i}`), "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust"],
    });
  } catch (e) {
    console.error(String(e));
    code = 1;
  }
  if (report(results)) code = 1;
}
finish(work, code);
