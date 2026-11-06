// Что должно быть в README пакета (F-82, F-87) и чего в нём быть не должно (F-38). Общая проверка для теста упаковки и для e2e на установленном .vsix.
import fs from "node:fs";

/** Что README обязан назвать: записи плагина, настройку, ручную уборку и обновление инструментов (F-99, F-101). */
const REQUIRED: [what: string, pattern: RegExp][] = [
  ["запись .claude/settings.local.json", /\.claude\/settings\.local\.json/],
  ["запись .opencode/plugins/", /\.opencode\/plugins\//],
  ["запись .git/info/exclude", /\.git\/info\/exclude/],
  ["запись .symphysis/viewer/", /\.symphysis\/viewer\//],
  ["настройка symphysis.hook.enabled", /symphysis\.hook\.enabled/],
  ["как убрать хук руками (раздел «вручную»)", /вручную/i],
  ["убрать запись UserPromptSubmit", /UserPromptSubmit/],
  ["убрать файл symphysis-hook.js", /symphysis-hook\.js/],
  ["уборка после удаления плагина", /после удаления плагина/i],
  ["агент в другом каталоге хука не услышит", /другом каталоге/i],
  ["обновление инструментов: symphysis install --project . --force", /symphysis install --project \. --force/],
];

/**
 * Чего в README пакета быть не должно: он идёт на вкладку расширения. Frontmatter модуля и строки о каталогах
 * репозитория — текст README корня и README модулей, человеку с установленным плагином они ни к чему (F-38).
 */
const FOREIGN: [what: string, pattern: RegExp][] = [
  ["frontmatter в начале файла", /^﻿?---\r?\n/],
  ["строка о каталоге репозитория `[имя/](имя/) — модуль|контур разработки`", /^\s*(?:[-*]\s+)?\[[^\]]*\/\]\([^)]*\)\s*—\s*(?:модуль|контур разработки)/mu],
];

/** Чего нет в тексте; `null` — файла нет вовсе. Пустой список значит, что описание на месте. */
export function readmeMissing(text: string | null): string[] {
  if (text === null) return ["файла README.md"];
  return REQUIRED.filter(([, pattern]) => !pattern.test(text)).map(([what]) => what);
}

/** Что в тексте лишнего для README пакета. */
export function readmeForeign(text: string): string[] {
  return FOREIGN.filter(([, pattern]) => pattern.test(text)).map(([what]) => what);
}

/** Бросает отказ с названием того, чего нет, и того, что лишнее. */
export function assertReadme(text: string | null): void {
  const missing = readmeMissing(text);
  if (missing.length) throw new Error(`описание хука в пакете не годится, нет: ${missing.join("; ")}`);
  const foreign = readmeForeign(text!);
  if (foreign.length) throw new Error(`в README пакета лишнее: ${foreign.join("; ")}`);
}

export function readReadme(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
