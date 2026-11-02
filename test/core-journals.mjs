// Настоящие журналы ядра: где они лежат, знает только этот файл, его читают и модульные тесты, и сквозной сценарий.
import fs from "node:fs";
import path from "node:path";

const BIG = "calibration-fixes";

const withJournal = (base) => (fs.existsSync(base) ? fs.readdirSync(base) : [])
  .map((name) => ({ name, dir: path.join(base, name) }))
  .filter((j) => fs.existsSync(path.join(j.dir, "decisions.json")));

/** Активные изменения и архив: после архивации журнал остаётся настоящим, каталог лишь получает дату в начале имени. */
export function coreJournals(root) {
  const changes = path.join(root, "openspec", "changes");
  return [...withJournal(changes), ...withJournal(path.join(changes, "archive"))];
}

/** Большой журнал со строками атаки. Нет его — ошибка, а не пропуск: пропуск выглядел бы зелёным прогоном без этого шага. */
export function bigJournal(root) {
  const found = coreJournals(root).find((j) => j.name.replace(/^\d{4}-\d{2}-\d{2}-/, "") === BIG);
  if (!found) throw new Error(`${root}: нет журнала ${BIG} ни в openspec/changes, ни в архиве`);
  return found;
}
