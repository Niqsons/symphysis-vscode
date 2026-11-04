// Расчёт справки о шаге: `step_help.py`. Не через `viewJson`: код 1 здесь несёт JSON (F-53). Не через `JournalStore`: при сбое показывается сам отказ, а не прежний вывод (F-84).
// Без `vscode`: окружение и получатель ответа приходят параметрами, связь с окном живёт не здесь.
import fs from "node:fs";
import path from "node:path";
import type { HelpFailure } from "../shared/protocol";
import type { StepHelpOutput } from "../shared/types";
import { contractFailure, type CoreEnv } from "./core";
import { runPython } from "./python";

/** Что считать: папка проекта и изменение; `change: null` — вызов без `--change`, одно активное ядро возьмёт само (F-41). */
export interface HelpTarget { root: string; change: string | null }
export type HelpResult = { ok: true; output: StepHelpOutput } | { ok: false; failure: HelpFailure };

const isDir = (p: string) => !!fs.statSync(p, { throwIfNoEntry: false })?.isDirectory();
const quoted = (arg: string) => (/\s/.test(arg) ? `"${arg}"` : arg);

/** Что запустить в папке проекта, чтобы увидеть то же своими глазами. Инструменты вне проекта называются полным путём: относительный ничего не скажет. */
function terminalCommand(env: CoreEnv, script: string, args: string[]): string {
  return ["python", env.installDir ? script : path.relative(env.cwd, script), ...args].map(quoted).join(" ");
}

export async function stepHelp(env: CoreEnv, change: string | null, opts: { timeoutMs?: number } = {}): Promise<HelpResult> {
  // Настройка на всю машину: скрипт взял бы корнем родителя с `openspec/` и показал бы чужой проект (F-96).
  if (env.installDir && !isDir(path.join(env.cwd, "openspec"))) return { ok: false, failure: { kind: "no-openspec", root: env.cwd } };
  const script = path.join(env.tools, "step_help.py");
  // `--install-dir` только при настройке: старое ядро его не знает и выходит с кодом 2.
  const args = [...(change === null ? [] : ["--change", change]), ...(env.installDir ? ["--install-dir", env.installDir] : [])];
  const r = await runPython(env.python, [script, ...args], env.cwd, opts);
  if (r.timedOut) return { ok: false, failure: { kind: "timeout" } };
  const unreadable: HelpResult = { ok: false, failure: { kind: "unreadable", command: terminalCommand(env, script, args) } };
  if (r.code !== 0 && r.code !== 1) return unreadable;
  let output: unknown;
  try {
    output = JSON.parse(r.stdout);
  } catch {
    return unreadable;
  }
  if (typeof output !== "object" || output === null || Array.isArray(output)) return unreadable;
  const mismatch = contractFailure((output as { contract?: unknown }).contract, env);
  return mismatch ? { ok: false, failure: mismatch } : { ok: true, output: output as StepHelpOutput };
}

const sameTarget = (a: HelpTarget, b: HelpTarget | null) => !!b && a.root === b.root && a.change === b.change;

export interface StepHelpDeps {
  compute(target: HelpTarget): Promise<HelpResult>;
  onResult(target: HelpTarget, result: HelpResult): void;
}

/**
 * Одна цель за раз и один следующий расчёт: просьбы на его время склеиваются, последняя задаёт цель (F-25, F-41, F-42).
 * Ответ для цели, которую уже сменили, отбрасывается. `request` не ждёт и не бросает: работа начинается после возврата, показ расчёта не ждёт (F-53).
 */
export class StepHelpRunner {
  private wanted: HelpTarget | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private readonly deps: StepHelpDeps) {}

  request(target: HelpTarget): void {
    this.wanted = target;
    if (this.running) this.again = true;
    else this.running = this.drain();
  }

  /** Для тестов: конец всех расчётов, и начатых за время ожидания тоже. */
  async whenIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    do {
      this.again = false;
      const target = this.wanted!;
      const result = await this.once(target);
      if (sameTarget(target, this.wanted)) {
        try {
          this.deps.onResult(target, result);
        } catch { /* получатель не принял ответ: следующий расчёт важнее */ }
      }
    } while (this.again);
    this.running = null;
  }

  private async once(target: HelpTarget): Promise<HelpResult> {
    try {
      return await this.deps.compute(target);
    } catch (e) {
      return { ok: false, failure: { kind: "crash", text: String(e) } };
    }
  }
}
