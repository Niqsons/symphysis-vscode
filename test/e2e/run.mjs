// Запуск сквозного сценария в настоящем VS Code с чистым профилем. Окружение чистится: из терминала VS Code наследуется
// ELECTRON_RUN_AS_NODE, а среда агента ставит NoDefaultCurrentDirectoryInExePath и PYTHONIOENCODING — у пользователя их нет.
import { runTests } from "@vscode/test-electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CODE = process.env.SYMPHYSIS_CODE ?? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe");
const SYMPHYSIS = process.env.SYMPHYSIS_ROOT ?? path.resolve(repo, "..", "symphysis");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "symphysis-e2e-"));

const project = path.join(work, "проект с пробелами");
const tools = path.join(project, ".symphysis", "tools");
fs.mkdirSync(tools, { recursive: true });
for (const f of fs.readdirSync(path.join(SYMPHYSIS, "tools"))) {
  if (/^(journal.*\.(py|json)|playground-template\.html)$/.test(f)) fs.copyFileSync(path.join(SYMPHYSIS, "tools", f), path.join(tools, f));
}
fs.writeFileSync(path.join(tools, "journal-roots.json"), '{"": "<root>/.."}\n', "utf8");
fs.mkdirSync(path.join(project, ".symphysis", "docs"), { recursive: true });
fs.copyFileSync(path.join(SYMPHYSIS, "docs", "journal.schema.json"), path.join(project, ".symphysis", "docs", "journal.schema.json"));
fs.writeFileSync(path.join(project, "intent.md"), "Надо показать журнал человеку.\n", "utf8");
// Проект недоверенного происхождения: подложенный python.exe в корне и настройка проекта, указывающая на него.
fs.writeFileSync(path.join(project, "python.exe"), "не исполняемый файл", "utf8");
fs.mkdirSync(path.join(project, ".vscode"), { recursive: true });
fs.writeFileSync(path.join(project, ".vscode", "settings.json"), JSON.stringify({ "symphysis.python": path.join(project, "python.exe") }), "utf8");

const fixtures = path.join(repo, "test", "fixtures");
const change = (name) => {
  const dir = path.join(project, "openspec", "changes", name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(change("изменение-один"), "decisions.json"));
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(change("изменение-два"), "decisions.json"));
change("без-журнала");
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

for (const k of Object.keys(process.env)) {
  if (/^(VSCODE_|ELECTRON_|NoDefaultCurrentDirectoryInExePath$|PYTHONIOENCODING$)/i.test(k)) delete process.env[k];
}

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
      SYMPHYSIS_E2E_THEME: process.env.SYMPHYSIS_E2E_THEME ?? "", SYMPHYSIS_E2E_SHOW: process.env.SYMPHYSIS_E2E_SHOW ?? "",
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
if (fs.existsSync(results)) {
  const r = JSON.parse(fs.readFileSync(results, "utf8"));
  for (const t of r.tests) console.log(`${t.ok ? "✔" : "✖"} ${t.name}${t.ms !== undefined ? ` (${t.ms} мс)` : ""}${t.error ? `\n   ${t.error}` : ""}`);
  console.log(JSON.stringify(r.measures, null, 1));
  console.log(`итого ${r.tests.length}, упало ${r.tests.filter((t) => !t.ok).length}`);
  if (r.tests.some((t) => !t.ok)) code = 1;
} else {
  console.error("нет файла результатов");
  code = 1;
}
console.log(`каталог прогона: ${work}`);
process.exit(code);
