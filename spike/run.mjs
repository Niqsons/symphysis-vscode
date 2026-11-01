// Запуск сценария в настоящем VS Code с отдельным профилем: проект с кириллицей и пробелами в пути,
// данные — копия журнала calibration-fixes. Окружение чистится: из терминала VS Code наследуется
// ELECTRON_RUN_AS_NODE, с ним Code.exe запустился бы как голый node.
import { runTests } from "@vscode/test-electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = process.env.SPIKE_WORK;
if (!work) throw new Error("нужен SPIKE_WORK — каталог для профиля и проекта");
const SYMPHYSIS = process.env.SPIKE_SYMPHYSIS ?? "X:\\symphysis";
const CODE = path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe");

const top = path.join(work, "симфизис проба");
fs.rmSync(top, { recursive: true, force: true });
const project = path.join(top, "проект с пробелами");
const tools = path.join(project, ".symphysis", "tools");
fs.mkdirSync(tools, { recursive: true });
for (const f of fs.readdirSync(path.join(SYMPHYSIS, "tools"))) {
  if (/^(journal.*\.(py|json)|playground-template\.html)$/.test(f)) fs.copyFileSync(path.join(SYMPHYSIS, "tools", f), path.join(tools, f));
}
fs.mkdirSync(path.join(project, ".symphysis", "docs"), { recursive: true });
fs.copyFileSync(path.join(SYMPHYSIS, "docs", "journal.schema.json"), path.join(project, ".symphysis", "docs", "journal.schema.json"));
const source = path.join(SYMPHYSIS, "openspec", "changes", "calibration-fixes");
const change = path.join(project, "openspec", "changes", "изменение-один");
fs.mkdirSync(path.join(change, "attack"), { recursive: true });
fs.copyFileSync(path.join(source, "decisions.json"), path.join(change, "decisions.json"));
fs.copyFileSync(path.join(source, "attack", "decisions.md"), path.join(change, "attack", "decisions.md"));

// NoDefaultCurrentDirectoryInExePath ставит среда агента; у обычного пользователя её нет, а она меняет поиск .exe.
for (const k of Object.keys(process.env)) if (/^(VSCODE_|ELECTRON_|NoDefaultCurrentDirectoryInExePath$)/i.test(k)) delete process.env[k];

const mode = process.argv[2] ?? "iife";
const resultName = process.argv[3] ?? `result-${mode}`;
const profile = path.join(work, `profile-${resultName}`);
fs.rmSync(profile, { recursive: true, force: true });
const resultsDir = path.join(here, "results");
fs.mkdirSync(resultsDir, { recursive: true });
await runTests({
  vscodeExecutablePath: CODE,
  extensionDevelopmentPath: here,
  extensionTestsPath: path.join(here, "out", "scenario.js"),
  extensionTestsEnv: { SPIKE_RESULTS: path.join(resultsDir, `${resultName}.json`), SPIKE_SYMPHYSIS: SYMPHYSIS, SPIKE_WORK_ASCII: work,
    SPIKE_SCHEME: mode, SPIKE_SKIP: process.env.SPIKE_SKIP ?? "" },
  launchArgs: [project, "--disable-extensions", "--user-data-dir", profile,
    "--extensions-dir", path.join(work, "extensions"), "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust"],
});
