// «Внести»: только этим путём слово человека идёт в журнал, и только по клику в странице — иначе внесёт агент.
import fs from "node:fs";
import { applyAnswers, rebuild, viewJson, type CoreEnv } from "./core";
import { saveAnswers, sha256File, type ChangeRef } from "./project";

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
  | { stage: "applied"; answers: string; report: string[]; rebuildOk: boolean; rebuildReport: string[]; sha256After: string };

function currentSha(file: string): string | null {
  try {
    return sha256File(file);
  } catch {
    return null;
  }
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
  const rebuilt = await rebuild(env, ref);
  return { stage: "applied", answers, report: applied.report, rebuildOk: rebuilt.ok, rebuildReport: rebuilt.report, sha256After: sha256File(ref.journal) };
}
