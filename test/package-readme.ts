// Что должно быть в README.md пакета (F-82, F-87). Общая проверка для теста упаковки и для e2e на установленном .vsix.
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

/** Чего нет в тексте; `null` — файла нет вовсе. Пустой список значит, что описание на месте. */
export function readmeMissing(text: string | null): string[] {
  if (text === null) return ["файла README.md"];
  return REQUIRED.filter(([, pattern]) => !pattern.test(text)).map(([what]) => what);
}

/** Бросает отказ с названием того, чего нет. */
export function assertReadme(text: string | null): void {
  const missing = readmeMissing(text);
  if (missing.length) throw new Error(`описание хука в пакете не годится, нет: ${missing.join("; ")}`);
}

export function readReadme(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
