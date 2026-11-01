// Установленный проект во временном каталоге с кириллицей и пробелами: ядро — копия `tools/` соседнего репозитория symphysis.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SYMPHYSIS = process.env.SYMPHYSIS_ROOT ?? path.resolve(__dirname, "..", "..", "..", "symphysis");
export const hasCore = fs.existsSync(path.join(SYMPHYSIS, "tools", "journal.py"));
export const noCoreReason = hasCore ? false : `нет ядра symphysis в ${SYMPHYSIS}; укажи SYMPHYSIS_ROOT`;
const FIXTURES = path.resolve(__dirname, "..", "..", "test", "fixtures");

export function copyCore(project: string): string {
  const tools = path.join(project, ".symphysis", "tools");
  fs.mkdirSync(tools, { recursive: true });
  for (const f of fs.readdirSync(path.join(SYMPHYSIS, "tools"))) {
    if (/^(journal.*\.(py|json)|playground-template\.html)$/.test(f)) fs.copyFileSync(path.join(SYMPHYSIS, "tools", f), path.join(tools, f));
  }
  // Как у установщика: у файла корней репозитория нет корня для всего проекта, и улики там дают «корня для пути нет».
  fs.writeFileSync(path.join(tools, "journal-roots.json"), JSON.stringify({ "": "<root>/.." }), "utf8");
  fs.mkdirSync(path.join(project, ".symphysis", "docs"), { recursive: true });
  fs.copyFileSync(path.join(SYMPHYSIS, "docs", "journal.schema.json"), path.join(project, ".symphysis", "docs", "journal.schema.json"));
  return tools;
}

export function makeProject(changeName = "изменение один"): { project: string; tools: string; change: string } {
  const project = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "symphysis-")), "проект с пробелами");
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
