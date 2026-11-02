// Запуск сквозного сценария в настоящем VS Code с чистым профилем и чистым окружением.
import { runTests } from "@vscode/test-electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addChange, cleanEnv, CODE, fixtures, projectWithTools, repo, report, SYMPHYSIS } from "./harness.mjs";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "symphysis-e2e-"));

const project = path.join(work, "проект с пробелами");
projectWithTools(project);
// Проект недоверенного происхождения: подложенный python.exe в корне и настройка проекта, указывающая на него.
fs.writeFileSync(path.join(project, "python.exe"), "не исполняемый файл", "utf8");
fs.mkdirSync(path.join(project, ".vscode"), { recursive: true });
fs.writeFileSync(path.join(project, ".vscode", "settings.json"), JSON.stringify({ "symphysis.python": path.join(project, "python.exe") }), "utf8");

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
const big = path.join(SYMPHYSIS, "openspec", "changes", "calibration-fixes");
if (fs.existsSync(path.join(big, "decisions.json"))) {
  const dir = change("большой-журнал");
  fs.copyFileSync(path.join(big, "decisions.json"), path.join(dir, "decisions.json"));
  if (fs.existsSync(path.join(big, "attack"))) {
    fs.mkdirSync(path.join(dir, "attack"));
    for (const f of fs.readdirSync(path.join(big, "attack"))) fs.copyFileSync(path.join(big, "attack", f), path.join(dir, "attack", f));
  }
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
      SYMPHYSIS_E2E_RESULTS: results, SYMPHYSIS_E2E_PAUSE_MS: process.env.SYMPHYSIS_E2E_PAUSE_MS ?? "",
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
console.log(`каталог прогона: ${work}`);
process.exit(code);
