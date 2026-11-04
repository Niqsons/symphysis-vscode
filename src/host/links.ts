// Какой файл открывать по клику на ссылку. Без vscode: так же будет открывать вкладка справки.
import path from "node:path";
import { ownLink, type FileLinks } from "../shared/links";

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
