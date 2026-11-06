// Граница с ядром: `journal.py view-json`, `apply`, `check`, `render-md`, `render-html`. Других писателей журнала нет.
import path from "node:path";
import type { CoreFailure } from "../protocol/protocol";
import type { ViewPayload } from "../protocol/types";
import type { ChangeRef } from "./project";
import { runPython, type RunResult } from "./python";

/** Номер контракта, на который рассчитан этот плагин (`docs/repo-contract.md` ядра). */
export const EXPECTED_CONTRACT = 3;

export type ViewResult = { ok: true; payload: ViewPayload } | { ok: false; failure: CoreFailure };
/** `installDir` — настройка `symphysis.toolsPath`, если инструменты нашлись по ней; `cwd` и тогда папка проекта. */
export interface CoreEnv { python: string; tools: string; cwd: string; installDir?: string }
export interface Report { ok: boolean; report: string[] }

const rel = (env: CoreEnv, file: string) => path.relative(env.cwd, file);
const journalPy = (env: CoreEnv) => path.join(env.tools, "journal.py");
const reportLines = (r: RunResult) => [...r.stdout.split(/\r?\n/), ...r.stderr.split(/\r?\n/)].filter((l) => l.trim());
const attackArgs = (env: CoreEnv, ref: ChangeRef) => ref.attacks.flatMap((f) => ["--attack", rel(env, f)]);

function failed(r: RunResult): string[] {
  if (r.timedOut) return ["[!!] Python не ответил за отведённое время"];
  if (r.overflow) return ["[!!] Python выдал больше, чем помещается в предел вывода"];
  return [];
}

/** Сверка номера одна на `view-json` и `step_help.py`: число у них одно. Просьба называет, где инструменты: при настройке это не проект. */
export function contractFailure(contract: unknown, env: CoreEnv): CoreFailure | null {
  if (contract === EXPECTED_CONTRACT) return null;
  const newer = typeof contract === "number" && Number.isInteger(contract) && contract > EXPECTED_CONTRACT;
  return { kind: "contract", need: newer ? "vsix" : "tools", root: env.installDir ?? env.cwd };
}

export async function viewJson(env: CoreEnv, ref: ChangeRef): Promise<ViewResult> {
  if (!ref.hasJournal) return { ok: false, failure: { kind: "no-journal" } };
  const r = await runPython(env.python, [journalPy(env), "view-json", rel(env, ref.journal), ...attackArgs(env, ref)], env.cwd);
  if (r.timedOut) return { ok: false, failure: { kind: "timeout" } };
  if (r.code === 2 && r.stderr.includes("view-json")) return { ok: false, failure: { kind: "old-core", tools: env.tools } };
  if (r.code === 1) return { ok: false, failure: { kind: "invalid-journal", text: r.stderr.trim() } };
  if (r.code !== 0) return { ok: false, failure: { kind: "crash", text: r.stderr.trim() || `код ${r.code}` } };
  try {
    const payload = JSON.parse(r.stdout) as ViewPayload;
    // Новый вывод при расхождении не показывается: прежние данные держит хранилище, «Внести» закрыта отказом.
    const mismatch = contractFailure(payload.contract, env);
    if (mismatch) return { ok: false, failure: mismatch };
    // Ядро номера 2 отдаёт путь от корня с `/`; замена оставлена страховкой: путь входит в ключ спора и в текст промпта.
    payload.attacks = payload.attacks.map((a) => ({ ...a, path: a.path.replaceAll("\\", "/") }));
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, failure: { kind: "crash", text: `вывод view-json не разобран: ${e}` } };
  }
}

export async function applyAnswers(env: CoreEnv, ref: ChangeRef, answers: string, dryRun = false): Promise<Report> {
  const r = await runPython(env.python, [journalPy(env), "apply", rel(env, ref.journal), rel(env, answers), ...(dryRun ? ["--dry-run"] : [])], env.cwd);
  return { ok: r.code === 0, report: [...reportLines(r), ...failed(r)] };
}

/** `check`, `render-md`, `render-html` — порядок скилла. Негодный журнал останавливает, битый файл атаки — только страницу. */
export async function rebuild(env: CoreEnv, ref: ChangeRef): Promise<Report> {
  const journal = rel(env, ref.journal);
  const py = journalPy(env);
  const report: string[] = [];
  const step = async (args: string[]) => {
    const r = await runPython(env.python, [py, ...args], env.cwd);
    report.push(...reportLines(r), ...failed(r));
    return r.code === 0;
  };
  if (!(await step(["check", journal]))) return { ok: false, report };
  const md = await step(["render-md", journal, "--out", rel(env, path.join(ref.dir, "decisions.md"))]);
  const html = await step(["render-html", journal, "--out", rel(env, path.join(ref.dir, "symphysis.html")), ...attackArgs(env, ref)]);
  return { ok: md && html, report };
}
