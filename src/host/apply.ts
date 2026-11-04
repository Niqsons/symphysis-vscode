// «Внести»: только этим путём слово человека идёт в журнал, и только по клику в странице — иначе внесёт агент.
import fs from "node:fs";
import path from "node:path";
import { applyAnswers, rebuild, viewJson, type CoreEnv } from "./core";
import { appendEvent, hasSessionCursors, hookAcceptsChange, saveAnswers, sha256File, type ChangeRef } from "./project";

export interface ApplyInput {
  env: CoreEnv;
  ref: ChangeRef;
  text: string;
  shownSha: string | undefined;
  date: string;
}

export type ApplyOutcome =
  | { stage: "stale" }
  | { stage: "refused"; report: string[] }
  | { stage: "error"; text: string }
  | { stage: "applied"; answers: string; report: string[]; rebuildOk: boolean; rebuildReport: string[]; sha256After: string | null };

const eventLost = (reason: string) => `[!!] Журнал внесён, но событие для агента не записалось (${reason}): агенту надо сказать самому.`;
const NAME_HIDDEN = "[!!] Журнал внесён, но хук такое имя изменения не покажет: агенту надо сказать самому.";
const NO_SESSIONS = "[!!] Ни одна сессия агента ещё не обращалась через хук в этом проекте, агенту в другом каталоге надо сказать самому.";

function currentSha(file: string): string | null {
  try {
    return sha256File(file);
  } catch {
    return null;
  }
}

/** Событие для хука. Журнал уже внесён, поэтому сбой здесь не отказ, а предупреждение к отчёту (F-70, F-99). Возвращает строки предупреждений. */
function tellAgent(ref: ChangeRef, answers: string, before: string, after: string | null, report: string[]): string[] {
  const warnings: string[] = [];
  if (!hookAcceptsChange(ref.name)) {
    // Строку скрипт отбросил бы молча: человек считал бы, что агент узнает.
    warnings.push(NAME_HIDDEN);
  } else if (after === null) {
    warnings.push(eventLost("журнал не прочитать"));
  } else {
    const written = appendEvent(ref.root, { change: ref.name, answers: path.relative(ref.root, answers).split(path.sep).join("/"), sha256_before: before, sha256_after: after, report });
    if (!written.ok) warnings.push(eventLost(written.reason));
  }
  if (!hasSessionCursors(ref.root)) warnings.push(NO_SESSIONS);
  return warnings;
}

export async function applyFlow({ env, ref, text, shownSha, date }: ApplyInput): Promise<ApplyOutcome> {
  if (!shownSha || currentSha(ref.journal) !== shownSha) return { stage: "stale" };
  // Номер сверяется заново: ядро могло смениться после показа, а кнопка закрыта только по старому ответу. Цена — один вызов `view-json`.
  const seen = await viewJson(env, ref);
  if (!seen.ok && seen.failure.kind === "contract") {
    return { stage: "error", text: seen.failure.need === "vsix" ? "инструменты symphysis новее плагина: поставь новый .vsix" : "старые инструменты: обнови symphysis" };
  }
  const answers = saveAnswers(ref.dir, date, text);
  const applied = await applyAnswers(env, ref, answers);
  if (!applied.ok) {
    // В `answers/` остаётся только то, что вошло в журнал: отказанный промпт человек поправит выбором в интерфейсе.
    fs.unlinkSync(answers);
    return { stage: "refused", report: applied.report };
  }
  // Событие до сборки: журнал уже внесён, упавшая сборка этого не отменяет.
  const sha256After = currentSha(ref.journal);
  const warnings = tellAgent(ref, answers, shownSha, sha256After, applied.report);
  const rebuilt = await rebuild(env, ref);
  return { stage: "applied", answers, report: [...applied.report, ...warnings], rebuildOk: rebuilt.ok, rebuildReport: rebuilt.report, sha256After };
}
