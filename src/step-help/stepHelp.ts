// Расчёт справки о шаге: `step_help.py`. Не через `viewJson`: код 1 здесь несёт JSON (F-53). Не через `JournalStore`: при сбое показывается сам отказ, а не прежний вывод (F-84).
// Без `vscode`: окружение и получатель ответа приходят параметрами, связь с окном живёт не здесь.
import fs from "node:fs";
import path from "node:path";
import type { CoreFailure, HelpFailure, HelpOutcome } from "../protocol/protocol";
import type { StepHelpOutput } from "../protocol/types";
import { contractFailure, type CoreEnv } from "../core/core";
import { changeDir, type ChangeRef } from "../core/project";
import { runPython } from "../core/python";

/** Что считать: выбранное изменение или, если его нет, все папки без `--change` (F-41, F-83). */
export type HelpTarget = { root: string; change: string } | { roots: string[] };
export type HelpResult = { ok: true; output: StepHelpOutput } | { ok: false; failure: HelpFailure };

/** За просмотрщиком, затем последнее показанное, затем расчёт без `--change` (F-41). Изменения в `active` уже нет — как будто его не показывали: архивирование видно по пропаже каталога. */
export function chooseTarget(viewerKey: string | null, shownKey: string | null, roots: string[], active: ChangeRef[]): HelpTarget {
  const ref = active.find((r) => r.dir === viewerKey) ?? active.find((r) => r.dir === shownKey);
  return ref ? { root: ref.root, change: ref.name } : { roots };
}

async function ask(root: string, change: string | null, envOf: (root: string) => CoreEnv | CoreFailure): Promise<HelpResult & { root: string }> {
  const env = envOf(root);
  return { root, ...("kind" in env ? { ok: false, failure: env } : await stepHelp(env, change)) };
}

/**
 * Ответы папок без `--change` в один исход. Различает случаи только по полям `changes` и `change` (F-41): текст ядра может меняться.
 * Активных больше одного на всю рабочую область — список, папка названа при нескольких папках (F-83). Одно — ответ той папки: ядро его уже посчитало. Нет ни одного — начало конвейера.
 * Отказ папки без инструментов не прячет ответ соседней; отказ виден, только когда ответов нет совсем.
 */
function settle(answers: (HelpResult & { root: string })[]): HelpOutcome {
  const outputs = answers.flatMap((a) => (a.ok ? [{ root: a.root, output: a.output }] : []));
  const choices = outputs.flatMap(({ root, output }) => (output.changes ?? []).map((change) => ({
    key: changeDir(root, change), change, folder: answers.length > 1 ? path.basename(root) : null,
  })));
  if (choices.length > 1) return { kind: "choice", choices };
  // Папка с изменением, затем папка со сбоем (ядро при сбое `status --all` отдаёт `changes: null` и `error`), затем любая: сбой не прячется за чистой пустой папкой.
  const best = outputs.find((a) => a.output.changes?.length) ?? outputs.find((a) => a.output.error) ?? outputs[0];
  if (best) return { kind: "output", ...best };
  const refused = answers.find((a) => !a.ok);
  return { kind: "failure", failure: refused && !refused.ok ? refused.failure : { kind: "no-tools", root: "" } };
}

/** Один расчёт на папку и по очереди: одновременно не больше одного (F-83). */
export async function computeHelp(target: HelpTarget, envOf: (root: string) => CoreEnv | CoreFailure): Promise<HelpOutcome> {
  if ("roots" in target) {
    const answers: (HelpResult & { root: string })[] = [];
    for (const root of target.roots) answers.push(await ask(root, null, envOf));
    return settle(answers);
  }
  const answer = await ask(target.root, target.change, envOf);
  return answer.ok ? { kind: "output", root: answer.root, output: answer.output } : { kind: "failure", failure: answer.failure };
}

const isDir = (p: string) => !!fs.statSync(p, { throwIfNoEntry: false })?.isDirectory();
const quoted = (arg: string) => (/\s/.test(arg) ? `"${arg}"` : arg);

/**
 * Что запустить в папке проекта, чтобы увидеть то же своими глазами: тем же Python, что считал справку. Инструменты вне проекта называются полным путём: относительный ничего не скажет.
 * Первое слово в кавычках PowerShell, терминал VS Code на Windows по умолчанию, считает строкой, а не командой, поэтому перед ним `&`.
 */
function terminalCommand(env: CoreEnv, script: string, args: string[]): string {
  const line = [env.python, env.installDir ? script : path.relative(env.cwd, script), ...args].map(quoted).join(" ");
  return process.platform === "win32" && /\s/.test(env.python) ? `& ${line}` : line;
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

export const sameTarget = (a: HelpTarget, b: HelpTarget | null) => !!b && JSON.stringify(a) === JSON.stringify(b);

export interface StepHelpDeps {
  compute(target: HelpTarget): Promise<HelpOutcome>;
  onResult(target: HelpTarget, result: HelpOutcome): void;
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

  private async once(target: HelpTarget): Promise<HelpOutcome> {
    try {
      return await this.deps.compute(target);
    } catch (e) {
      return { kind: "failure", failure: { kind: "crash", text: String(e) } };
    }
  }
}
