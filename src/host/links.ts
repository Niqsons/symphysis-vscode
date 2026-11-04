// Какой файл открывать по клику на ссылку. Без vscode: так же будет открывать вкладка справки.
import fs from "node:fs";
import path from "node:path";
import { ownLink, type FileLinks } from "../shared/links";
import type { HelpSkill } from "../shared/types";

/**
 * Сообщение страницы несёт ключ карты, не путь. Путь берётся из карты последнего показанного вывода,
 * и только если ключ в ней свой. Нет ключа, карты или корня — открывать нечего (F-44, F-54).
 */
export function resolveLink(links: FileLinks | null | undefined, key: unknown, root: string | null | undefined): string | null {
  if (typeof key !== "string" || !root) return null;
  const rel = ownLink(links, key);
  return rel === null ? null : path.resolve(root, rel);
}

/** Номер строки из сообщения страницы: целое от 1, иначе без строки. */
export function lineOf(line: unknown): number | null {
  return typeof line === "number" && Number.isInteger(line) && line >= 1 ? line : null;
}

/**
 * Скилл из каталога установки (F-91): страница называет имя, путь берётся из поля `skills` показанного вывода, от каталога настройки `symphysis.toolsPath`.
 * Скилл проекта идёт через карту ссылок, здесь он не открывается. Сравниваются настоящие пути обеих сторон: junction или ссылка внутри каталога наружу не ведёт.
 * Файла нет (настройка сменилась после расчёта) — открывать нечего.
 */
export function resolveSkill(skills: HelpSkill[] | undefined, name: unknown, installDir: string | null | undefined): string | null {
  if (typeof name !== "string" || !installDir || !Array.isArray(skills)) return null;
  const skill = skills.find((s) => s.name === name && s.base === "install" && typeof s.path === "string" && s.path !== "");
  if (!skill) return null;
  try {
    const base = fs.realpathSync.native(path.resolve(installDir));
    const file = fs.realpathSync.native(path.resolve(base, skill.path!));
    const inside = path.relative(base, file);
    return inside === "" || inside === ".." || inside.startsWith(".." + path.sep) || path.isAbsolute(inside) ? null : file;
  } catch {
    return null;
  }
}
