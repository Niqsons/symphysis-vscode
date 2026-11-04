// Шим форка для тестов справки: файлы шима из ядра (`tests/fixtures/fork-shim/`, на Windows `.cmd`), ответы в `scenario.json` рядом с ним, вызовы в `calls.jsonl`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SYMPHYSIS } from "./fixture-project";

const SOURCE = path.join(SYMPHYSIS, "tests", "fixtures", "fork-shim");
const NAME = process.platform === "win32" ? "openspec.cmd" : "openspec";

export interface ForkReply { stdout?: string; stderr?: string; code?: number; hang?: number }
/** Ключи как у `reply_key` шима; `version`, `status`, `apply`, `status_all`. */
export type ForkReplies = Record<string, ForkReply>;
export interface ForkCall { argv: string[]; cwd: string; pid: number }

export const python = spawnSync("python", ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).stdout.trim();

export const VERSION_OK: ForkReply = { stdout: "1.15.0-symphysis.4\n" };

/** `status --change <имя> --json` в форме форка: один артефакт `intent` в состоянии `state`, затем `decisions`. */
export function forkStatus(project: string, change: string, state: "ready" | "done" = "ready"): ForkReply {
  const entry = (id: string, status: string, requires: string[]) => ({ id, outputPath: `${id}.md`, status, requires });
  const paths = (id: string, exists: boolean) => {
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

export const FORK_APPLY: ForkReply = { stdout: JSON.stringify({ state: "blocked", missingArtifacts: [], progress: { total: 0, complete: 0, remaining: 0 } }) };

export class ForkShim {
  readonly file: string;

  constructor(private readonly dir: string, replies: ForkReplies) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(SOURCE, "fork_shim.py"), path.join(dir, "fork_shim.py"));
    this.file = path.join(dir, NAME);
    fs.copyFileSync(path.join(SOURCE, NAME), this.file);
    this.answer(replies);
    // Python сам наследует окружение процесса теста: каждый файл тестов идёт в своём процессе.
    process.env.SYMPHYSIS_OPENSPEC = this.file;
    process.env.FORK_SHIM_PYTHON = python;
  }

  /** Новые ответы: следующий вызов читает файл заново. */
  answer(replies: ForkReplies): void {
    fs.writeFileSync(path.join(this.dir, "scenario.json"), JSON.stringify({ version: VERSION_OK, ...replies }), "utf8");
  }

  calls(): ForkCall[] {
    const file = path.join(this.dir, "calls.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as ForkCall);
  }
}
