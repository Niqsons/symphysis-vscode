// Ядро из клона symphysis для тестов плагина. Клон разложен по модулям (F-18, F-61), установка плоская: код и данные
// модулей — в `.symphysis/tools/`, общие файлы скиллов — в `.symphysis/docs/` (F-19, F-41). Раскладку клона знает только
// этот файл; его читают модульные тесты (`test/unit/fixture-project.ts`, тест справки) и сквозные (`test/e2e/harness.mjs`, `demo.mjs`).
import fs from "node:fs";
import path from "node:path";
import { bigJournal } from "./core-journals.mjs";

/** Точка входа ядра в клоне: по ней тесты узнают ядро модульной раскладки. */
export const CORE_ENTRY = "cli/journal.py";

/** Код и данные модулей, которые установка кладёт в `.symphysis/tools/`: тот же список, что `TOOLS_FILES` в `installer/scripts/sync-payload.js` ядра. */
export const TOOLS_FILES = [
  "cli/journal.py",
  "cli/journal_cli.py",
  "decisions/journal_model.py",
  "decisions/journal_render.py",
  "decisions/journal_apply.py",
  "decisions/journal.schema.json",
  "roots/roots.py",
  "viewer/viewer_render.py",
  "viewer/playground-template.html",
  "attack/attack_table.py",
  "attack/attack_scope.py",
  "consequences/journal_sites.py",
  "consequences/journal_consequences.py",
  "settings/symphysis_config.py",
  "step-help/step_help.py",
  "openspec-run/openspec_run.py",
  "runtime/runtime_context.py",
  "trace/trace_graph.py",
  "trace/trace_modules.py",
  "anchors/anchor_refs.py",
  "anchors/sync_check.py",
];

/** Общие файлы скиллов, которые установка кладёт в `.symphysis/docs/`: `SHARED_FILES` того же файла ядра. */
export const DOCS_FILES = ["skill-shared/terms.md", "skill-shared/driver.md", "decisions/candidate.md", "cli/journal-cli.md", "settings/config.md", "attack/attack-table.md", "trace/module-declarations.md"];

/** Пустая переменная считается незаданной. */
export const coreRoot = (env, sibling) => env.SYMPHYSIS_ROOT || sibling;

const at = (root, rel) => path.join(root, ...rel.split("/"));

/** Проверяет физический путь входа до чтения из выбранного дерева. */
function checkedSource(root, rel) {
  const canonical = fs.realpathSync(root);
  const candidate = at(canonical, rel);
  if (!fs.existsSync(candidate)) throw new Error(`Недоступен вход ядра: ${rel}`);
  const source = fs.realpathSync(candidate);
  const relative = path.relative(canonical, source);
  if (path.isAbsolute(relative) || relative.split(path.sep)[0] === ".." || !fs.statSync(source).isFile())
    throw new Error(`Вход ядра вне выбранного дерева или недоступен: ${rel}`);
  return source;
}

/** Разрешает весь комплект до создания установленной копии. */
export function checkCoreFiles(root) {
  return new Map([...TOOLS_FILES, ...DOCS_FILES].map((rel) => [rel, checkedSource(root, rel)]));
}

/** Дополнительные файлы ядра, которые отдельные проверки читают из клона. */
export function checkCoreFixtures(root, name) {
  const fixtures = {
    "test/unit/core-files.test.ts": ["installer/scripts/sync-payload.js"],
    "test/unit/contract.test.ts": ["tests/fixtures/viewer-smoke.js"],
    "src/scheme/test/scheme.test.ts": ["tests/fixtures/scheme/cases.json", "installer/package.json"],
    "src/step-help/test/help-view.test.tsx": ["openspec/schemas/symphysis/steps.md"],
    "src/step-help/test/step-help.test.ts": forkFixtures(),
    e2e: ["tests/fixtures/scheme/wide.md", ...forkFixtures()],
    "e2e:activation": forkFixtures(),
    "e2e:reload": forkFixtures(),
  };
  for (const rel of fixtures[name] ?? []) checkedSource(root, rel);
  if (name === "e2e" || name === "test/unit/contract.test.ts") {
    const journal = bigJournal(root);
    const canonical = fs.realpathSync(root);
    const attack = path.join(journal.dir, "attack");
    if (name === "e2e" && fs.existsSync(attack)) {
      const check = (file) => checkedSource(canonical, path.relative(canonical, file).split(path.sep).join("/"));
      const relative = path.relative(canonical, fs.realpathSync(attack));
      if (path.isAbsolute(relative) || relative.split(path.sep)[0] === "..")
        throw new Error(`Каталог атаки вне выбранного дерева ядра: ${attack}`);
      for (const name of fs.readdirSync(attack)) check(path.join(attack, name));
    }
  }
}

function forkFixtures() {
  return ["tests/fixtures/fork-shim/fork_shim.py",
    `tests/fixtures/fork-shim/${process.platform === "win32" ? "openspec.cmd" : "openspec"}`];
}

/** Почему в каталоге нет ядра модульной раскладки; `null` — ядро есть. */
export function coreMissing(root) {
  if (fs.existsSync(at(root, CORE_ENTRY))) {
    try { checkedSource(root, CORE_ENTRY); } catch (error) { return error.message; }
    return null;
  }
  if (fs.existsSync(path.join(root, "tools", "journal.py"))) return `в ${root} ядро прежней раскладки (tools/journal.py), тестам нужна модульная: ${CORE_ENTRY}`;
  return `в ${root} нет ${CORE_ENTRY}`;
}

/**
 * Ядро для тестов: корень и причина, по которой ядра нет. Заданный `SYMPHYSIS_ROOT` без ядра — опечатка, а не «ядра нет
 * на этой машине»: отказ, иначе тесты на настоящем ядре пропустились бы молча и прогон был бы ложно зелёным (F-09).
 */
export function resolveCore(env, sibling) {
  const root = coreRoot(env, sibling);
  const missing = coreMissing(root);
  if (env.SYMPHYSIS_ROOT && missing) throw new Error(`SYMPHYSIS_ROOT=${root}: ${missing}; тесты на настоящем ядре не запустить`);
  return { root, missing };
}

/** Исходник файла установки в клоне: имя в `.symphysis/tools/` -> путь в модуле. Имени нет в списке — отказ. */
export function coreSource(root, name) {
  const rel = TOOLS_FILES.find((f) => path.posix.basename(f) === name);
  if (!rel) throw new Error(`${name}: файла нет в списке установки TOOLS_FILES`);
  return checkedSource(root, rel);
}

/**
 * Ставит ядро клона `root` в `project`, как установка: файлы модулей — в плоские `.symphysis/tools/` и `.symphysis/docs/`.
 * Файла корней улик здесь нет: его пишет вызывающий. Файла в клоне нет — отказ с путём, а не неполная установка.
 */
export function installCore(root, project) {
  const sources = checkCoreFiles(root);
  const tools = path.join(project, ".symphysis", "tools");
  const docs = path.join(project, ".symphysis", "docs");
  fs.mkdirSync(tools, { recursive: true });
  fs.mkdirSync(docs, { recursive: true });
  for (const rel of TOOLS_FILES) fs.copyFileSync(sources.get(rel), path.join(tools, path.posix.basename(rel)));
  for (const rel of DOCS_FILES) fs.copyFileSync(sources.get(rel), path.join(docs, path.posix.basename(rel)));
  return tools;
}
