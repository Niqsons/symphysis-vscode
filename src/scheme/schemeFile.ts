// `scheme.md` изменения на стороне VS Code: путь и чтение с разбором. Разбор — `scheme.ts`; файл читают вкладка схемы и просмотрщик.
// Лежит в модуле схемы, а не в `core`: иначе `core` зависел бы от `scheme`, а `scheme` от `core` — цикл модулей (R12).
import fs from "node:fs";
import path from "node:path";
import type { ParsedScheme } from "../protocol/protocol";
import { parseScheme } from "./scheme";

export const schemeFile = (dir: string) => path.join(dir, "scheme.md");

/** `scheme.md` изменения. Не текст файла — файл без блока, а не отказ (`security.md`, бинарные файлы). */
export function readScheme(dir: string): ParsedScheme & { exists: boolean } {
  let text: string;
  try {
    text = fs.readFileSync(schemeFile(dir), "utf8");
  } catch {
    return { exists: false, text: null, blocks: 0, first_line: null };
  }
  return { exists: true, ...parseScheme(text) };
}
