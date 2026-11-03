// Проект для показа: копии настоящих журналов и их атак, ядро свежее, улики сверяются с настоящими файлами репозитория symphysis.
// «Внести» пишет только в копию. Запуск: node test/e2e/demo.mjs <каталог>, дальше — команда, которую он печатает.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SYMPHYSIS = process.env.SYMPHYSIS_ROOT || path.resolve(repo, "..", "symphysis");
const target = process.argv[2];
if (!target) throw new Error("нужен каталог: node test/e2e/demo.mjs <каталог>");
if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`каталог не пуст: ${target}`);

const tools = path.join(target, ".symphysis", "tools");
fs.mkdirSync(tools, { recursive: true });
for (const f of fs.readdirSync(path.join(SYMPHYSIS, "tools"))) {
  if (/^(journal.*\.py|step_help\.py|playground-template\.html)$/.test(f)) fs.copyFileSync(path.join(SYMPHYSIS, "tools", f), path.join(tools, f));
}
const installed = path.join(SYMPHYSIS, ".symphysis", "tools", "journal-roots.json");
const roots = fs.existsSync(installed) ? JSON.parse(fs.readFileSync(installed, "utf8")) : {};
fs.writeFileSync(path.join(tools, "journal-roots.json"), JSON.stringify({ ...roots, "": SYMPHYSIS }, null, 1), "utf8");
fs.mkdirSync(path.join(target, ".symphysis", "docs"), { recursive: true });
fs.copyFileSync(path.join(SYMPHYSIS, "docs", "journal.schema.json"), path.join(target, ".symphysis", "docs", "journal.schema.json"));

const changes = path.join(SYMPHYSIS, "openspec", "changes");
for (const name of fs.readdirSync(changes)) {
  const from = path.join(changes, name);
  if (name === "archive" || !fs.existsSync(path.join(from, "decisions.json"))) continue;
  const to = path.join(target, "openspec", "changes", name);
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(path.join(from, "decisions.json"), path.join(to, "decisions.json"));
  if (fs.existsSync(path.join(from, "scheme.md"))) fs.copyFileSync(path.join(from, "scheme.md"), path.join(to, "scheme.md"));
  // Не fs.cpSync: в Node 24 на Windows с кириллицей в пути он молча не копирует или роняет процесс.
  if (fs.existsSync(path.join(from, "attack"))) {
    fs.mkdirSync(path.join(to, "attack"));
    for (const f of fs.readdirSync(path.join(from, "attack"))) fs.copyFileSync(path.join(from, "attack", f), path.join(to, "attack", f));
  }
}
const sample = path.join(target, "openspec", "changes", "образец-все-виды");
fs.mkdirSync(sample, { recursive: true });
fs.copyFileSync(path.join(repo, "test", "fixtures", "decisions.json"), path.join(sample, "decisions.json"));
// Образец вкладки схемы: у записей есть узлы, и клик по рисунку фильтрует карточки.
const schemeSample = path.join(target, "openspec", "changes", "образец-со-схемой");
fs.mkdirSync(schemeSample, { recursive: true });
const journal = JSON.parse(fs.readFileSync(path.join(repo, "test", "fixtures", "decisions.json"), "utf8"));
const nodesOf = { "F-02": ["A"], "F-03": ["B", "узел1"], "F-04": ["Призрак"] };
for (const rec of journal.records) if (nodesOf[rec.id]) rec.nodes = nodesOf[rec.id];
fs.writeFileSync(path.join(schemeSample, "decisions.json"), JSON.stringify(journal, null, 1), "utf8");
fs.writeFileSync(path.join(schemeSample, "scheme.md"), "# Схема решения\n\n```mermaid\nflowchart TD\n  A[начало работы] --> B[дальше]\n  B --> узел1[узел с кириллицей]\n  B --> C[узел без записей]\n```\n", "utf8");
fs.writeFileSync(path.join(target, "intent.md"), "Надо показать журнал человеку.\n", "utf8");

console.log(`code --extensionDevelopmentPath="${repo}" "${path.resolve(target)}"`);
