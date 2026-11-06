// Ссылки на файлы: разбор текста и поиск в карте `file_links` из вывода ядра. Общее для страницы и хоста, без vscode и DOM.

/** Хвост `:строка` или `:строка-строка`, как у ядра. Диапазон открывается на первой строке (F-85, F-94). */
const LINE_TAIL = /:(\d+)(?:-\d+)?$/;

export type FileLinks = Record<string, string>;

export function splitLink(text: string): { key: string; line: number | null } {
  const m = LINE_TAIL.exec(text);
  if (!m) return { key: text, line: null };
  const line = Number(m[1]);
  return { key: text.slice(0, m.index), line: line >= 1 ? line : null };
}

/** Только свои ключи карты: `constructor` и `__proto__` есть у любого объекта. */
export function ownLink(links: FileLinks | null | undefined, key: string): string | null {
  if (!links || typeof links !== "object" || !Object.hasOwn(links, key)) return null;
  const v = links[key];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Ссылка ли этот текст из обратных кавычек: ключ без хвоста и строка, либо `null`. */
export function linkOf(links: FileLinks | null | undefined, text: string): { key: string; line: number | null } | null {
  const t = splitLink(text);
  return ownLink(links, t.key) === null ? null : t;
}
