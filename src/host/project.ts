// Файлы проекта: где ядро, какие изменения, ответы человека, черновики, события для хука. Расширение пишет только в `.symphysis/viewer/` (Р4)
// и в `answers/` изменения (Р8).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { emptyDraft, normalizeDraft } from "../shared/logic";
import { parseScheme, type ParsedScheme } from "../shared/scheme";
import type { Draft } from "../shared/types";

export interface ChangeRef {
  root: string;
  name: string;
  dir: string;
  journal: string;
  hasJournal: boolean;
  attacks: string[];
}

const CHANGES = path.join("openspec", "changes");
const VIEWER = path.join(".symphysis", "viewer");

/** Установленное ядро важнее `tools/`: у репозитория symphysis есть оба, и работает он как установленный проект. */
export function findTools(root: string): string | null {
  for (const dir of [path.join(root, ".symphysis", "tools"), path.join(root, "tools")]) {
    if (fs.existsSync(path.join(dir, "journal.py"))) return dir;
  }
  return null;
}

export function changeRef(root: string, name: string): ChangeRef {
  const dir = path.join(root, CHANGES, name);
  const journal = path.join(dir, "decisions.json");
  let attacks: string[] = [];
  try {
    attacks = fs.readdirSync(path.join(dir, "attack")).filter((f) => f.endsWith(".md")).sort().map((f) => path.join(dir, "attack", f));
  } catch { /* каталога атак нет — атак нет */ }
  return { root, name, dir, journal, hasJournal: fs.existsSync(journal), attacks };
}

export function listChanges(root: string): ChangeRef[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, CHANGES), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory() && e.name !== "archive").map((e) => e.name).sort().map((name) => changeRef(root, name));
}

/** Промпт как есть в `answers/<дата>.md`; занято — `<дата>-2.md`, `-3`… Создание исключительное: чужой файл не затирается. */
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

export function saveAnswers(dir: string, date: string, text: string): string {
  const answers = path.join(dir, "answers");
  fs.mkdirSync(answers, { recursive: true });
  for (let n = 1; ; n++) {
    const file = path.join(answers, n === 1 ? `${date}.md` : `${date}-${n}.md`);
    try {
      fs.writeFileSync(file, text, { encoding: "utf8", flag: "wx" });
      return file;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

export const sha256File = (file: string): string => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const draftFile = (root: string, name: string) => path.join(root, VIEWER, `${name}.json`);

/** Битый файл — работа человека: он откладывается рядом и называется, а не затирается. */
export function readDraft(root: string, name: string): { draft: Draft; damaged: string | null } {
  const file = draftFile(root, name);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { draft: emptyDraft(), damaged: null };
  }
  try {
    return { draft: normalizeDraft(JSON.parse(text)), damaged: null };
  } catch {
    const damaged = path.join(path.dirname(file), `${name}.damaged-${Date.now()}.json`);
    fs.renameSync(file, damaged);
    return { draft: emptyDraft(), damaged };
  }
}

/** Каталог для записи: черновик, событие и файлы хука идут через эту функцию, поэтому каталог всегда сам себя исключает из git. */
export function viewerDir(root: string): string {
  const dir = path.join(root, VIEWER);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n", "utf8");
  return dir;
}

/** Запись через временный файл и переименование: обрыв не оставит половину черновика. */
export function writeDraft(root: string, name: string, draft: Draft): void {
  viewerDir(root);
  const file = draftFile(root, name);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(draft, null, 1), "utf8");
  fs.renameSync(temp, file);
}

/**
 * Покажет ли хук событие этого изменения: та же форма, что `valid_name` в `hook/hook.py` (`security.md`). Длина в знаках, как `len` в Python, а не в единицах UTF-16.
 * Обе стороны сверяет `test/unit/hook-script.test.ts`.
 */
export const hookAcceptsChange = (name: string): boolean => [...name].length <= 100 && /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u.test(name);

/** Строка `events.jsonl`. Поля читает `hook/hook.py`. */
export interface JournalEvent {
  change: string;
  answers: string;
  sha256_before: string;
  sha256_after: string;
  report: string[];
}

/** Один вызов на строку: хук читает файл параллельно, а неполную последнюю строку оставляет на следующее обращение. */
export function appendEvent(root: string, event: JournalEvent): void {
  fs.appendFileSync(path.join(viewerDir(root), "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

/** Курсор появляется при первом срабатывании хука: нет ни одного — хук в этом проекте ни разу не срабатывал (F-99). */
export function hasSessionCursors(root: string): boolean {
  try {
    return fs.readdirSync(path.join(root, VIEWER, "sessions")).some((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
}

/** `unlinkSync`, не `rmSync`: `rmSync` в Node 24 на Windows молча не удаляет файл, если в пути кириллица. */
export function deleteDraft(root: string, name: string): void {
  try {
    fs.unlinkSync(draftFile(root, name));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
