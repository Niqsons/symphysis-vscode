// Сборка пробного расширения: логика — в out/, страницы — в media/; mermaid кладётся готовым файлом.
import { build } from "esbuild";
import fs from "node:fs";

const node = { bundle: true, platform: "node", format: "cjs", external: ["vscode"], target: "node20" };
const web = { bundle: true, platform: "browser", format: "iife", target: "chrome120" };

await build({ ...node, entryPoints: ["src/extension.ts"], outfile: "out/extension.js" });
await build({ ...node, entryPoints: ["src/scenario.ts"], outfile: "out/scenario.js" });
await build({ ...web, entryPoints: ["src/viewer/main.tsx"], outfile: "media/viewer.js", jsx: "automatic", minify: true,
  define: { "process.env.NODE_ENV": '"production"' } });
await build({ ...web, entryPoints: ["src/scheme/main.ts"], outfile: "media/scheme.js" });
fs.copyFileSync("node_modules/mermaid/dist/mermaid.min.js", "media/mermaid.min.js");
// Модульная сборка: части подгружаются по мере надобности, относительные пути сохранены.
fs.rmSync("media/esm", { recursive: true, force: true });
fs.mkdirSync("media/esm/chunks", { recursive: true });
fs.copyFileSync("node_modules/mermaid/dist/mermaid.esm.min.mjs", "media/esm/mermaid.esm.min.mjs");
fs.cpSync("node_modules/mermaid/dist/chunks/mermaid.esm.min", "media/esm/chunks/mermaid.esm.min", { recursive: true, filter: (f) => !f.endsWith(".map") });
fs.writeFileSync("media/esm-loader.mjs", `const { default: mermaid } = await import("./esm/mermaid.esm.min.mjs");
window.mermaid = mermaid;
await import("./scheme.js");
`);

for (const f of ["media/viewer.js", "media/scheme.js", "media/mermaid.min.js"]) {
  console.log(f, Math.round(fs.statSync(f).size / 1024), "КБ");
}
