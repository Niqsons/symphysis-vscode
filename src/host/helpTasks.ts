// Числа задач для строки счётчиков просмотрщика: только из ответа расчёта справки для изменения открытого журнала (F-13, F-30, F-43).
// Плагин `tasks.md` сам не читает и не считает. Без vscode.
import type { HelpOutcome } from "../shared/protocol";
import { changeDir } from "./project";
import type { HelpTarget } from "./stepHelp";

export interface TaskCounts {
  complete: number;
  total: number;
}

export const sameTasks = (a: TaskCounts | null, b: TaskCounts | null): boolean => a?.complete === b?.complete && a?.total === b?.total;

/**
 * Ответ идёт журналу, только если он посчитан для того же каталога изменения: ключ, а не имя (две папки могут держать одноимённые изменения).
 * Сбой, отказ, список на выбор, нет чисел или ответа вовсе — `null`: части о задачах нет.
 */
export function tasksFor(key: string | null, answer: { target: HelpTarget; outcome: HelpOutcome } | null): TaskCounts | null {
  if (!key || !answer || answer.outcome.kind !== "output") return null;
  const { root, output } = answer.outcome;
  if (output.error || !output.change || changeDir(root, output.change) !== key) return null;
  const tasks = output.tasks;
  return tasks && Number.isFinite(tasks.total) && Number.isFinite(tasks.complete) ? { complete: tasks.complete, total: tasks.total } : null;
}
