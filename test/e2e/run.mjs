// Запуск сквозного сценария в настоящем VS Code с чистым профилем и чистым окружением.
import { runTests } from "@vscode/test-electron";
import fs from "node:fs";
import path from "node:path";
import { bigJournal } from "../core-journals.mjs";
import { tempDir } from "../temp-dir.mjs";
import { addChange, cleanEnv, CODE, finish, fixtures, projectWithTools, repo, report, SYMPHYSIS } from "./harness.mjs";

const work = tempDir("symphysis-e2e-");

const project = path.join(work, "проект с пробелами");
projectWithTools(project);
// Проект недоверенного происхождения: подложенный python.exe в корне и настройка проекта, указывающая на него.
fs.writeFileSync(path.join(project, "python.exe"), "не исполняемый файл", "utf8");
fs.mkdirSync(path.join(project, ".vscode"), { recursive: true });
// Настоящая установка вне проекта: настройка проекта на неё указывает и действовать не должна (`security.md`), настройка машины действует.
const install = path.join(work, "установка с пробелами");
projectWithTools(install);
// Хук в этом проекте выключен, а старая запись на месте: первая активация обязана её снять, шаги хука в конце сценария его включают.
fs.writeFileSync(path.join(project, ".vscode", "settings.json"), JSON.stringify({ "symphysis.python": path.join(project, "python.exe"), "symphysis.toolsPath": install, "symphysis.hook.enabled": false }), "utf8");
fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
fs.writeFileSync(path.join(project, ".claude", "settings.local.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: path.join(project, "старый", "python.exe"), args: ["${CLAUDE_PROJECT_DIR}/.symphysis/viewer/hook.py"], timeout: 5 }] }] } }), "utf8");

const change = (name) => addChange(project, name);
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(change("изменение-один"), "decisions.json"));
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(change("изменение-два"), "decisions.json"));
change("без-журнала");
const schemeJournal = JSON.parse(fs.readFileSync(path.join(fixtures, "decisions.json"), "utf8"));
const nodesOf = { "F-02": ["A"], "F-03": ["B", "узел1"], "F-04": ["Узел1"] };
for (const rec of schemeJournal.records) if (nodesOf[rec.id]) rec.nodes = nodesOf[rec.id];
const withScheme = change("со-схемой");
fs.writeFileSync(path.join(withScheme, "decisions.json"), JSON.stringify(schemeJournal, null, 1), "utf8");
fs.writeFileSync(path.join(withScheme, "scheme.md"), "# Схема\n\n```mermaid\nflowchart TD\n  A[начало] --> B[дальше]\n  B --> узел1[кириллица]\n  B --> C[конец]\n  B --> D[конец]\n```\n", "utf8");
const noNodes = change("схема-без-узлов");
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(noNodes, "decisions.json"));
fs.writeFileSync(path.join(noNodes, "scheme.md"), "```mermaid\nflowchart TD\n  P --> Q\n```\n", "utf8");
const wide = change("широкая-схема");
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(wide, "decisions.json"));
fs.copyFileSync(path.join(SYMPHYSIS, "tests", "fixtures", "scheme", "wide.md"), path.join(wide, "scheme.md"));
change("archive");
const withAttack = change("с-атакой");
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(withAttack, "decisions.json"));
fs.mkdirSync(path.join(withAttack, "attack"));
fs.copyFileSync(path.join(fixtures, "attack-rich.md"), path.join(withAttack, "attack", "decisions.md"));
fs.writeFileSync(path.join(withAttack, "attack", "artifacts.md"), "не файл атаки\n", "utf8");
// Журнал со ссылками: файлы лежат в проекте, ядро кладёт их в карту; PNG открывается не как текст, `constructor` ссылкой не становится.
fs.mkdirSync(path.join(project, "ссылки"), { recursive: true });
fs.writeFileSync(path.join(project, "ссылки", "a.md"), "первая строка\nвторая строка\nтретья строка\n", "utf8");
fs.writeFileSync(path.join(project, "ссылки", "b.md"), "файл б\n", "utf8");
fs.writeFileSync(path.join(project, "ссылки", "лого.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));
const withLinks = change("со-ссылками");
const linksJournal = JSON.parse(fs.readFileSync(path.join(fixtures, "decisions.json"), "utf8"));
const rec = (id) => linksJournal.records.find((r) => r.id === id);
rec("F-01").question += " Смотри `ссылки/a.md:2`.";
rec("F-02").options[0].text += " Файл `ссылки/b.md` и `constructor`.";
rec("F-03").options[0].text += " Картинка `ссылки/лого.png`.";
fs.writeFileSync(path.join(withLinks, "decisions.json"), JSON.stringify(linksJournal, null, 1), "utf8");
const big = bigJournal(SYMPHYSIS).dir;
const bigCopy = change("большой-журнал");
fs.copyFileSync(path.join(big, "decisions.json"), path.join(bigCopy, "decisions.json"));
if (fs.existsSync(path.join(big, "attack"))) {
  fs.mkdirSync(path.join(bigCopy, "attack"));
  for (const f of fs.readdirSync(path.join(big, "attack"))) fs.copyFileSync(path.join(big, "attack", f), path.join(bigCopy, "attack", f));
}

cleanEnv();

const results = path.join(repo, "out", "e2e", "results.json");
fs.rmSync(results, { force: true });
let code = 0;
try {
  await runTests({
    vscodeExecutablePath: CODE,
    extensionDevelopmentPath: repo,
    extensionTestsPath: path.join(repo, "out", "e2e", "scenario.js"),
    extensionTestsEnv: {
      SYMPHYSIS_E2E_RESULTS: results, SYMPHYSIS_E2E_INSTALL: install, SYMPHYSIS_E2E_PAUSE_MS: process.env.SYMPHYSIS_E2E_PAUSE_MS ?? "",
      SYMPHYSIS_E2E_THEME: process.env.SYMPHYSIS_E2E_THEME ?? "", SYMPHYSIS_E2E_SHOW: process.env.SYMPHYSIS_E2E_SHOW ?? "", SYMPHYSIS_E2E_NODE: process.env.SYMPHYSIS_E2E_NODE ?? "",
      SYMPHYSIS_E2E_STRETCH: process.env.SYMPHYSIS_E2E_STRETCH ?? "", SYMPHYSIS_E2E_MODE: process.env.SYMPHYSIS_E2E_MODE ?? "",
      SYMPHYSIS_E2E_LENS: process.env.SYMPHYSIS_E2E_LENS ?? "", SYMPHYSIS_E2E_FILTER: process.env.SYMPHYSIS_E2E_FILTER ?? "",
      SYMPHYSIS_E2E_SEARCH: process.env.SYMPHYSIS_E2E_SEARCH ?? "", SYMPHYSIS_E2E_FIND: process.env.SYMPHYSIS_E2E_FIND ?? "",
    },
    launchArgs: [project, "--disable-extensions", "--user-data-dir", path.join(work, "profile"), "--extensions-dir", path.join(work, "extensions"),
      "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust"],
  });
} catch (e) {
  console.error(String(e));
  code = 1;
}
if (report(results)) code = 1;
finish(work, code);
