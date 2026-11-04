// Расчёт справки: `step_help.py` настоящего ядра, форк заменён шимом. Подмена только там, где иначе не устроить: старое ядро, упавший Python, запись аргументов.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { copyCore, noCoreReason } from "./fixture-project";
import { FORK_APPLY, ForkShim, forkStatus, python, type ForkReplies } from "./fork-shim";
import { EXPECTED_CONTRACT, type CoreEnv } from "../../src/host/core";
import { findTools } from "../../src/host/project";
import { runPython } from "../../src/host/python";
import { stepHelp, StepHelpRunner, type HelpResult, type HelpTarget } from "../../src/host/stepHelp";
import { tempDir } from "../temp-dir.mjs";

const opts = { skip: noCoreReason };
const CHANGE = "изменение-один";

const home = (prefix: string, name: string) => {
  const dir = path.join(tempDir(prefix), name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function write(root: string, file: string, text = ""): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text, "utf8");
}

/** Папка проекта с изменениями, инструментов в ней нет. */
function bareProject(...changes: string[]): string {
  const project = home("symphysis-справка-", "проект с пробелами");
  for (const change of [CHANGE, ...changes]) fs.mkdirSync(path.join(project, "openspec", "changes", change), { recursive: true });
  return project;
}

/** Установка вне проекта: каталог с `.symphysis/tools/` настоящего ядра. */
function installation(): string {
  const dir = home("symphysis-установка-", "установка с пробелами");
  copyCore(dir);
  return dir;
}

function installedProject(...changes: string[]): string {
  const project = bareProject(...changes);
  copyCore(project);
  return project;
}

/** Окружение, как его собирает хост: общим поиском. */
function envOf(root: string, toolsPath?: string): CoreEnv {
  const found = findTools(root, toolsPath);
  assert.ok(!("kind" in found), JSON.stringify(found));
  return { python, tools: found.dir, cwd: root, installDir: found.installDir };
}

function shimOf(project: string, replies: ForkReplies = {}, change = CHANGE): ForkShim {
  return new ForkShim(path.join(tempDir("symphysis-шим-"), "шим с пробелом"), { status: forkStatus(project, change), apply: FORK_APPLY, ...replies });
}

/** Подменяет `step_help.py` по месту: старое ядро или упавший Python. */
const stubScript = (env: CoreEnv, text: string) => fs.writeFileSync(path.join(env.tools, "step_help.py"), text, "utf8");

/** Сравнение путей: на Windows без учёта регистра, Python может отдать диск другой буквой. */
const samePath = (a: string, b: string) => path.relative(a, b) === "";

const ok = (r: HelpResult) => {
  assert.ok(r.ok, JSON.stringify(r));
  return r.output;
};
const failure = (r: HelpResult) => {
  assert.ok(!r.ok, JSON.stringify(r));
  return r.failure;
};

// --- настройка: корень и `--install-dir` (F-62, F-96) ---

test("«Инструменты только по настройке»: справка считается инструментами оттуда, корень — папка проекта", opts, async () => {
  const project = bareProject();
  write(project, "openspec/schemas/symphysis/steps.md", "## intent\n\nНамерение\n\n### Зачем\n\nСмотри `src/a.py`, `src/только-в-установке.py` и `symphysis-проба`.\n");
  write(project, "src/a.py");
  const install = installation();
  write(install, "src/a.py");
  write(install, "src/только-в-установке.py");
  write(install, ".claude/skills/symphysis-проба/SKILL.md");
  const shim = shimOf(project);
  const env = envOf(project, install);
  assert.equal(env.tools, path.join(install, ".symphysis", "tools"));
  const output = ok(await stepHelp(env, CHANGE));
  assert.equal(output.error, null);
  assert.equal(output.change, CHANGE);
  assert.equal(output.current_step, "intent");
  assert.ok(shim.calls().length > 0);
  for (const call of shim.calls()) assert.ok(samePath(call.cwd, project), call.cwd);
  assert.equal(output.file_links["src/a.py"], "src/a.py");
  assert.ok(!("src/только-в-установке.py" in output.file_links), "карта считается от установки");
  const intent = output.steps.find((s) => s.id === "intent")!;
  assert.deepEqual(intent.skills, [{ name: "symphysis-проба", path: ".claude/skills/symphysis-проба/SKILL.md", base: "install" }]);
});

test("без `--change`: одно активное берётся само, несколько — список из поля `changes`", opts, async () => {
  const project = installedProject("изменение-два");
  shimOf(project, { status_all: { stdout: JSON.stringify({ changes: [{ changeName: CHANGE }, { changeName: "изменение-два" }] }) } });
  const output = ok(await stepHelp(envOf(project), null));
  assert.deepEqual(output.changes, [CHANGE, "изменение-два"]);
  assert.equal(output.current_step, null);
  assert.equal(output.error, null);
});

test("`--install-dir` подаётся только при настройке; имя изменения и путь с пробелом идут одним аргументом", opts, async () => {
  const echo = 'import json, sys\nprint(json.dumps({"contract": ' + EXPECTED_CONTRACT + ', "argv": sys.argv[1:]}))\n';
  const argv = (r: HelpResult) => (ok(r) as unknown as { argv: string[] }).argv;
  const inProject = envOf(installedProject());
  stubScript(inProject, echo);
  assert.deepEqual(argv(await stepHelp(inProject, CHANGE)), ["--change", CHANGE]);
  assert.deepEqual(argv(await stepHelp(inProject, null)), []);
  const install = installation();
  const bySetting = envOf(bareProject(), install);
  stubScript(bySetting, echo);
  assert.deepEqual(argv(await stepHelp(bySetting, CHANGE)), ["--change", CHANGE, "--install-dir", install]);
});

test("«Папка без `openspec/`»: у родителя он есть, инструменты по настройке: расчёта нет, отказ называет папку", opts, async () => {
  const parent = bareProject();
  const folder = path.join(parent, "подкаталог с пробелом");
  fs.mkdirSync(folder);
  const shim = shimOf(parent);
  const env = envOf(folder, installation());
  stubScript(env, 'raise SystemExit("расчёт пошёл")\n');
  assert.deepEqual(failure(await stepHelp(env, null)), { kind: "no-openspec", root: folder });
  assert.deepEqual(shim.calls(), []);
});

test("папка без `openspec/`, инструменты в самой папке: расчёт идёт, как у `step_help.py` из терминала", opts, async () => {
  const folder = home("symphysis-справка-", "без openspec");
  copyCore(folder);
  const shim = new ForkShim(path.join(tempDir("symphysis-шим-"), "шим"), { status_all: { stdout: JSON.stringify({ changes: [] }) } });
  const output = ok(await stepHelp(envOf(folder), null));
  assert.equal(output.current_step, "intent");
  assert.ok(shim.calls().length > 0);
});

// --- разбор вывода ---

test("«Сбой форка»: код 1 несёт JSON, он разобран; `error` дословно, тексты шагов на месте", opts, async () => {
  const project = installedProject();
  write(project, "openspec/schemas/symphysis/steps.md", "## intent\n\nНамерение\n\n### Как готовить\n\nПравила намерения.\n");
  const env = envOf(project);
  shimOf(project, { version: { stderr: "сбой форка", code: 3 } });
  const raw = await runPython(python, [path.join(env.tools, "step_help.py")], project);
  assert.equal(raw.code, 1, "у вызова код 1");
  const output = ok(await stepHelp(env, null));
  assert.equal(output.error, JSON.parse(raw.stdout).error);
  assert.match(output.error!, /упал с кодом 3: сбой форка/);
  assert.equal(output.current_step, null);
  assert.equal(output.steps.find((s) => s.id === "intent")!.texts.how_to_prepare, "Правила намерения.");
});

test("«Сбой форка»: `openspec` не найден, `error` называет это, вывод показан", opts, async () => {
  const project = installedProject();
  const env = envOf(project);
  shimOf(project);
  process.env.SYMPHYSIS_OPENSPEC = path.join(project, "нет такого форка");
  assert.match(ok(await stepHelp(env, null)).error!, /openspec не найден/);
});

function patchContract(env: CoreEnv, literal: string) {
  const file = path.join(env.tools, "journal_render.py");
  const text = fs.readFileSync(file, "utf8");
  const next = text.replace(/^CONTRACT = \d+\r?$/m, `CONTRACT = ${literal}`);
  assert.notEqual(next, text, "код ядра не подменён");
  fs.writeFileSync(file, next, "utf8");
}

test("«Номер контракта не совпал»: ядро новее — просьба про .vsix, старее — обновить инструменты, новый вывод не показан", opts, async () => {
  for (const [literal, need] of [["99", "vsix"], ["0", "tools"], ['"2"', "tools"]]) {
    const project = installedProject();
    const env = envOf(project);
    shimOf(project);
    patchContract(env, literal);
    assert.deepEqual(failure(await stepHelp(env, CHANGE)), { kind: "contract", need, root: project }, literal);
  }
});

test("«Номер контракта не совпал» при сбое форка: код 1 номер не обходит", opts, async () => {
  const project = installedProject();
  const env = envOf(project);
  shimOf(project, { version: { code: 3 } });
  patchContract(env, "99");
  assert.equal(failure(await stepHelp(env, null)).kind, "contract");
});

test("«Номер контракта не совпал» при инструментах по настройке: просьба называет установку", opts, async () => {
  const project = bareProject();
  const install = installation();
  const env = envOf(project, install);
  shimOf(project);
  patchContract(env, "0");
  assert.deepEqual(failure(await stepHelp(env, CHANGE)), { kind: "contract", need: "tools", root: install });
});

const UNREADABLE: [string, string][] = [
  ["Python упал", 'raise RuntimeError("упал")\n'],
  ["код 0, вывод не JSON", 'print("не json")\n'],
  ["код 1, вывод не JSON", 'import sys\nprint("не json")\nsys.exit(1)\n'],
  ["JSON, но не объект", "print(1)\n"],
  ["другой код при годном JSON", `import json, sys\nprint(json.dumps({"contract": ${EXPECTED_CONTRACT}}))\nsys.exit(3)\n`],
];

for (const [name, script] of UNREADABLE) {
  test(`«Вывод не JSON»: ${name} — ответ не прочитан, названа команда для терминала`, async () => {
    const project = bareProject();
    const env = { python, tools: path.join(project, ".symphysis", "tools"), cwd: project };
    write(project, ".symphysis/tools/step_help.py", script);
    assert.deepEqual(failure(await stepHelp(env, CHANGE)), { kind: "unreadable", command: `python ${path.join(".symphysis", "tools", "step_help.py")} --change ${CHANGE}` });
  });
}

test("«Вывод не JSON»: старое ядро не знает `--install-dir`, код 2, команда называет и аргумент, и установку в кавычках", async () => {
  const project = bareProject();
  const install = home("symphysis-установка-", "старая установка");
  write(install, "tools/journal.py");
  write(install, "tools/step_help.py", 'import argparse\nap = argparse.ArgumentParser()\nap.add_argument("--change")\nap.parse_args()\n');
  const env = envOf(project, install);
  const script = path.join(install, "tools", "step_help.py");
  assert.deepEqual(failure(await stepHelp(env, CHANGE)), { kind: "unreadable", command: `python "${script}" --change ${CHANGE} --install-dir "${install}"` });
});

test("Python снят по пределу: отказ `timeout`, тот же, что у журнала", async () => {
  const project = bareProject();
  const env = { python, tools: path.join(project, ".symphysis", "tools"), cwd: project };
  write(project, ".symphysis/tools/step_help.py", "import time\ntime.sleep(60)\n");
  assert.deepEqual(failure(await stepHelp(env, null, { timeoutMs: 300 })), { kind: "timeout" });
});

// --- одна цель за раз, один следующий расчёт ---

interface Harness {
  runner: StepHelpRunner;
  results: { target: HelpTarget; result: HelpResult }[];
  runs: HelpTarget[];
  mostAtOnce(): number;
}

function harness(env: CoreEnv, onResult?: () => void): Harness {
  const results: Harness["results"] = [];
  const runs: HelpTarget[] = [];
  let active = 0, most = 0;
  const runner = new StepHelpRunner({
    compute: async (target) => {
      runs.push(target);
      most = Math.max(most, ++active);
      try {
        return await stepHelp(env, target.change);
      } finally {
        active--;
      }
    },
    onResult: (target, result) => {
      results.push({ target, result });
      onResult?.();
    },
  });
  return { runner, results, runs, mostAtOnce: () => most };
}

async function untilCall(shim: ForkShim, word: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (shim.calls().some((c) => c.argv.includes(word))) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`шима не звали со словом ${word}`);
}

test("«Запись во время расчёта»: после него ещё один расчёт, одновременно не больше одного, последний видит запись", opts, async () => {
  const project = installedProject();
  const shim = shimOf(project, { status: { ...forkStatus(project, CHANGE), hang: 0.5 } });
  const { runner, results, runs, mostAtOnce } = harness(envOf(project));
  const target = { root: project, change: CHANGE };
  runner.request(target);
  await untilCall(shim, "status");
  // Запись пришла: файл появился, а идущий расчёт о нём не знает.
  shim.answer({ status: forkStatus(project, CHANGE, "done"), apply: FORK_APPLY });
  for (let i = 0; i < 5; i++) runner.request(target);
  await runner.whenIdle();
  assert.equal(runs.length, 2, "записи склеились в один следующий расчёт");
  assert.equal(mostAtOnce(), 1);
  assert.deepEqual(results.map((r) => ok(r.result).current_step), ["intent", "decisions"]);
});

test("«Расчёт прежнего закончился позже»: идёт расчёт для А, открыт журнал Б: ответ для А не показан, Б показан", opts, async () => {
  const project = installedProject("изменение-два");
  const shim = shimOf(project, { status: { ...forkStatus(project, CHANGE), hang: 0.5 } });
  const { runner, results, runs, mostAtOnce } = harness(envOf(project));
  const a = { root: project, change: CHANGE };
  const b = { root: project, change: "изменение-два" };
  runner.request(a);
  await untilCall(shim, "status");
  runner.request(b);
  await runner.whenIdle();
  assert.deepEqual(runs, [a, b], "расчёт А шёл до конца, следующий — для Б");
  assert.equal(mostAtOnce(), 1);
  assert.deepEqual(results.map((r) => r.target), [b]);
  assert.equal(ok(results[0].result).change, "изменение-два");
});

test("цель вернулась, пока шёл расчёт другой: последней просьбе ответ, просьба посередине не считается", opts, async () => {
  const project = installedProject("изменение-два", "изменение-три");
  const shim = shimOf(project, { status: { ...forkStatus(project, CHANGE), hang: 0.5 } });
  const { runner, results, runs } = harness(envOf(project));
  const a = { root: project, change: CHANGE };
  runner.request(a);
  await untilCall(shim, "status");
  runner.request({ root: project, change: "изменение-два" });
  runner.request({ root: project, change: "изменение-три" });
  await runner.whenIdle();
  assert.deepEqual(runs.map((t) => t.change), [CHANGE, "изменение-три"]);
  assert.deepEqual(results.map((r) => r.target.change), ["изменение-три"]);
});

test("цели в двух папках с одним именем изменения разные: ответ для прежней папки отброшен", opts, async () => {
  const first = installedProject();
  const second = installedProject();
  const shim = shimOf(first, { status: { ...forkStatus(first, CHANGE), hang: 0.5 } });
  const { runner, results } = harness(envOf(first));
  runner.request({ root: first, change: CHANGE });
  await untilCall(shim, "status");
  runner.request({ root: second, change: CHANGE });
  await runner.whenIdle();
  assert.deepEqual(results.map((r) => r.target.root), [second]);
});

test("исключение в расчёте становится отказом, следующий расчёт идёт", opts, async () => {
  const project = installedProject();
  shimOf(project);
  const { runner, results } = harness(envOf(project));
  // Настоящий отказ `execFile`: нулевой байт в аргументе.
  runner.request({ root: project, change: "имя\0с нулём" });
  await runner.whenIdle();
  const refused = failure(results[0].result);
  assert.ok(refused.kind === "crash" && refused.text.length > 0, JSON.stringify(refused));
  runner.request({ root: project, change: CHANGE });
  await runner.whenIdle();
  assert.equal(ok(results[1].result).change, CHANGE);
});

test("получатель ответа упал: следующий расчёт идёт", opts, async () => {
  const project = installedProject();
  shimOf(project);
  let first = true;
  const { runner, results } = harness(envOf(project), () => {
    if (first) {
      first = false;
      throw new Error("страницы уже нет");
    }
  });
  const target = { root: project, change: CHANGE };
  runner.request(target);
  await runner.whenIdle();
  runner.request(target);
  await runner.whenIdle();
  assert.equal(results.length, 2);
});

test("просьба не ждёт расчёта: возврат до запуска, расчёт идёт после", async () => {
  const started: HelpTarget[] = [];
  const runner = new StepHelpRunner({
    compute: async (target) => {
      started.push(target);
      return { ok: false, failure: { kind: "timeout" } };
    },
    onResult: () => undefined,
  });
  runner.request({ root: "папка", change: null });
  assert.deepEqual(started, []);
  await runner.whenIdle();
  assert.deepEqual(started, [{ root: "папка", change: null }]);
});
