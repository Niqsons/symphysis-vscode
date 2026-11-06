// Общее для запусков в настоящем VS Code: пути, проект с инструментами symphysis, чистое окружение, отчёт о шагах.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installCore, resolveCore } from "../core-files.mjs";
import { keepTemp } from "../temp-dir.mjs";

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CODE = process.env.SYMPHYSIS_CODE ?? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe");
// Без `SYMPHYSIS_ROOT` — соседний клон; заданный путь без ядра модульной раскладки — отказ сразу (F-09, F-61).
const core = resolveCore(process.env, path.resolve(repo, "..", "symphysis"));
export const SYMPHYSIS = core.root;
export const fixtures = path.join(repo, "test", "fixtures");

/** Проект с установленными инструментами symphysis: как после `symphysis install`, корень для улик — сам проект. */
export function projectWithTools(project) {
  if (core.missing) throw new Error(`${core.missing}; укажи SYMPHYSIS_ROOT`);
  const tools = installCore(SYMPHYSIS, project);
  fs.writeFileSync(path.join(tools, "journal-roots.json"), '{"": "<root>/.."}\n', "utf8");
  fs.writeFileSync(path.join(project, "intent.md"), "Надо показать журнал человеку.\n", "utf8");
}

export function addChange(project, name) {
  const dir = path.join(project, "openspec", "changes", name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Из терминала VS Code наследуется ELECTRON_RUN_AS_NODE, а среда агента ставит NoDefaultCurrentDirectoryInExePath и PYTHONIOENCODING — у пользователя их нет. */
export function cleanEnv() {
  for (const k of Object.keys(process.env)) {
    if (/^(VSCODE_|ELECTRON_|NoDefaultCurrentDirectoryInExePath$|PYTHONIOENCODING$)/i.test(k)) delete process.env[k];
  }
}

/** Конец прогона: зелёный снимает свой каталог при выходе, красный оставляет его для разбора и называет. */
export function finish(work, code) {
  if (code) {
    keepTemp(work);
    console.log(`каталог прогона оставлен: ${work}`);
  }
  process.exit(code);
}

/** Печатает шаги из файла результатов; возвращает код выхода. */
export function report(results) {
  if (!fs.existsSync(results)) {
    console.error("нет файла результатов");
    return 1;
  }
  const r = JSON.parse(fs.readFileSync(results, "utf8"));
  for (const t of r.tests) console.log(`${t.ok ? "✔" : "✖"} ${t.name}${t.ms !== undefined ? ` (${t.ms} мс)` : ""}${t.error ? `\n   ${t.error}` : ""}`);
  console.log(JSON.stringify(r.measures, null, 1));
  console.log(`итого ${r.tests.length}, упало ${r.tests.filter((t) => !t.ok).length}`);
  return r.tests.some((t) => !t.ok) ? 1 : 0;
}
