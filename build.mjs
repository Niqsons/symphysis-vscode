// Сборка: хост расширения — в out/, страницы — в media/. --unit — только модульные тесты, --tests — всё и тесты.
// Исходники разложены по модулям `src/<модуль>/` (F-31): у страницы точка сборки `page.ts(x)` в каталоге её модуля.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { checkWorktreePath } from "./test/worktree-paths.mjs";

const production = { "process.env.NODE_ENV": '"production"' };
const node = { bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"], logLevel: "warning" };
const web = { bundle: true, platform: "browser", format: "iife", target: "chrome120", jsx: "automatic", logLevel: "warning", define: production };

/** Страницы: точка сборки в модуле -> файл пакета. Имена в `media/` прежние: их читает код хоста и белый список `.vscodeignore`. */
const PAGES = [
  ["src/viewer/page.tsx", "media/viewer.js"],
  ["src/search/page.tsx", "media/search.js"],
  ["src/scheme/page.ts", "media/scheme.js"],
  ["src/req-graph/page.ts", "media/req-graph.js"],
  ["src/step-help/page.tsx", "media/help.js"],
];
const TESTS = [
  ["test/e2e/scenario.ts", "out/e2e/scenario.js"],
  ["test/e2e/vsix-scenario.ts", "out/e2e/vsix-scenario.js"],
  ["test/e2e/activation-scenario.ts", "out/e2e/activation-scenario.js"],
  ["src/hook/hook.ts", "out/e2e/hook.cjs"],
  ["src/core/python.ts", "out/e2e/python.cjs"],
];

/**
 * Юнит-тесты: тесты модуля — в `src/<модуль>/test/`, общие и сквозные для нескольких модулей — в `test/unit/` (F-23, F-62).
 * Собираются в один плоский `out/test/`: `__dirname` теста везде один, имя файла теста одно на репозиторий.
 */
function unitTests() {
  safeBuildPath("src");
  const modules = fs.readdirSync("src", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `src/${e.name}/test`);
  const found = new Map();
  for (const dir of ["test/unit", ...modules]) {
    safeBuildPath(dir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => /\.test\.tsx?$/.test(f))) {
      const name = f.replace(/\.tsx?$/, "");
      if (found.has(name)) throw new Error(`юнит-тест ${name} в двух местах: ${found.get(name)} и ${dir}/${f}`);
      found.set(name, `${dir}/${f}`);
    }
  }
  return [...found].map(([out, entry]) => ({ in: entry, out }));
}

/** Скрипт хука лежит в модуле `hook`, а код читает его по пути `hook/hook.py` пакета (F-52): копия в корне — выход сборки, как `media/`. */
function checkHook() {
  safeBuildPath("src/hook/hook.py");
  safeBuildPath("hook/hook.py");
}

function copyHook() {
  fs.mkdirSync("hook", { recursive: true });
  fs.copyFileSync("src/hook/hook.py", "hook/hook.py");
}

const safeBuildPath = (name) => checkWorktreePath(process.cwd(), name);

function checkedUnitInputs(selected) {
  const entries = unitTests();
  const byPath = new Map(entries.map((entry) => [entry.in, entry]));
  if (selected !== undefined) {
    if (!selected.length || new Set(selected).size !== selected.length) throw new Error("Пустой или повторный список юнит-тестов");
    for (const input of selected) {
      if (!byPath.has(input)) throw new Error(`Выбранный вход юнит-тестов недоступен: ${input}`);
    }
  }
  const inputs = selected === undefined ? entries : selected.map((input) => byPath.get(input));
  for (const { in: entry } of inputs) safeBuildPath(entry);
  safeBuildPath("out/test");
  checkHook();
  return inputs;
}

async function buildUnits(inputs) {
  fs.rmSync("out/test", { recursive: true, force: true });
  // Тесты хука читают корень репозитория как установленное расширение: копия скрипта нужна и им.
  copyHook();
  await build({ ...node, entryPoints: inputs, outdir: "out/test", jsx: "automatic", define: production });
}

const args = process.argv.slice(2);
if (args.includes("--unit")) {
  const separator = args.indexOf("--");
  if (separator !== -1 && (separator !== 1 || args[0] !== "--unit"))
    throw new Error("Для списка входов используй --unit -- <пути>");
  await buildUnits(checkedUnitInputs(separator !== -1 ? args.slice(separator + 1) : undefined));
} else {
  const withTests = args.includes("--tests");
  const inputs = withTests ? checkedUnitInputs() : [];
  checkHook();
  for (const name of ["src/activation/extension.ts", "out/extension.js", "out/extension.js.map",
    "media/mermaid.min.js", "media/mermaid.LICENSE", "src/ui/style.css", "media/viewer.css", ...PAGES.flat(),
    ...(withTests ? [...TESTS.flat(), "test/e2e/driver.ts", "media/test-driver.js"] : [])]) safeBuildPath(name);
  await build({ ...node, sourcemap: "linked", entryPoints: ["src/activation/extension.ts"], outfile: "out/extension.js" });
  for (const [entry, outfile] of PAGES) await build({ ...web, minify: true, entryPoints: [entry], outfile });
  // Файл mermaid закреплённой версии идёт в пакет как есть: у плагина и инсталлятора один номер (F-40, F-53).
  fs.copyFileSync("node_modules/mermaid/dist/mermaid.min.js", "media/mermaid.min.js");
  fs.copyFileSync("node_modules/mermaid/LICENSE", "media/mermaid.LICENSE");
  fs.copyFileSync("src/ui/style.css", "media/viewer.css");
  copyHook();
  if (withTests) {
    await buildUnits(inputs);
    // Файлы хука ставит код плагина, а не копия формы в тесте: e2e:hook берёт их отсюда.
    for (const [entry, outfile] of TESTS) await build({ ...node, entryPoints: [entry], outfile });
    await build({ ...web, entryPoints: ["test/e2e/driver.ts"], outfile: "media/test-driver.js" });
  }
}
