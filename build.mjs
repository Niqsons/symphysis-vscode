// Сборка: хост расширения — в out/, страница просмотрщика — в media/. --unit — только модульные тесты, --tests — всё и тесты.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const production = { "process.env.NODE_ENV": '"production"' };
const node = { bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"], logLevel: "warning" };
const web = { bundle: true, platform: "browser", format: "iife", target: "chrome120", jsx: "automatic", logLevel: "warning", define: production };

async function buildUnits() {
  fs.rmSync("out/test", { recursive: true, force: true });
  const units = fs.readdirSync("test/unit").filter((f) => /\.test\.tsx?$/.test(f)).map((f) => path.join("test/unit", f));
  await build({ ...node, entryPoints: units, outdir: "out/test", jsx: "automatic", define: production });
}

if (process.argv.includes("--unit")) {
  await buildUnits();
} else {
  await build({ ...node, sourcemap: "linked", entryPoints: ["src/extension.ts"], outfile: "out/extension.js" });
  await build({ ...web, minify: true, entryPoints: ["src/webview/main.tsx"], outfile: "media/viewer.js" });
  await build({ ...web, minify: true, entryPoints: ["src/webview/search.tsx"], outfile: "media/search.js" });
  fs.copyFileSync("src/webview/style.css", "media/viewer.css");
  if (process.argv.includes("--tests")) {
    await buildUnits();
    await build({ ...node, entryPoints: ["test/e2e/scenario.ts"], outfile: "out/e2e/scenario.js" });
    await build({ ...web, entryPoints: ["test/e2e/driver.ts"], outfile: "media/test-driver.js" });
  }
}
