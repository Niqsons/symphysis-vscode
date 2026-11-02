// `scheme.md` и схема на вкладке: разбор файла и правила масштаба и клика. Без vscode и без DOM.
// Разбор есть и в ядре (`tools/journal_render.py`): показ у каждой стороны свой, оба сверяются набором `tests/fixtures/scheme/cases.json` ядра.

export interface ParsedScheme {
  /** Текст первого непустого блока mermaid; блока нет — `null`. */
  text: string | null;
  /** Сколько в файле непустых блоков mermaid. */
  blocks: number;
  /** Строка файла, с которой начинается блок; нужна для номера строки в ошибке. */
  first_line: number | null;
}

const FENCE = /^ {0,3}(`{3,})[ \t]*([^`]*?)[ \t]*$/;

export function parseScheme(text: string): ParsedScheme {
  let fence: { length: number; mermaid: boolean; first: number; body: string[] } | null = null;
  const blocks: { mermaid: boolean; first: number; body: string[] }[] = [];
  text.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n").forEach((line, i) => {
    const match = FENCE.exec(line);
    if (!fence) {
      if (match) fence = { length: match[1].length, mermaid: match[2] === "mermaid", first: i + 2, body: [] };
    } else if (match && !match[2] && match[1].length >= fence.length) {
      blocks.push(fence);
      fence = null;
    } else {
      fence.body.push(line);
    }
  });
  if (fence) blocks.push(fence);
  const filled = blocks.filter((b) => b.mermaid && b.body.join("").trim());
  if (!filled.length) return { text: null, blocks: 0, first_line: null };
  return { text: `${filled[0].body.join("\n").replace(/\n+$/, "")}\n`, blocks: filled.length, first_line: filled[0].first };
}

export const blocksNote = (n: number) => `в файле ${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "блока" : "блоков"}, показан первый`;

/** Идентификатор узла из идентификатора элемента рисунка (формат mermaid 12): версия закреплена, при обновлении проверяется заново (F-40). */
export const SVG_ID = "scheme1";
const NODE_ELEMENT = new RegExp(`^${SVG_ID}-flowchart-(.+)-\\d+$`);
export const nodeIdOf = (elementId: string): string | null => NODE_ELEMENT.exec(elementId)?.[1] ?? null;

/** Встречается ли идентификатор в тексте схемы отдельным словом, дословно (F-87): подсказка «узел не найден», сверка не строже. */
export function nodeInScheme(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u").test(text);
}

/** Сдвиг до этого порога считается клик по узлу, больше — перетаскивание (F-68). */
export const CLICK_SLOP = 3;
export const isClick = (dx: number, dy: number) => Math.max(Math.abs(dx), Math.abs(dy)) <= CLICK_SLOP;

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
const STEP = 1.25;
export const zoomIn = (scale: number) => Math.min(MAX_SCALE, scale * STEP);
export const zoomOut = (scale: number) => Math.max(MIN_SCALE, scale / STEP);

/** «Вписать» уменьшает, но не растягивает: маленькая схема остаётся в 100 % (F-69). */
export const fitScale = (width: number, height: number, panelWidth: number, panelHeight: number) =>
  Math.max(MIN_SCALE, Math.min(1, panelWidth / width, panelHeight / height));
