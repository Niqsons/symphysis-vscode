// Листание справки: что остаётся после нового ответа хоста. Чистая функция, страница только хранит результат.
import type { HelpView } from "../protocol/protocol";
import type { ShownPage } from "./HelpBody";

/** `key` — каталог изменения, а не имя: две папки рабочей области могут держать одноимённые изменения. */
export interface ShownState {
  key: string | null;
  shown: ShownPage;
}

/**
 * То же изменение: страница и правила остаются, отметку текущего обновляет сам вывод. Другое изменение — возврат к текущему шагу.
 * Открытого шага в новом выводе нет — тоже к текущему, а правила намерения остаются: они от шага не зависят.
 */
export function keepShown(prev: ShownState, view: HelpView): ShownState {
  if (prev.key !== view.key) return { key: view.key, shown: { step: null, rules: false } };
  const output = view.outcome?.kind === "output" ? view.outcome.output : null;
  if (output && prev.shown.step && !output.steps.some((p) => p.id === prev.shown.step)) return { key: view.key, shown: { step: null, rules: prev.shown.rules } };
  return prev;
}
