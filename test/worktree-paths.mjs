import fs from "node:fs";
import path from "node:path";

/** Проверяет каждый компонент фиксированного входа или выхода до работы с ним. */
export function checkWorktreePath(root, name, { required = false } = {}) {
  const canonical = fs.realpathSync(root);
  const parts = name.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[:\\]/.test(part)))
    throw new Error(`Некорректный путь рабочего дерева: ${name}`);
  let current = canonical;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat && required) throw new Error(`Недоступен вход рабочего дерева: ${name}`);
    if (stat?.isSymbolicLink()) throw new Error(`Ссылка в пути сборки или тестов: ${name}`);
    if (stat) {
      const relative = path.relative(canonical, fs.realpathSync(current));
      if (path.isAbsolute(relative) || relative.split(path.sep)[0] === "..")
        throw new Error(`Путь сборки или тестов вне рабочего дерева: ${name}`);
    }
  }
  if (required && !fs.statSync(current).isFile()) throw new Error(`Недоступен файл рабочего дерева: ${name}`);
  return current;
}
