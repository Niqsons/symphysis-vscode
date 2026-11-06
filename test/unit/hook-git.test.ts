// Файлы хука спрятаны от git: настоящий git, каталоги с пробелом и кириллицей.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { installClient, removeExcludeLines, resolveGit, type HookClient } from "../../src/hook/hookGit";
import { tempDir } from "../temp-dir.mjs";

const GIT = resolveGit(process.env, []) as string;
const PY = "C:\\путь с пробелом\\python.exe";
const CLAUDE = ".claude/settings.local.json";
const OPENCODE = ".opencode/plugins/symphysis-hook.js";
const CLIENTS: [HookClient, string][] = [["claude", CLAUDE], ["opencode", OPENCODE]];
const OK = { ok: true };

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync(GIT, ["-c", "user.name=тест", "-c", "user.email=тест", "-c", "commit.gpgsign=false", "-c", "core.quotepath=false", ...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
const status = (cwd: string) => git(cwd, "status", "--porcelain");

/** Репозиторий с одним коммитом и чистым `git status`. */
function repo(): string {
  const root = path.join(tempDir("хук git "), "репозиторий с пробелом");
  fs.mkdirSync(root);
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
  git(root, "add", "a.txt");
  git(root, "commit", "-q", "-m", "первый");
  assert.equal(status(root), "");
  return root;
}
function worktree(main: string, name = "второе дерево"): string {
  const dir = path.join(path.dirname(main), name);
  git(main, "worktree", "add", "-q", "--detach", dir);
  return dir;
}
function put(root: string, rel: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text, "utf8");
}
const excludeOf = (root: string) => path.resolve(root, git(root, "rev-parse", "--git-path", "info/exclude").trim());
const excludeLines = (root: string) => (fs.existsSync(excludeOf(root)) ? fs.readFileSync(excludeOf(root), "utf8").split(/\r?\n/) : []);
const count = (root: string, line: string) => excludeLines(root).filter((l) => l === line).length;
const has = (root: string, rel: string) => fs.existsSync(path.join(root, rel));

function assertRefused(r: { ok: boolean; reason?: string }, names: string) {
  assert.equal(r.ok, false);
  assert.ok(r.reason?.includes(names), r.reason);
}

// --- поиск git: как у Python (F-66) ---

test("git ищется абсолютным путём, каталог рабочей области и вложенный в неё пропускаются, относительный каталог тоже", () => {
  assert.ok(path.isAbsolute(GIT), GIT);
  const dir = path.dirname(GIT);
  assert.equal(resolveGit({ PATH: dir }, []), GIT);
  assert.equal(resolveGit({ PATH: dir }, [dir]), null);
  assert.equal(resolveGit({ PATH: dir }, [path.dirname(dir)]), null);
  assert.equal(resolveGit({ PATH: "" }, []), null);
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    assert.equal(resolveGit({ PATH: "." }, []), null, "относительный каталог нашёл бы git от текущего каталога");
  } finally {
    process.chdir(cwd);
  }
});

// --- сценарии ---

for (const [client, rel] of CLIENTS) {
  test(`«Обычный репозиторий»: ${client}, файл есть, \`git status\` по-прежнему чист`, async () => {
    const root = repo();
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    assert.deepEqual(await installClient(root, client, PY, GIT), OK);
    assert.equal(has(root, rel), true);
    assert.equal(status(root), "");
    assert.equal(count(root, `/${rel}`), 1);
  });
}

test("«Worktree»: строки в файле, который назвал git, `git status` чист в обоих деревьях", async () => {
  const main = repo();
  const tree = worktree(main);
  assert.deepEqual(await installClient(tree, "claude", PY, GIT), OK);
  assert.equal(has(tree, CLAUDE), true);
  assert.equal(has(main, CLAUDE), false);
  assert.equal(status(tree), "");
  assert.equal(status(main), "");
  assert.equal(fs.realpathSync(excludeOf(tree)), fs.realpathSync(path.join(main, ".git", "info", "exclude")));
  assert.equal(count(main, `/${CLAUDE}`), 1);
});

test("«Проект без git»: запись ставится, причин нет, git не нужен", async () => {
  for (const given of [GIT, null]) {
    const root = path.join(tempDir("хук без git "), "проект");
    fs.mkdirSync(root);
    assert.deepEqual(await installClient(root, "claude", PY, given), OK);
    assert.equal(has(root, CLAUDE), true);
    assert.equal(has(root, ".git"), false);
    assert.deepEqual(await removeExcludeLines(root, given), OK);
  }
});

for (const [name, given] of [["git не нашёлся", () => null], ["путь к git мёртв", (root: string) => path.join(root, "нет такого", "git.exe")]] as const) {
  for (const [client, rel] of CLIENTS) {
    test(`«\`git\` не найден»: ${name}, ${client}, файла хука нет, причина названа`, async () => {
      const root = repo();
      const before = excludeLines(root);
      assertRefused(await installClient(root, client, PY, given(root)), "git");
      assert.equal(has(root, rel), false);
      assert.deepEqual(excludeLines(root), before);
      assert.equal(status(root), "");
    });
  }
}

test("«`git` не найден»: любой отказ git при найденном `.git`, тут пустой каталог `.git`", async () => {
  const root = path.join(tempDir("хук пустой git "), "проект");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  assertRefused(await installClient(root, "claude", PY, GIT), "git");
  assert.equal(has(root, CLAUDE), false);
});

test("«`git` не найден»: `rev-parse` отвечает, а `ls-files` отказал, битый индекс: это не «файл не отслеживается», файла нет", async () => {
  const root = repo();
  const before = excludeLines(root);
  fs.writeFileSync(path.join(root, ".git", "index"), "не индекс", "utf8");
  assertRefused(await installClient(root, "claude", PY, GIT), "git");
  assert.equal(has(root, CLAUDE), false);
  assert.deepEqual(excludeLines(root), before);
});

test("«Повторная активация»: строк не прибавилось, файл `exclude` не перезаписан, блок один", async () => {
  const root = repo();
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.deepEqual(await installClient(root, "opencode", PY, GIT), OK);
  const once = fs.readFileSync(excludeOf(root));
  const old = new Date("2020-01-02T03:04:05Z");
  fs.utimesSync(excludeOf(root), old, old);
  const mtime = fs.statSync(excludeOf(root)).mtimeMs;
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.deepEqual(await installClient(root, "opencode", PY, GIT), OK);
  assert.ok(fs.readFileSync(excludeOf(root)).equals(once));
  assert.equal(fs.statSync(excludeOf(root)).mtimeMs, mtime);
  assert.equal(count(root, `/${CLAUDE}`), 1);
  assert.equal(count(root, `/${OPENCODE}`), 1);
  assert.equal(status(root), "");
});

test("«Такая же строка человека»: и выше блока, и сразу под ним, при снятии обе на месте, снимается только блок", async () => {
  const root = repo();
  const line = `/${CLAUDE}`;
  const humanBefore = `# заметка человека\n${line}\n`;
  fs.writeFileSync(excludeOf(root), humanBefore, "utf8");
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.equal(count(root, line), 2, "своя строка стоит и при такой же строке человека");
  fs.appendFileSync(excludeOf(root), `${line}\n`, "utf8");
  assert.equal(count(root, line), 3);
  assert.deepEqual(await removeExcludeLines(root, GIT), OK);
  assert.equal(fs.readFileSync(excludeOf(root), "utf8"), `${humanBefore}${line}\n`);
});

test("снятие: блока больше нет, `exclude` как до установки, файл снова виден git", async () => {
  const root = repo();
  const was = fs.readFileSync(excludeOf(root));
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.deepEqual(await installClient(root, "opencode", PY, GIT), OK);
  assert.deepEqual(await removeExcludeLines(root, GIT), OK);
  assert.ok(fs.readFileSync(excludeOf(root)).equals(was));
  assert.match(status(root), /\.claude\//);
});

for (const [client, rel, scenario] of [["claude", CLAUDE, "«Файл настроек отслеживается git»"], ["opencode", OPENCODE, "«Файл opencode отслеживается git»"]] as const) {
  test(`${scenario}: файл не тронут, строк нет, причина названа`, async () => {
    const root = repo();
    put(root, rel, "закоммичено\n");
    git(root, "add", "-f", "--", rel);
    git(root, "commit", "-q", "-m", "файл клиента");
    const before = excludeLines(root);
    const r = await installClient(root, client, PY, GIT);
    assertRefused(r, `${rel} отслеживается`);
    assert.equal(fs.readFileSync(path.join(root, rel), "utf8"), "закоммичено\n");
    assert.deepEqual(excludeLines(root), before);
    assert.equal(status(root), "");
  });

  test(`${scenario}: файл только добавлен в индекс, считается отслеживаемым`, async () => {
    const root = repo();
    put(root, rel, "в индексе\n");
    git(root, "add", "-f", "--", rel);
    assertRefused(await installClient(root, client, PY, GIT), `${rel} отслеживается`);
    assert.equal(fs.readFileSync(path.join(root, rel), "utf8"), "в индексе\n");
  });
}

test("«Два рабочих дерева»: при снятии в одном строки остаются, пока файлы есть в другом", async () => {
  const main = repo();
  const tree = worktree(main);
  for (const root of [main, tree]) {
    assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
    assert.deepEqual(await installClient(root, "opencode", PY, GIT), OK);
  }
  fs.unlinkSync(path.join(tree, CLAUDE));
  fs.unlinkSync(path.join(tree, OPENCODE));
  assert.deepEqual(await removeExcludeLines(tree, GIT), OK);
  assert.equal(count(main, `/${CLAUDE}`), 1);
  assert.equal(count(main, `/${OPENCODE}`), 1);
  assert.equal(status(main), "");

  fs.unlinkSync(path.join(main, CLAUDE));
  fs.unlinkSync(path.join(main, OPENCODE));
  assert.deepEqual(await removeExcludeLines(main, GIT), OK);
  assert.equal(count(main, `/${CLAUDE}`), 0);
  assert.equal(count(main, `/${OPENCODE}`), 0);
});

test("«Два рабочих дерева»: решение отдельно на каждую строку, файл настроек второго дерева не становится виден git", async () => {
  const main = repo();
  const tree = worktree(main);
  assert.deepEqual(await installClient(main, "claude", PY, GIT), OK);
  assert.deepEqual(await installClient(tree, "claude", PY, GIT), OK);
  assert.deepEqual(await installClient(tree, "opencode", PY, GIT), OK);
  assert.deepEqual(await removeExcludeLines(tree, GIT), OK);
  assert.equal(count(main, `/${CLAUDE}`), 1);
  assert.equal(count(main, `/${OPENCODE}`), 0);
  assert.equal(status(main), "");
});

test("«Два рабочих дерева»: своё дерево в расчёт не идёт, каталог второго снят руками, снятие не падает", async () => {
  const main = repo();
  const tree = worktree(main);
  assert.deepEqual(await installClient(main, "claude", PY, GIT), OK);
  fs.unlinkSync(path.join(tree, ".git"));
  fs.unlinkSync(path.join(tree, "a.txt"));
  fs.rmdirSync(tree);
  assert.deepEqual(await removeExcludeLines(main, GIT), OK);
  assert.equal(count(main, `/${CLAUDE}`), 0, "файл настроек в своём дереве строку не держит");
});

test("репозиторий с `core.fsmonitor`: без защиты команда создаёт метку, после всех вызовов плагина метки нет", async () => {
  const root = repo();
  const tree = worktree(root);
  const marker = path.join(root, "marker.txt");
  git(root, "config", "core.fsmonitor", "echo x > marker.txt; true");
  const bare = spawnSync(GIT, ["ls-files", "--error-unmatch", "a.txt"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(fs.existsSync(marker), true, "без защиты команда репозитория не сработала: тест ничего не показывает");
  fs.unlinkSync(marker);

  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.deepEqual(await installClient(root, "opencode", PY, GIT), OK);
  assert.deepEqual(await installClient(tree, "claude", PY, GIT), OK);
  assert.deepEqual(await removeExcludeLines(root, GIT), OK);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(path.join(tree, "marker.txt")), false);
});

test("папка-подкаталог репозитория: `git status` чист, строка от корня репозитория, такой же файл в корне виден", async () => {
  const main = repo();
  const folder = "папка с пробелом [1]";
  const root = path.join(main, folder);
  put(root, "b.txt", "b\n");
  git(main, "add", "--", folder);
  git(main, "commit", "-q", "-m", "папка");
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.deepEqual(await installClient(root, "opencode", PY, GIT), OK);
  assert.equal(has(root, CLAUDE), true);
  assert.equal(status(main), "");
  assert.equal(status(root), "");
  put(main, CLAUDE, "файл в корне\n");
  assert.match(status(main), /^\?\? \.claude\/\n$/, "строка привязана к папке, а не к любому такому пути");
  assert.deepEqual(await removeExcludeLines(root, GIT), OK);
  assert.ok(status(main).includes(folder), "после снятия файл папки снова виден");
});

test("папка-подкаталог репозитория: без git это не проект без git, файла нет", async () => {
  const main = repo();
  const root = path.join(main, "папка");
  fs.mkdirSync(root);
  assertRefused(await installClient(root, "claude", PY, null), "git");
  assert.equal(has(root, CLAUDE), false);
});

// --- края записи ---

test("запись файла отказала: новая строка откатывается, иначе чужой файл останется спрятанным от git", async () => {
  const root = repo();
  put(root, OPENCODE, "export default {};\n");
  const before = excludeLines(root);
  assertRefused(await installClient(root, "opencode", PY, GIT), OPENCODE);
  assert.deepEqual(excludeLines(root), before);
  assert.match(status(root), /\.opencode\//);

  put(root, CLAUDE, "// не JSON\n");
  assertRefused(await installClient(root, "claude", PY, GIT), CLAUDE);
  assert.deepEqual(excludeLines(root), before);
  assert.match(status(root), /\.claude\//);
});

test("запись файла отказала при прежней своей строке: строка остаётся, файл уже спрятан ею", async () => {
  const root = repo();
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  fs.writeFileSync(path.join(root, CLAUDE), "// не JSON\n", "utf8");
  assertRefused(await installClient(root, "claude", PY, GIT), CLAUDE);
  assert.equal(count(root, `/${CLAUDE}`), 1);
  assert.equal(status(root), "");
});

test("`.claude` как junction наружу: причина про ссылку, а не про git, `exclude` не тронут, снаружи пусто", async () => {
  const root = repo();
  const target = tempDir("снаружи ");
  fs.symlinkSync(target, path.join(root, ".claude"), "junction");
  const before = fs.readFileSync(excludeOf(root));
  const old = new Date("2020-01-02T03:04:05Z");
  fs.utimesSync(excludeOf(root), old, old);
  const mtime = fs.statSync(excludeOf(root)).mtimeMs;
  assertRefused(await installClient(root, "claude", PY, GIT), "за пределы проекта");
  assert.ok(fs.readFileSync(excludeOf(root)).equals(before));
  assert.equal(fs.statSync(excludeOf(root)).mtimeMs, mtime, "проверка ссылки стоит до git и до `exclude`");
  assert.deepEqual(fs.readdirSync(target), []);
});

test("`exclude` как ссылка: отказ, ссылка на месте, файла хука нет", async () => {
  const root = repo();
  const file = excludeOf(root);
  fs.unlinkSync(file);
  const target = tempDir("снаружи ");
  fs.symlinkSync(target, file, "junction");
  assertRefused(await installClient(root, "claude", PY, GIT), "ссылка");
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal(has(root, CLAUDE), false);
});

test("каталога `info` нет: создаётся, `git status` чист", async () => {
  const root = repo();
  fs.unlinkSync(excludeOf(root));
  fs.rmdirSync(path.dirname(excludeOf(root)));
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.equal(status(root), "");
});

test("`exclude` человека без перевода строки в конце: его строка цела, блок с новой строки", async () => {
  const root = repo();
  fs.writeFileSync(excludeOf(root), "/заметка-человека", "utf8");
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.equal(count(root, "/заметка-человека"), 1);
  assert.equal(count(root, `/${CLAUDE}`), 1);
  assert.equal(status(root), "");
});

test("`exclude` человека не в UTF-8: его байты целы и после установки, и после снятия", async () => {
  const root = repo();
  const was = Buffer.concat([Buffer.from("# "), Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), Buffer.from("\n/заметка\n")]);
  fs.writeFileSync(excludeOf(root), was);
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.ok(fs.readFileSync(excludeOf(root)).subarray(0, was.length).equals(was));
  assert.equal(status(root), "");
  assert.deepEqual(await removeExcludeLines(root, GIT), OK);
  assert.ok(fs.readFileSync(excludeOf(root)).equals(was));
});

test("перевод строки CRLF в `exclude` не прячет свой блок: снятие его находит", async () => {
  const root = repo();
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  const crlf = fs.readFileSync(excludeOf(root), "utf8").replace(/\r?\n/g, "\r\n");
  fs.writeFileSync(excludeOf(root), crlf, "utf8");
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.equal(fs.readFileSync(excludeOf(root), "utf8"), crlf, "строка уже есть");
  assert.deepEqual(await removeExcludeLines(root, GIT), OK);
  assert.equal(count(root, `/${CLAUDE}`), 0);
});

test("блок без конца, например человек стёр нижнюю строку: чужое не снимается, ставится новый блок", async () => {
  const root = repo();
  const clean = excludeLines(root);
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  const added = excludeLines(root).filter((l) => !clean.includes(l) && l.startsWith("#"));
  assert.equal(added.length, 2, "блок ограничен двумя строками-метками");
  const broken = `${added[0]}\n/${CLAUDE}\n/заметка-человека\n`;
  fs.writeFileSync(excludeOf(root), broken, "utf8");
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.equal(status(root), "");
  assert.deepEqual(await removeExcludeLines(root, GIT), OK);
  assert.equal(fs.readFileSync(excludeOf(root), "utf8"), broken);

  // Конец без начала: новый блок ставится один раз, а не при каждой активации.
  const stale = `${added[1]}\n/заметка-человека\n`;
  fs.writeFileSync(excludeOf(root), stale, "utf8");
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.deepEqual(await installClient(root, "claude", PY, GIT), OK);
  assert.equal(count(root, `/${CLAUDE}`), 1);
  assert.deepEqual(await removeExcludeLines(root, GIT), OK);
  assert.equal(fs.readFileSync(excludeOf(root), "utf8"), stale);
});

test("снятие: файла `exclude` нет или git не нашёлся при `.git`: без падения, причина значением", async () => {
  const root = repo();
  fs.unlinkSync(excludeOf(root));
  assert.deepEqual(await removeExcludeLines(root, GIT), OK);
  assertRefused(await removeExcludeLines(root, null), "git");
});
