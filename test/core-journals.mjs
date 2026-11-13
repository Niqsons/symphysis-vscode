// Настоящие журналы ядра: где они лежат, знает только этот файл, его читают и модульные тесты, и сквозной сценарий.
import fs from "node:fs";
import path from "node:path";

const BIG = "calibration-fixes";

const inRoot = (root, entry) => {
  const relative = path.relative(root, fs.realpathSync(entry));
  if (path.isAbsolute(relative) || relative.split(path.sep)[0] === "..")
    throw new Error(`Журнал вне выбранного дерева ядра: ${entry}`);
  return entry;
};

const withJournal = (root, base) => (fs.existsSync(base) ? fs.readdirSync(inRoot(root, base)) : [])
  .map((name) => ({ name, dir: path.join(base, name) }))
  .filter((j) => fs.existsSync(path.join(j.dir, "decisions.json")))
  .map((j) => {
    const file = inRoot(root, path.join(j.dir, "decisions.json"));
    if (!fs.statSync(file).isFile()) throw new Error(`Недоступен файл журнала ядра: ${file}`);
    return j;
  });

/** Активные изменения и архив: после архивации журнал остаётся настоящим, каталог лишь получает дату в начале имени. */
export function coreJournals(root) {
  const canonical = fs.realpathSync(root);
  const changes = path.join(canonical, "openspec", "changes");
  return [...withJournal(canonical, changes), ...withJournal(canonical, path.join(changes, "archive"))];
}

/** Большой журнал со строками атаки. Нет его — ошибка, а не пропуск: пропуск выглядел бы зелёным прогоном без этого шага. */
export function bigJournal(root) {
  const found = coreJournals(root).find((j) => j.name.replace(/^\d{4}-\d{2}-\d{2}-/, "") === BIG);
  if (!found) throw new Error(`${root}: нет журнала ${BIG} ни в openspec/changes, ни в архиве`);
  return found;
}
