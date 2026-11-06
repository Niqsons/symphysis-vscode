// Сборка: хост расширения — в out/, страницы — в media/. --unit — только модульные тесты, --tests — всё и тесты.
// Исходники разложены по модулям `src/<модуль>/` (F-31): у страницы точка сборки `page.ts(x)` в каталоге её модуля.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

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

async function buildUnits() {
  fs.rmSync("out/test", { recursive: true, force: true });
  const units = fs.readdirSync("test/unit").filter((f) => /\.test\.tsx?$/.test(f)).map((f) => path.join("test/unit", f));
  await build({ ...node, entryPoints: units, outdir: "out/test", jsx: "automatic", define: production });
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
