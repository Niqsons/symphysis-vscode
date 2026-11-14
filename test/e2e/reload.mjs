// Настоящая перезагрузка окна (F-125). В тестовом хосте с командной строки она завершает весь прогон с кодом 1,
// поэтому здесь обычное окно разработки, а этапы ведёт расширение reload-host. Страницу отсюда не видно: её держит `npm run e2e`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FORK_APPLY, forkScenario, forkStatus, forkStatusAll, installForkShim } from "../fork-shim.mjs";
import { tempDir } from "../temp-dir.mjs";
import { addChange, cleanEnv, CODE, finish, fixtures, projectWithTools, repo, report, SYMPHYSIS } from "./harness.mjs";
import { checkE2ePaths } from "./paths.mjs";

checkE2ePaths(repo, "e2e:reload");

const STAGE_LIMIT_MS = 60000;

const work = tempDir("symphysis-reload-");
const project = path.join(work, "проект с пробелами");
projectWithTools(project);
const change = addChange(project, "со-схемой");
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(change, "decisions.json"));
fs.writeFileSync(path.join(change, "scheme.md"), "```mermaid\nflowchart TD\n  A --> B\n```\n", "utf8");
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(addChange(project, "другое"), "decisions.json"));

const results = path.join(repo, "out", "e2e", "reload-results.json");
const state = path.join(work, "state.json");
fs.rmSync(results, { force: true });

// Форк шимом: `step_help.py` настоящий, а форка в этой среде может не быть. Ответы меняет этап вместе с каталогами изменений.
const forkDir = path.join(work, "шим форка");
const active = (...names) => ({ status_all: forkStatusAll(...names), status: forkStatus(project, names[0] ?? "нет"), apply: FORK_APPLY });
const fork = installForkShim(SYMPHYSIS, forkDir, active("со-схемой", "другое"));
const scenarios = { "другое": forkScenario(active("другое")), "пусто": forkScenario(active()) };
fs.writeFileSync(path.join(project, "reload-probe.json"), JSON.stringify({ results, state, fork: forkDir, scenarios }), "utf8");

cleanEnv();
Object.assign(process.env, fork.env);
const launch = () => spawn(CODE, [project, `--extensionDevelopmentPath=${repo}`, `--extensionDevelopmentPath=${path.join(repo, "test", "e2e", "reload-host")}`, "--disable-extensions",
  "--user-data-dir", path.join(work, "profile"), "--extensions-dir", path.join(work, "extensions"), "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust"], { stdio: "ignore" });
const phase = () => (fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, "utf8")) : { stage: 0 });

/** Ждёт конца окна: этап назвал `relaunch` или `done`. Этап, завершившийся перезагрузкой, окно не закрывает. */
async function windowEnd(child) {
  let stage = phase().stage;
  let since = Date.now();
  while (Date.now() - since < STAGE_LIMIT_MS) {
    const now = phase();
    if (now.phase === "relaunch" || now.phase === "done") {
      await new Promise((r) => { child.once("exit", r); setTimeout(r, 15000); });
      return now.phase;
    }
    if (now.stage !== stage) { stage = now.stage; since = Date.now(); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return "завис";
}

let code = 0;
let child = launch();
let end = await windowEnd(child);
if (end === "relaunch") {
  fs.writeFileSync(state, JSON.stringify({ stage: phase().stage }), "utf8");
  await new Promise((r) => setTimeout(r, 1500));
  child = launch();
  end = await windowEnd(child);
}
try { child.kill(); } catch {}
if (end !== "done") {
  console.error(`окно не дошло до конца этапов: ${end}, этап ${phase().stage}`);
  code = 1;
}
if (report(results)) code = 1;
finish(work, code);
