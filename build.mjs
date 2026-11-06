// Сборка: хост расширения — в out/, страницы — в media/. --unit — только модульные тесты, --tests — всё и тесты.
// Исходники разложены по модулям `src/<модуль>/` (F-31): у страницы точка сборки `page.ts(x)` в каталоге её модуля.
import { build } from "esbuild";
import fs from "node:fs";

const production = { "process.env.NODE_ENV": '"production"' };
const node = { bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"], logLevel: "warning" };
const web = { bundle: true, platform: "browser", format: "iife", target: "chrome120", jsx: "automatic", logLevel: "warning", define: production };

/** Страницы: точка сборки в модуле -> файл пакета. Имена в `media/` прежние: их читает код хоста и белый список `.vscodeignore`. */
const PAGES = [
  ["src/viewer/page.tsx", "media/viewer.js"],
  ["src/search/page.tsx", "media/search.js"],
  ["src/scheme/page.ts", "media/scheme.js"],
  ["src/step-help/page.tsx", "media/help.js"],
];

/**
 * Юнит-тесты: тесты модуля — в `src/<модуль>/test/`, общие и сквозные для нескольких модулей — в `test/unit/` (F-23, F-62).
 * Собираются в один плоский `out/test/`: `__dirname` теста везде один, имя файла теста одно на репозиторий.
 */
function unitTests() {
  const modules = fs.readdirSync("src", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `src/${e.name}/test`);
  const found = new Map();
  for (const dir of ["test/unit", ...modules].filter((d) => fs.existsSync(d))) {
    for (const f of fs.readdirSync(dir).filter((f) => /\.test\.tsx?$/.test(f))) {
      const name = f.replace(/\.tsx?$/, "");
      if (found.has(name)) throw new Error(`юнит-тест ${name} в двух местах: ${found.get(name)} и ${dir}/${f}`);
      found.set(name, `${dir}/${f}`);
    }
  }
  return [...found].map(([out, entry]) => ({ in: entry, out }));
}

/** Скрипт хука лежит в модуле `hook`, а код читает его по пути `hook/hook.py` пакета (F-52): копия в корне — выход сборки, как `media/`. */
function copyHook() {
  fs.mkdirSync("hook", { recursive: true });
  fs.copyFileSync("src/hook/hook.py", "hook/hook.py");
}

async function buildUnits() {
  fs.rmSync("out/test", { recursive: true, force: true });
  // Тесты хука читают корень репозитория как установленное расширение: копия скрипта нужна и им.
  copyHook();
  await build({ ...node, entryPoints: unitTests(), outdir: "out/test", jsx: "automatic", define: production });
}

if (process.argv.includes("--unit")) {
  await buildUnits();
} else {
  await build({ ...node, sourcemap: "linked", entryPoints: ["src/activation/extension.ts"], outfile: "out/extension.js" });
  for (const [entry, outfile] of PAGES) await build({ ...web, minify: true, entryPoints: [entry], outfile });
  // Файл mermaid закреплённой версии идёт в пакет как есть: у плагина и инсталлятора один номер (F-40, F-53).
  fs.copyFileSync("node_modules/mermaid/dist/mermaid.min.js", "media/mermaid.min.js");
  fs.copyFileSync("node_modules/mermaid/LICENSE", "media/mermaid.LICENSE");
  fs.copyFileSync("src/ui/style.css", "media/viewer.css");
  copyHook();
  if (process.argv.includes("--tests")) {
    await buildUnits();
    await build({ ...node, entryPoints: ["test/e2e/scenario.ts"], outfile: "out/e2e/scenario.js" });
    await build({ ...node, entryPoints: ["test/e2e/vsix-scenario.ts"], outfile: "out/e2e/vsix-scenario.js" });
    await build({ ...node, entryPoints: ["test/e2e/activation-scenario.ts"], outfile: "out/e2e/activation-scenario.js" });
    // Файлы хука ставит код плагина, а не копия формы в тесте: e2e:hook берёт их отсюда.
    await build({ ...node, entryPoints: ["src/hook/hook.ts"], outfile: "out/e2e/hook.cjs" });
    await build({ ...node, entryPoints: ["src/core/python.ts"], outfile: "out/e2e/python.cjs" });
    await build({ ...web, entryPoints: ["test/e2e/driver.ts"], outfile: "media/test-driver.js" });
  }
}
