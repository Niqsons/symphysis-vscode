import { checkWorktreePath } from "../worktree-paths.mjs";

const runs = {
  e2e: {
    inputs: ["run.mjs", "scenario.ts"],
    outputs: ["scenario.js", "results.json"],
    fixtures: ["decisions.json", "attack-rich.md"],
  },
  "e2e:activation": {
    inputs: ["activation.mjs", "activation-scenario.ts"],
    outputs: ["activation-scenario.js", "activation-results.json"],
    fixtures: ["decisions.json"],
  },
  "e2e:graph": {
    inputs: ["req-graph.mjs", "req-graph-scenario.ts"],
    outputs: ["req-graph-scenario.js", "req-graph-results.json"],
    fixtures: ["decisions.json"],
  },
  "e2e:reload": {
    inputs: ["reload.mjs", "reload-host/package.json", "reload-host/extension.js"],
    outputs: ["reload-results.json"],
    fixtures: ["decisions.json"],
  },
  "e2e:vsix": {
    inputs: ["vsix.mjs", "vsix-scenario.ts", "vsix-host/package.json"],
    outputs: ["vsix-scenario.js", "vsix-results.json"],
    fixtures: ["decisions.json", "attack-rich.md"],
    packaging: ["package.mjs", "docs/package-readme.md", ".vscodeignore", "media/icon.svg"],
  },
};

/** Одни границы для прямого запуска сценария и проверки перед npm. */
export function checkE2ePaths(root, script) {
  if (!Object.hasOwn(runs, script)) throw new Error(`Неизвестный сквозной сценарий: ${script}`);
  const { inputs, outputs, fixtures, packaging = [] } = runs[script];
  for (const name of outputs) checkWorktreePath(root, `out/e2e/${name}`);
  for (const name of [
    "package.json", "test/e2e/harness.mjs", ...inputs.map((name) => `test/e2e/${name}`),
    ...fixtures.map((name) => `test/fixtures/${name}`), ...packaging,
  ]) checkWorktreePath(root, name, { required: true });
}
