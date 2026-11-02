// Настоящая перезагрузка окна (F-125). В тестовом хосте с командной строки она завершает весь прогон с кодом 1,
// поэтому здесь обычное окно разработки, а этапы ведёт расширение reload-host. Страницу отсюда не видно: её держит `npm run e2e`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addChange, cleanEnv, CODE, fixtures, projectWithTools, repo, report } from "./harness.mjs";

const STAGE_LIMIT_MS = 60000;

const work = fs.mkdtempSync(path.join(os.tmpdir(), "symphysis-reload-"));
const project = path.join(work, "проект с пробелами");
projectWithTools(project);
const change = addChange(project, "со-схемой");
fs.copyFileSync(path.join(fixtures, "decisions.json"), path.join(change, "decisions.json"));
fs.writeFileSync(path.join(change, "scheme.md"), "```mermaid\nflowchart TD\n  A --> B\n```\n", "utf8");

const results = path.join(repo, "out", "e2e", "reload-results.json");
const state = path.join(work, "state.json");
fs.rmSync(results, { force: true });
fs.writeFileSync(path.join(project, "reload-probe.json"), JSON.stringify({ results, state }), "utf8");

cleanEnv();
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
console.log(`каталог прогона: ${work}`);
process.exit(code);
