// Проверка структуры репозитория плагина: README корня, README модулей в `src/`, места модулей, копии файлов (F-25, F-31).
// Правила те же, что у проверки ядра (`tests/repository_structure.py` в symphysis), задачи 1.1–1.5; место модуля другое:
// в ядре — первый уровень, в плагине — `src/<модуль>/`. Каталог `src/` в README корня — контур разработки, внутри
// которого лежат модули, как `openspec/` ядра с модулем схемы внутри.
// Читается корень репозитория и файлы, которые знает git (`git ls-files`): `node_modules/`, `out/`, выходы сборки в счёт не идут.
// Каждая проверка возвращает список замечаний; пустой список — зелёный. Frontmatter разбирается вручную, загрузчика YAML нет:
// содержимое README — данные, теги YAML не исполняются.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const KINDS = ["доменный", "технический"];
export const MARKS = ["модуль", "контур разработки"];
/** Каталог модулей плагина: модуль — его прямой подкаталог (F-31). */
export const SRC = "src";

// Строка README корня о каталоге: `[имя/](имя/) — модуль` (одна форма ссылки, F-50 B).
const ROOT_LINE = /^\s*(?:[-*]\s+)?\[[^\]]*\/\]\(/u;
const ROOT_FULL = /^\s*(?:[-*]\s+)?\[([^\]]*)\]\(([^)]*)\)\s*—\s*(модуль|контур разработки)(?![\p{L}\p{N}_])/u;
const LINK = /\[([^\]]*)\]\(([^)\s]*)\)/gu;
const WORD = /[\p{L}\p{N}_]/u;
const byKey = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : a > b ? 1 : 0);

/** Корень и файлы, известные git (индекс). */
export class Repo {
  readonly root: string;
  readonly files: string[];
  readonly dirs = new Set<string>();

  constructor(root: string) {
    this.root = root;
    const out = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" });
    this.files = out.split("\0").filter(Boolean).sort();
    for (const f of this.files) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
    }
  }

  topDirs(): string[] {
    return [...this.dirs].filter((d) => !d.includes("/")).sort();
  }

  /** Вложенные каталоги первого уровня каталога `d` (только известные git). */
  subdirs(d: string): string[] {
    return [...this.dirs].filter((x) => x.startsWith(d + "/") && !x.slice(d.length + 1).includes("/")).map((x) => x.slice(d.length + 1)).sort();
  }

  read(rel: string): string {
    return fs.readFileSync(path.join(this.root, rel)).toString("utf8").replace(/^﻿/, "");
  }
}

/** [строки frontmatter, тело] или [null, text], если README не начинается с `---`. */
export function splitFrontmatter(text: string): [string[] | null, string] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (!lines.length || lines[0].trim() !== "---") return [null, text];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return [lines.slice(1, i), lines.slice(i + 1).join("\n")];
  }
  return [null, text];
}

/** Скалярные `name` и `kind` вручную. Возвращает [поля, ошибки]; поля null — frontmatter нет. */
export function parseFrontmatter(text: string): [Record<string, string> | null, string[]] {
  const [fm] = splitFrontmatter(text);
  if (fm === null) return [null, []];
  const fields: Record<string, string> = {};
  const errors: string[] = [];
  for (const line of fm) {
    const m = /^(name|kind)\s*:(.*)$/u.exec(line);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();
    if (key in fields) {
      errors.push(`поле \`${key}\` повторено`);
      continue;
    }
    let value: string;
    if (raw[0] === "'" || raw[0] === '"') {
      const end = raw.indexOf(raw[0], 1);
      if (end < 0) {
        errors.push(`поле \`${key}\`: незакрытая кавычка`);
        continue;
      }
      value = raw.slice(1, end);
    } else {
      value = raw.split(/\s+#/u)[0].trim();
      if (value && "!&*|>[{%@`".includes(value[0])) {
        errors.push(`поле \`${key}\`: тег или не скаляр YAML \`${value}\``);
        continue;
      }
    }
    fields[key] = value;
  }
  return [fields, errors];
}

/** README модуля: frontmatter несёт ключи `name` и `kind`; чужой frontmatter (`title:`) модулем не делает. */
function hasFrontmatter(repo: Repo, readme: string): boolean {
  const [fm] = splitFrontmatter(repo.read(readme));
  if (fm === null) return false;
  const keys = new Set(fm.map((line) => /^(name|kind)\s*:/u.exec(line)?.[1]).filter(Boolean));
  return keys.has("name") && keys.has("kind");
}

/** Строки README корня о каталогах: [{каталог: пометка}, замечания]. */
export function rootMarks(repo: Repo): [Map<string, string>, string[]] {
  const marks = new Map<string, string>();
  const problems: string[] = [];
  if (!repo.files.includes("README.md")) return [marks, ["README.md в корне: файла нет"]];
  repo.read("README.md").split(/\r?\n/).forEach((line, i) => {
    if (!ROOT_LINE.test(line)) return;
    const m = ROOT_FULL.exec(line);
    if (!m || m[1] !== m[2] || m[1].slice(0, -1).includes("/")) {
      problems.push(`README.md:${i + 1}: строка не в форме \`[имя/](имя/) — модуль|контур разработки\`: ${line.trim()}`);
      return;
    }
    marks.set(m[1].slice(0, -1), m[3]);
  });
  return [marks, problems];
}

/** 1.1: каждый каталог первого уровня из git назван в README корня с пометкой; обратная сверка; у контура разработки нет README модуля. */
export function checkRootReadme(repo: Repo): string[] {
  const [marks, problems] = rootMarks(repo);
  const tops = repo.topDirs();
  for (const d of tops) if (!marks.has(d)) problems.push(`${d}/: каталог первого уровня без строки в README корня`);
  for (const d of [...marks.keys()].sort()) if (!tops.includes(d)) problems.push(`README.md: строка о каталоге \`${d}/\`, которого в корне нет`);
  for (const [d, mark] of [...marks].sort(byKey)) {
    const readme = `${d}/README.md`;
    if (mark === "контур разработки" && repo.files.includes(readme) && hasFrontmatter(repo, readme)) problems.push(`${d}/: контур разработки с README модуля`);
  }
  return problems;
}

/**
 * Каталоги, которые считаются модулями: каждый прямой подкаталог `src/` из git, помеченные «модуль» в README корня
 * и любой каталог глубже первого уровня с README, начинающимся frontmatter модуля (поймать модуль не на месте).
 */
export function moduleDirs(repo: Repo): string[] {
  const [marks] = rootMarks(repo);
  const found = new Set<string>();
  for (const [d, mark] of marks) if (mark === "модуль" && repo.dirs.has(d)) found.add(d);
  for (const d of repo.subdirs(SRC)) found.add(`${SRC}/${d}`);
  for (const f of repo.files) {
    if (!f.endsWith("/README.md")) continue;
    const d = f.slice(0, -"/README.md".length);
    if (d.includes("/") && hasFrontmatter(repo, f)) found.add(d);
  }
  return [...found].sort();
}

/** 1.2: frontmatter README модуля — `name` непустое, `kind` из двух значений, имена не повторяются. */
export function checkModuleFrontmatter(repo: Repo): string[] {
  const problems: string[] = [];
  const names = new Map<string, string[]>();
  for (const d of moduleDirs(repo)) {
    const readme = `${d}/README.md`;
    if (!repo.files.includes(readme)) {
      problems.push(`${d}/: у модуля нет README.md`);
      continue;
    }
    const [fields, errors] = parseFrontmatter(repo.read(readme));
    if (fields === null) {
      problems.push(`${d}/: README модуля не начинается с frontmatter`);
      continue;
    }
    problems.push(...errors.map((e) => `${d}/: ${e}`));
    for (const key of ["name", "kind"]) {
      if (!(key in fields) && !errors.some((e) => e.includes(`\`${key}\``))) problems.push(`${d}/: во frontmatter нет поля \`${key}\``);
    }
    if ("name" in fields) {
      if (!fields.name.trim()) problems.push(`${d}/: пустое имя модуля`);
      else names.set(fields.name, [...(names.get(fields.name) ?? []), d]);
    }
    if ("kind" in fields && !KINDS.includes(fields.kind)) problems.push(`${d}/: kind \`${fields.kind}\` вне значений ${KINDS.join(", ")}`);
  }
  for (const [name, dirs] of [...names].sort(byKey)) {
    if (dirs.length > 1) problems.push(`имя модуля \`${name}\` повторено: ` + dirs.map((x) => `${x}/`).join(", "));
  }
  return problems;
}

/** Ссылки README на вложенные каталоги модуля: [[имя, есть ли строка о нём]], замечания о форме. Ссылка за каталог модуля не засчитывается. */
export function readmeDirLinks(text: string, module: string): [[string, boolean][], string[]] {
  const [, body] = splitFrontmatter(text);
  const found: [string, boolean][] = [];
  const problems: string[] = [];
  let inCode = false;
  for (const line of body.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    for (const m of line.matchAll(LINK)) {
      const [, label, href] = m;
      if (href.includes("://") || href.startsWith("#") || href.startsWith("mailto:") || !href.endsWith("/")) continue;
      const norm = path.posix.normalize(path.posix.join(module, href)).replace(/\/+$/, "");
      if (!norm.startsWith(module + "/")) continue;
      const rel = norm.slice(module.length + 1);
      if (rel.includes("/")) continue;
      if (label !== href || href !== rel + "/") {
        problems.push(`ссылка \`[${label}](${href})\` не в форме \`[${rel}/](${rel}/)\``);
        continue;
      }
      found.push([rel, WORD.test(line.slice(m.index! + m[0].length))]);
    }
  }
  return [found, problems];
}

/** 1.3: ссылка `[имя/](имя/)` и строка на каждый вложенный каталог из git; ссылка на отсутствующий — красный. */
export function checkNestedDirs(repo: Repo): string[] {
  const problems: string[] = [];
  for (const d of moduleDirs(repo)) {
    const readme = `${d}/README.md`;
    if (!repo.files.includes(readme)) continue;
    const [links, form] = readmeDirLinks(repo.read(readme), d);
    problems.push(...form.map((p) => `${d}/: ${p}`));
    const linked = new Map<string, boolean>();
    for (const [rel, hasText] of links) linked.set(rel, (linked.get(rel) ?? false) || hasText);
    const real = new Set(repo.subdirs(d));
    for (const rel of [...real].sort()) if (!linked.has(rel)) problems.push(`${d}/: вложенный каталог \`${rel}/\` не описан в README модуля`);
    for (const rel of [...linked.keys()].sort()) if (!real.has(rel)) problems.push(`${d}/: README ссылается на \`${rel}/\`, а каталога в модуле нет`);
    for (const rel of [...linked.keys()].sort()) if (real.has(rel) && !linked.get(rel)) problems.push(`${d}/: у ссылки на \`${rel}/\` нет строки о каталоге`);
  }
  return problems;
}

/** 1.4: модуль — прямой подкаталог `src/`; модуль в модуле — красный. */
export function checkModulePlaces(repo: Repo): string[] {
  const problems: string[] = [];
  const mods = moduleDirs(repo);
  for (const d of mods) {
    const parts = d.split("/");
    if (parts.length !== 2 || parts[0] !== SRC) problems.push(`${d}/: модуль не на своём месте (${SRC}/<модуль>/)`);
    for (const other of mods) if (d.startsWith(other + "/")) problems.push(`${d}/: модуль внутри модуля ${other}/`);
  }
  return problems;
}

/** 1.5: файл с одним содержимым (хеш байтов, без декодирования) в двух модулях — красный с обоими путями. */
export function checkCopies(repo: Repo): string[] {
  const mods = moduleDirs(repo);
  const seen = new Map<string, [string, string][]>();
  const problems: string[] = [];
  for (const f of repo.files) {
    const owner = mods.filter((m) => f.startsWith(m + "/")).sort((a, b) => b.length - a.length)[0];
    const full = path.join(repo.root, f);
    if (owner === undefined || !fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const data = fs.readFileSync(full);
    if (!data.length) continue;
    const hash = createHash("sha256").update(data).digest("hex");
    for (const [prevOwner, prev] of seen.get(hash) ?? []) if (prevOwner !== owner) problems.push(`копия в двух модулях: ${prev} и ${f}`);
    seen.set(hash, [...(seen.get(hash) ?? []), [owner, f]]);
  }
  return problems;
}

export function checkRepository(root: string): string[] {
  const repo = new Repo(root);
  return [...checkRootReadme(repo), ...checkModuleFrontmatter(repo), ...checkNestedDirs(repo), ...checkModulePlaces(repo), ...checkCopies(repo)];
}
