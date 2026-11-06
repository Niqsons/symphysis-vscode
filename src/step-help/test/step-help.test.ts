// Расчёт справки: `step_help.py` настоящего ядра, форк заменён шимом. Подмена только там, где иначе не устроить: старое ядро, упавший Python, запись аргументов.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { copyCore, noCoreReason } from "../../../test/unit/fixture-project";
import { FORK_APPLY, forkShim, forkStatus, forkStatusAll, python, type ForkReplies, type ForkShim } from "../../../test/unit/fork-shim";
import { EXPECTED_CONTRACT, type CoreEnv } from "../../core/core";
import { resolveSkill } from "../../file-links/resolve";
import { changeDir, findTools, listChanges } from "../../core/project";
import { runPython } from "../../core/python";
import { chooseTarget, computeHelp, stepHelp, StepHelpRunner, type HelpResult, type HelpTarget } from "../stepHelp";
import type { CoreFailure, HelpOutcome } from "../../protocol/protocol";
import { tempDir } from "../../../test/temp-dir.mjs";

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
  return forkShim(path.join(tempDir("symphysis-шим-"), "шим с пробелом"), { status: forkStatus(project, change), apply: FORK_APPLY, ...replies });
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
  assert.equal(output.file_links!["src/a.py"], "src/a.py");
  assert.ok(!("src/только-в-установке.py" in output.file_links!), "карта считается от установки");
  const intent = output.steps.find((s) => s.id === "intent")!;
  assert.deepEqual(intent.skills, [{ name: "symphysis-проба", path: ".claude/skills/symphysis-проба/SKILL.md", base: "install" }]);
});

test("«Скилл по настройке»: клон модульной раскладки, установленный в себя: ядро ищет скилл в каталогах модулей клона, клик открывает его же файл (F-42, F-45)", opts, async () => {
  const project = bareProject();
  write(project, "openspec/schemas/symphysis/steps.md", "## intent\n\nНамерение\n\n### Зачем\n\nЗови `symphysis-проба`.\n");
  const clone = home("symphysis-клон-", "клон с пробелами");
  copyCore(clone);
  const skill = path.join(clone, "viewer", "skills", "symphysis-проба", "SKILL.md");
  write(clone, "viewer/skills/symphysis-проба/SKILL.md");
  shimOf(project);
  // Настройка на клон и на его `.symphysis/tools` значит одну установку; `<клон>/tools` ядра больше не держит (F-45).
  for (const setting of [clone, path.join(clone, ".symphysis", "tools")]) {
    const env = envOf(project, setting);
    assert.equal(env.installDir, clone);
    const output = ok(await stepHelp(env, CHANGE));
    const skills = output.steps.find((s) => s.id === "intent")!.skills!;
    assert.deepEqual(skills, [{ name: "symphysis-проба", path: "viewer/skills/symphysis-проба/SKILL.md", base: "install" }]);
    assert.equal(resolveSkill(skills, "symphysis-проба", env.installDir), fs.realpathSync.native(skill));
  }
});

test("без `--change`: одно активное берётся само, несколько — список из поля `changes`", opts, async () => {
  const project = installedProject("изменение-два");
  shimOf(project, { status_all: forkStatusAll(CHANGE, "изменение-два") });
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
  const shim = forkShim(path.join(tempDir("symphysis-шим-"), "шим"), { status_all: forkStatusAll() });
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
    assert.deepEqual(failure(await stepHelp(env, CHANGE)), { kind: "unreadable", command: `${python} ${path.join(".symphysis", "tools", "step_help.py")} --change ${CHANGE}` });
  });
}

test("«Вывод не JSON»: Python с пробелом в пути: команда называет его в кавычках и в PowerShell запускается через `&`", async () => {
  const project = bareProject();
  const link = path.join(home("symphysis-питон-", "каталог с пробелом"), "ссылка");
  fs.symlinkSync(path.dirname(python), link, "junction");
  try {
    const spaced = path.join(link, path.basename(python));
    const env = { python: spaced, tools: path.join(project, ".symphysis", "tools"), cwd: project };
    write(project, ".symphysis/tools/step_help.py", 'print("не json")\n');
    const call = `"${spaced}" ${path.join(".symphysis", "tools", "step_help.py")} --change ${CHANGE}`;
    assert.deepEqual(failure(await stepHelp(env, CHANGE)), { kind: "unreadable", command: process.platform === "win32" ? `& ${call}` : call });
  } finally {
    // Ссылка ведёт в настоящий каталог Python: снимается сразу, общая уборка временных каталогов её не видит.
    fs.unlinkSync(link);
  }
});

test("«Вывод не JSON»: старое ядро не знает `--install-dir`, код 2, команда называет и аргумент, и установку в кавычках", async () => {
  const project = bareProject();
  const install = home("symphysis-установка-", "старая установка");
  write(install, "tools/journal.py");
  write(install, "tools/step_help.py", 'import argparse\nap = argparse.ArgumentParser()\nap.add_argument("--change")\nap.parse_args()\n');
  const env = envOf(project, install);
  const script = path.join(install, "tools", "step_help.py");
  assert.deepEqual(failure(await stepHelp(env, CHANGE)), { kind: "unreadable", command: `${python} "${script}" --change ${CHANGE} --install-dir "${install}"` });
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
  results: { target: HelpTarget; result: HelpOutcome }[];
  runs: HelpTarget[];
  mostAtOnce(): number;
}

const shown = (o: HelpOutcome) => {
  assert.ok(o.kind === "output", JSON.stringify(o));
  return o.output;
};
const refused = (o: HelpOutcome) => {
  assert.ok(o.kind === "failure", JSON.stringify(o));
  return o.failure;
};
const changeOf = (t: HelpTarget) => ("change" in t ? t.change : null);

function harness(env: CoreEnv, onResult?: () => void): Harness {
  const results: Harness["results"] = [];
  const runs: HelpTarget[] = [];
  let active = 0, most = 0;
  const runner = new StepHelpRunner({
    compute: async (target) => {
      runs.push(target);
      most = Math.max(most, ++active);
      try {
        return await computeHelp(target, () => env);
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
  assert.deepEqual(results.map((r) => shown(r.result).current_step), ["intent", "decisions"]);
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
  assert.equal(shown(results[0].result).change, "изменение-два");
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
  assert.deepEqual(runs.map(changeOf), [CHANGE, "изменение-три"]);
  assert.deepEqual(results.map((r) => changeOf(r.target)), ["изменение-три"]);
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
  assert.deepEqual(results.map((r) => r.target), [{ root: second, change: CHANGE }]);
});

test("исключение в расчёте становится отказом, следующий расчёт идёт", opts, async () => {
  const project = installedProject();
  shimOf(project);
  const { runner, results } = harness(envOf(project));
  // Настоящий отказ `execFile`: нулевой байт в аргументе.
  runner.request({ root: project, change: "имя\0с нулём" });
  await runner.whenIdle();
  const crash = refused(results[0].result);
  assert.ok(crash.kind === "crash" && crash.text.length > 0, JSON.stringify(crash));
  runner.request({ root: project, change: CHANGE });
  await runner.whenIdle();
  assert.equal(shown(results[1].result).change, CHANGE);
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
      return { kind: "failure", failure: { kind: "timeout" } };
    },
    onResult: () => undefined,
  });
  runner.request({ roots: ["папка"] });
  assert.deepEqual(started, []);
  await runner.whenIdle();
  assert.deepEqual(started, [{ roots: ["папка"] }]);
});

// --- какое изменение показать: за просмотрщиком, затем последнее показанное, затем расчёт без `--change` (F-41, F-83) ---

/** Окружение папки, как его собирает хост: нет инструментов — отказ. */
function hostEnv(root: string): CoreEnv | CoreFailure {
  const found = findTools(root);
  return "kind" in found ? found : { python, tools: found.dir, cwd: root, installDir: found.installDir };
}

/** Папка со своим именем, настоящее ядро. */
function folder(name: string, ...changes: string[]): string {
  const dir = home("symphysis-папки-", name);
  for (const change of changes) fs.mkdirSync(path.join(dir, "openspec", "changes", change), { recursive: true });
  copyCore(dir);
  return dir;
}

/** Папка, где ответ расчёта целиком подменяет `answers`: ядро не нужно, поиску инструментов хватает файла `journal.py`. */
function stubFolder(name: string, ...changes: string[]): string {
  const dir = home("symphysis-папки-", name);
  for (const change of changes) fs.mkdirSync(path.join(dir, "openspec", "changes", change), { recursive: true });
  write(dir, ".symphysis/tools/journal.py");
  return dir;
}

/** Ответ расчёта по папке, когда шим у всех один и нужен разный: подмена скрипта вывода. */
function answers(root: string, fields: Record<string, unknown>): void {
  const output = { contract: EXPECTED_CONTRACT, change: null, changes: [], error: null, current_step: "intent", current_text: null, turn: "human", steps: [], file_links: {}, ...fields };
  stubScript(envOf(root), `import json\nprint(json.dumps(json.loads(r'''${JSON.stringify(output)}''')))\n`);
}

test("выбор: за просмотрщиком, затем последнее показанное, затем все папки без `--change`", () => {
  const project = bareProject("изменение-два");
  const active = listChanges(project);
  const [one, two] = active;
  assert.deepEqual(chooseTarget(two.dir, one.dir, [project], active), { root: project, change: two.name });
  assert.deepEqual(chooseTarget(null, one.dir, [project], active), { root: project, change: one.name });
  assert.deepEqual(chooseTarget(null, null, [project], active), { roots: [project] });
  assert.deepEqual(chooseTarget(path.join(project, "нет такого"), one.dir, [project], active), { root: project, change: one.name }, "просмотрщик на изменении, которого нет, не в счёт");
});

test("«Показанного больше нет»: А заархивировано, активных не осталось: расчёт без `--change`, вкладка на шаге `intent`", opts, async () => {
  const project = installedProject();
  const dir = changeDir(project, CHANGE);
  fs.mkdirSync(path.join(project, "openspec", "changes", "archive"));
  fs.renameSync(dir, path.join(project, "openspec", "changes", "archive", `2026-11-04-${CHANGE}`));
  const target = chooseTarget(null, dir, [project], listChanges(project));
  assert.deepEqual(target, { roots: [project] });
  shimOf(project, { status_all: forkStatusAll() });
  const output = shown(await computeHelp(target, hostEnv));
  assert.equal(output.change, null);
  assert.equal(output.current_step, "intent");
  assert.equal(output.turn, "human");
});

test("«Одно активное»: последнего показанного нет, ядро берёт его само", opts, async () => {
  const project = installedProject();
  shimOf(project, { status_all: forkStatusAll(CHANGE) });
  const outcome = await computeHelp(chooseTarget(null, null, [project], listChanges(project)), hostEnv);
  assert.equal(shown(outcome).change, CHANGE);
  assert.ok(outcome.kind === "output" && outcome.root === project);
});

test("«Несколько активных»: список из двух имён без имени папки; выбор запоминается и показывает изменение", opts, async () => {
  const project = installedProject("изменение-два");
  shimOf(project, { status_all: forkStatusAll(CHANGE, "изменение-два") });
  const outcome = await computeHelp({ roots: [project] }, hostEnv);
  assert.deepEqual(outcome, { kind: "choice", choices: [
    { key: changeDir(project, CHANGE), change: CHANGE, folder: null },
    { key: changeDir(project, "изменение-два"), change: "изменение-два", folder: null },
  ] });
  assert.ok(outcome.kind === "choice");
  // Запомненный выбор становится последним показанным: следующий расчёт идёт уже для него.
  const target = chooseTarget(null, outcome.choices[1].key, [project], listChanges(project));
  assert.deepEqual(target, { root: project, change: "изменение-два" });
  assert.equal(shown(await computeHelp(target, hostEnv)).change, "изменение-два");
});

test("случаи различаются по полям `changes` и `change`, а не по тексту", async () => {
  const project = stubFolder("папка");
  answers(project, { changes: ["а", "б"], current_step: null, turn: null, current_text: "Активных изменений нет: следующий шаг по файлам — `intent`, ход человека." });
  assert.equal((await computeHelp({ roots: [project] }, hostEnv)).kind, "choice");
  answers(project, { changes: [], current_text: "Активных изменений несколько, шаг считается для одного: укажи его в --change." });
  assert.equal((await computeHelp({ roots: [project] }, hostEnv)).kind, "output");
  answers(project, { changes: ["а"], change: "а", current_step: "specs", current_text: "Активных изменений несколько." });
  assert.equal(shown(await computeHelp({ roots: [project] }, hostEnv)).current_step, "specs");
});

test("«Две папки рабочей области»: список изменений обеих папок с именем папки, по одному расчёту на папку", opts, async () => {
  const first = folder("первая папка", CHANGE);
  const second = folder("вторая папка", CHANGE);
  const shim = shimOf(first, { status_all: forkStatusAll(CHANGE) });
  const outcome = await computeHelp({ roots: [first, second] }, hostEnv);
  assert.deepEqual(outcome, { kind: "choice", choices: [
    { key: changeDir(first, CHANGE), change: CHANGE, folder: "первая папка" },
    { key: changeDir(second, CHANGE), change: CHANGE, folder: "вторая папка" },
  ] });
  const askedIn = shim.calls().filter((c) => c.argv.includes("--all")).map((c) => path.basename(c.cwd));
  assert.deepEqual(askedIn, ["первая папка", "вторая папка"]);
  assert.ok(outcome.kind === "choice");
  assert.deepEqual(chooseTarget(null, outcome.choices[1].key, [first, second], [...listChanges(first), ...listChanges(second)]), { root: second, change: CHANGE }, "выбор показывает изменение своей папки");
});

test("две папки, активное одно на обе: берётся оно, папка та, где оно лежит", async () => {
  const first = stubFolder("первая папка");
  const second = stubFolder("вторая папка", "а");
  answers(first, { changes: [] });
  answers(second, { changes: ["а"], change: "а", current_step: "specs" });
  const outcome = await computeHelp({ roots: [first, second] }, hostEnv);
  assert.equal(shown(outcome).change, "а");
  assert.ok(outcome.kind === "output" && outcome.root === second);
});

test("две папки, активных нет: начало конвейера; отказ одной папки не прячет ответ другой", async () => {
  const noTools = home("symphysis-папки-", "без инструментов");
  const second = stubFolder("вторая папка");
  answers(second, { changes: [] });
  const outcome = await computeHelp({ roots: [noTools, second] }, hostEnv);
  assert.equal(shown(outcome).current_step, "intent");
  assert.ok(outcome.kind === "output" && outcome.root === second);
});

test("сбой расчёта в папке, где изменение одно, не прячется за пустой папкой: `error` виден", async () => {
  const first = stubFolder("первая папка");
  const broken = stubFolder("вторая папка", "а");
  answers(first, { changes: [] });
  answers(broken, { changes: ["а"], error: "сбой форка", current_step: null, turn: null });
  assert.equal(shown(await computeHelp({ roots: [first, broken] }, hostEnv)).error, "сбой форка");
});

test("«Нет инструментов»: одна папка или все без них: отказ первой папки; папок нет вовсе: тот же отказ", async () => {
  const empty = home("symphysis-папки-", "пустая");
  assert.deepEqual(refused(await computeHelp({ roots: [empty, home("symphysis-папки-", "вторая")] }, hostEnv)), { kind: "no-tools", root: empty });
  assert.deepEqual(refused(await computeHelp({ roots: [] }, hostEnv)), { kind: "no-tools", root: "" });
  assert.deepEqual(refused(await computeHelp({ root: empty, change: CHANGE }, hostEnv)), { kind: "no-tools", root: empty });
});

test("сбой `status --all` соседней папки (`changes: null` и `error`) не прячется за чистой пустой папкой", async () => {
  const clean = stubFolder("чистая папка");
  const broken = stubFolder("сломанная папка");
  answers(clean, { changes: [] });
  answers(broken, { changes: null, error: "сбой форка", current_step: null, turn: null });
  for (const roots of [[clean, broken], [broken, clean]]) {
    const outcome = await computeHelp({ roots }, hostEnv);
    assert.equal(shown(outcome).error, "сбой форка");
    assert.ok(outcome.kind === "output" && outcome.root === broken);
  }
});

test("папка с изменением важнее чужой ошибки", async () => {
  const withChange = stubFolder("с изменением", "а");
  const broken = stubFolder("сломанная папка");
  answers(withChange, { changes: ["а"], change: "а", current_step: "specs" });
  answers(broken, { changes: null, error: "сбой форка", current_step: null, turn: null });
  const outcome = await computeHelp({ roots: [broken, withChange] }, hostEnv);
  assert.equal(shown(outcome).change, "а");
  assert.ok(outcome.kind === "output" && outcome.root === withChange);
});
