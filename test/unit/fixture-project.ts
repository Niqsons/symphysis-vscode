// Установленный проект во временном каталоге с кириллицей и пробелами: ядро — файлы модулей соседнего клона symphysis,
// сведённые в плоские `.symphysis/tools/` и `.symphysis/docs/`, как их ставит установка (`test/core-files.mjs`).
import fs from "node:fs";
import path from "node:path";
import { coreRoot, installCore, resolveCore } from "../core-files.mjs";
import { tempDir } from "../temp-dir.mjs";

export { coreRoot };

// Без `SYMPHYSIS_ROOT` — соседний клон; заданный путь без ядра модульной раскладки — отказ, а не пропуск (F-09, F-61).
const core = resolveCore(process.env, path.resolve(__dirname, "..", "..", "..", "symphysis"));
export const SYMPHYSIS = core.root;
export const hasCore = core.missing === null;
export const noCoreReason = hasCore ? false : `${core.missing}; укажи SYMPHYSIS_ROOT`;
const FIXTURES = path.resolve(__dirname, "..", "..", "test", "fixtures");

export function copyCore(project: string): string {
  const tools = installCore(SYMPHYSIS, project);
  // Как у установщика: у файла корней репозитория нет корня для всего проекта, и улики там дают «корня для пути нет».
  fs.writeFileSync(path.join(tools, "journal-roots.json"), JSON.stringify({ "": "<root>/.." }), "utf8");
  return tools;
}

export function makeProject(changeName = "изменение один"): { project: string; tools: string; change: string } {
  const project = path.join(tempDir("symphysis-"), "проект с пробелами");
  fs.mkdirSync(project, { recursive: true });
  const tools = copyCore(project);
  fs.writeFileSync(path.join(project, "intent.md"), "Надо показать журнал человеку.\n", "utf8");
  const change = path.join(project, "openspec", "changes", changeName);
  fs.mkdirSync(change, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, "decisions.json"), path.join(change, "decisions.json"));
  return { project, tools, change };
}

export function addAttack(change: string, name = "decisions.md", text?: string): string {
  fs.mkdirSync(path.join(change, "attack"), { recursive: true });
  const file = path.join(change, "attack", name);
  if (text === undefined) fs.copyFileSync(path.join(FIXTURES, "attack-decisions.md"), file);
  else fs.writeFileSync(file, text, "utf8");
  return file;
}
