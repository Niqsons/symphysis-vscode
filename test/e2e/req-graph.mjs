// Req-graph в настоящем webview с закреплённым локальным Mermaid.
import { build } from "esbuild";
import { runTests } from "@vscode/test-electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { tempDir } from "../temp-dir.mjs";
import { cleanEnv, CODE, finish, projectWithTools, repo, report, SYMPHYSIS } from "./harness.mjs";

await build({ bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"],
  entryPoints: [path.join(repo, "test/e2e/req-graph-scenario.ts")], outfile: path.join(repo, "out/e2e/req-graph-scenario.js") });
const work = tempDir("symphysis-req-graph-");
const project = path.join(work, "проект с пробелами");
projectWithTools(project);
cleanEnv();
const results = path.join(repo, "out/e2e/req-graph-results.json");
const untrusted = process.argv.includes("--untrusted");
const extensionArgument = process.argv.indexOf("--extension");
const extensionRoot = extensionArgument >= 0 ? path.resolve(process.argv[extensionArgument + 1]) : repo;
if (extensionRoot !== repo) {
  // Пакет уже установлен штатным CLI. Для прогона его кода в Test mode добавляется только водитель страницы.
  fs.copyFileSync(path.join(repo, "media/test-driver.js"), path.join(extensionRoot, "media/test-driver.js"));
}
if (untrusted) {
  fs.mkdirSync(path.join(work, "profile/User"), { recursive: true });
  fs.writeFileSync(path.join(work, "profile/User/settings.json"), JSON.stringify({ "security.workspace.trust.startupPrompt": "never" }));
}
let code = 0;
try {
  const launchArgs = [project, "--disable-extensions", "--user-data-dir", path.join(work, "profile"),
    "--extensions-dir", path.join(work, "extensions"), "--skip-welcome", "--skip-release-notes"];
  const testEnv = { SYMPHYSIS_ROOT: SYMPHYSIS, SYMPHYSIS_E2E_RESULTS: results, SYMPHYSIS_GRAPH_UNTRUSTED: untrusted ? "1" : "",
    SYMPHYSIS_GRAPH_FIXTURES: path.join(repo, "test/fixtures") };
  if (untrusted) {
    // runTests сам добавляет --disable-workspace-trust. Этот контроль запускает тестовый хост с включённым Trust.
    await new Promise((resolve, reject) => {
      const child = spawn(CODE, [...launchArgs, `--extensionDevelopmentPath=${extensionRoot}`,
        `--extensionTestsPath=${path.join(repo, "out/e2e/req-graph-scenario.js")}`],
        { env: { ...process.env, ...testEnv }, windowsHide: true, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (status) => status === 0 ? resolve() : reject(new Error(`Restricted Mode host exit ${status}`)));
    });
  } else await runTests({ vscodeExecutablePath: CODE, extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: path.join(repo, "out/e2e/req-graph-scenario.js"),
    extensionTestsEnv: testEnv, launchArgs });
} catch (error) {
  console.error(String(error));
  code = 1;
}
if (report(results)) code = 1;
finish(work, code);
