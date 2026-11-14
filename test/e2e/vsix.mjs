// Проверка того, что получит человек: сборка .vsix, настоящая установка в чистый профиль, запуск в обычном режиме расширения.
import { runTests } from "@vscode/test-electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tempDir } from "../temp-dir.mjs";
import { addChange, cleanEnv, CODE, finish, fixtures, projectWithTools, repo, report, SYMPHYSIS } from "./harness.mjs";
import { pack } from "../../package.mjs";
import { checkE2ePaths } from "./paths.mjs";

checkE2ePaths(repo, "e2e:vsix");
cleanEnv();
const manifest = path.join(repo, "package.json");
const manifestBefore = fs.readFileSync(manifest);
const quiet = process.argv.includes("--quiet");

const fail = (what, r) => {
  console.error(`${what}: код ${r.status}\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  process.exit(1);
};

const packed = spawnSync(process.execPath, [path.join(repo, "package.mjs")], { cwd: repo, encoding: "utf8" });
if (packed.status !== 0) fail("упаковка", packed);
if (!quiet) console.log(packed.stdout.split("\n").filter((l) => /WARNING|DONE|ERROR/i.test(l)).join("\n"));
const vsix = /^PACKED=(.+)$/m.exec(packed.stdout)?.[1]?.trim();
if (!vsix) fail("упаковка не назвала файл", packed);
const version = /-(\d+\.\d+\.\d+\+[0-9a-f]+(?:\.dirty)?)\.vsix$/.exec(vsix)?.[1];
if (!version) fail(`имя пакета без версии и хеша: ${vsix}`, packed);
if (!fs.readFileSync(manifest).equals(manifestBefore)) fail("упаковка изменила package.json", packed);

const work = tempDir("symphysis-vsix-");
const project = path.join(work, "проект с пробелами");
const profile = path.join(work, "profile");
const extensions = path.join(work, "extensions");
projectWithTools(project);
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(addChange(project, "изменение-один"), "decisions.json"));
const attacked = addChange(project, "с-атакой");
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(attacked, "decisions.json"));
fs.mkdirSync(path.join(attacked, "attack"));
fs.copyFileSync(path.join(fixtures, "attack-rich.md"), path.join(attacked, "attack", "decisions.md"));

const cli = path.join(path.dirname(CODE), "bin", process.platform === "win32" ? "code.cmd" : "code");
const dirs = `--extensions-dir "${extensions}" --user-data-dir "${profile}"`;
// Прежняя сборка с большим хешем: новая обязана встать поверх без --force, иначе человек останется на старой при коде 0 (F-123).
const older = path.join(work, "older.vsix");
const olderPacked = pack(`${version.split("+")[0]}+zzzzzzz`, older);
if (olderPacked.status !== 0) fail("упаковка прежней сборки", olderPacked);
const first = spawnSync(`"${cli}" --install-extension "${older}" ${dirs}`, { shell: true, encoding: "utf8" });
if (first.status !== 0) fail("установка прежней сборки", first);
const installed = spawnSync(`"${cli}" --install-extension "${vsix}" ${dirs}`, { shell: true, encoding: "utf8" });
if (installed.status !== 0) fail("установка", installed);
const listed = spawnSync(`"${cli}" --list-extensions --show-versions ${dirs}`, { shell: true, encoding: "utf8" });
if (!listed.stdout.includes(`@${version}`)) fail(`поверх прежней сборки не встала ${version}`, listed);

const results = path.join(repo, "out", "e2e", "vsix-results.json");
fs.rmSync(results, { force: true });
let code = 0;
try {
  await runTests({
    vscodeExecutablePath: CODE,
    extensionDevelopmentPath: path.join(repo, "test", "e2e", "vsix-host"),
    extensionTestsPath: path.join(repo, "out", "e2e", "vsix-scenario.js"),
    extensionTestsEnv: { SYMPHYSIS_E2E_RESULTS: results, SYMPHYSIS_E2E_EXTENSIONS: extensions, SYMPHYSIS_E2E_VERSION: version, SYMPHYSIS_E2E_PAUSE_MS: process.env.SYMPHYSIS_E2E_PAUSE_MS ?? "" },
    launchArgs: [project, "--user-data-dir", profile, "--extensions-dir", extensions, "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust"],
  });
} catch (e) {
  console.error(String(e));
  code = 1;
}
if (report(results)) code = 1;

// Ошибка активации и падение хоста шаг может не поймать: журнал хоста читается отдельно.
const logs = (fs.readdirSync(path.join(profile, "logs"), { recursive: true })).filter((f) => f.endsWith("exthost.log")).map((f) => path.join(profile, "logs", f));
const errors = logs.flatMap((f) => fs.readFileSync(f, "utf8").split("\n")).filter((l) => /symphysis\.symphysis-vscode/.test(l) && /\[error\]|failed/i.test(l));
const coreGit = (...args) => spawnSync("git", ["-C", SYMPHYSIS, ...args], { encoding: "utf8" }).stdout?.trim() || "не git";
console.log(`ядро: ${SYMPHYSIS}, ветка ${coreGit("rev-parse", "--abbrev-ref", "HEAD")}, коммит ${coreGit("rev-parse", "--short", "HEAD")}`);
console.log(`журналов хоста: ${logs.length}, ошибок расширения: ${errors.length}`);
for (const l of errors) console.log(`   ${l}`);
if (!logs.length || errors.length) code = 1;

console.log(`пакет: ${vsix}, ${Math.round(fs.statSync(vsix).size / 1024)} КБ`);
finish(work, code);
