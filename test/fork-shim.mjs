// Шим форка для тестов справки: файлы шима из ядра (`tests/fixtures/fork-shim/`, на Windows `.cmd`), ответы в `scenario.json` рядом с ним, вызовы в `calls.jsonl`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const NAME = process.platform === "win32" ? "openspec.cmd" : "openspec";

export const python = spawnSync("python", ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).stdout.trim();

export const VERSION_OK = { stdout: "1.15.0-symphysis.4\n" };

/** `status --change <имя> --json` в форме форка: `intent` в состоянии `state`, затем `decisions`. */
export function forkStatus(project, change, state = "ready") {
  const entry = (id, status, requires) => ({ id, outputPath: `${id}.md`, status, requires });
  const paths = (id, exists) => {
    const file = path.join(project, "openspec", "changes", change, `${id}.md`);
    return { outputPath: `${id}.md`, resolvedOutputPath: file, existingOutputPaths: exists ? [file] : [] };
  };
  return {
    stdout: JSON.stringify({
      changeName: change, schemaName: "symphysis", planningHome: { root: project }, applyRequires: [],
      artifacts: [entry("intent", state, []), entry("decisions", state === "done" ? "ready" : "blocked", ["intent"])],
      artifactPaths: { intent: paths("intent", state === "done"), decisions: paths("decisions", false) },
    }),
  };
}

export const FORK_APPLY = { stdout: JSON.stringify({ state: "blocked", missingArtifacts: [], progress: { total: 0, complete: 0, remaining: 0 } }) };

/** `status --all --json`: у каждого изменения своя запись; нет изменений — форма форка с `message`. */
export const forkStatusAll = (...names) => ({
  stdout: JSON.stringify(names.length ? { changes: names.map((changeName) => ({ changeName, artifacts: [] })) } : { changes: [], message: "No active changes." }),
});

/** Текст `scenario.json`. Ключи ответов как у `reply_key` шима: `version`, `status`, `apply`, `status_all`. */
export const forkScenario = (replies) => JSON.stringify({ version: VERSION_OK, ...replies });

export function installForkShim(coreRoot, dir, replies) {
  const source = path.join(coreRoot, "tests", "fixtures", "fork-shim");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(source, "fork_shim.py"), path.join(dir, "fork_shim.py"));
  const file = path.join(dir, NAME);
  fs.copyFileSync(path.join(source, NAME), file);
  const answer = (next) => fs.writeFileSync(path.join(dir, "scenario.json"), forkScenario(next), "utf8");
  answer(replies);
  return {
    file,
    /** Окружение вызова: процессы плагина наследуют его от хоста. */
    env: { SYMPHYSIS_OPENSPEC: file, FORK_SHIM_PYTHON: python },
    /** Новые ответы: следующий вызов читает файл заново. */
    answer,
    calls() {
      const log = path.join(dir, "calls.jsonl");
      if (!fs.existsSync(log)) return [];
      return fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    },
  };
}
