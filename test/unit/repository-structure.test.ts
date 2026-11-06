// Проверка структуры репозитория на деревьях-фикстурах во временном каталоге (F-25): живое дерево здесь не читается.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as rs from "../repository-structure";
import { tempDir } from "../temp-dir.mjs";

type Tree = Record<string, string | Buffer>;

const ROOT_README = `# плагин

- [src/](src/) — контур разработки
- [docs/](docs/) — контур разработки
`;

const fm = (name: string, kind = "доменный", body = "") => `---\nname: ${name}\nkind: ${kind}\n---\n\n${body}`;

function baseTree(): Tree {
  return {
    "README.md": ROOT_README,
    "src/viewer/README.md": fm("viewer", "доменный", "Просмотрщик.\n"),
    "src/viewer/a.ts": "export const a = 1;\n",
    "src/search/README.md": fm("search", "доменный", "Поиск.\n"),
    "src/search/b.ts": "export const b = 2;\n",
    "docs/guide.md": "руководство\n",
  };
}

/** Дерево во временном каталоге: файлы из `tree` в индексе git, из `untracked` — на диске вне git. */
function build(tree: Tree, untracked: Tree = {}): string {
  const root = path.join(tempDir("symphysis-структура-"), "репозиторий с пробелом");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  for (const [rel, content] of Object.entries({ ...tree, ...untracked })) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  execFileSync("git", ["-C", root, "add", "--", ...Object.keys(tree)]);
  return root;
}

const repo = (tree: Tree, untracked?: Tree) => new rs.Repo(build(tree, untracked));
const joined = (problems: string[]) => problems.join("\n");

test("эталонное дерево зелёное", () => {
  assert.deepEqual(rs.checkRepository(build(baseTree())), []);
});

// --- 1.1 README корня

test("«Новый каталог без описания»: каталог первого уровня без строки в README корня — красный и назван", () => {
  const tree = baseTree();
  tree["media/icon.svg"] = "<svg/>\n";
  assert.match(joined(rs.checkRepository(build(tree))), /^media\/: каталог первого уровня без строки в README корня$/m);
});

test("каталоги корня вне git не требуются: выходы сборки и зависимости", () => {
  const r = repo(baseTree(), { "node_modules/c.js": "c", "out/extension.js": "e", "hook/hook.py": "h" });
  assert.deepEqual(rs.checkRootReadme(r), []);
});

test("контур разработки с README модуля — красный", () => {
  const tree = baseTree();
  tree["docs/README.md"] = fm("docs");
  assert.match(joined(rs.checkRootReadme(repo(tree))), /docs\//);
});

test("контур разработки с README без frontmatter — зелёный", () => {
  const tree = baseTree();
  tree["docs/README.md"] = "# Документы\n";
  assert.deepEqual(rs.checkRootReadme(repo(tree)), []);
});

test("строка о каталоге, которого нет, — красная и называет README корня", () => {
  const tree = baseTree();
  tree["README.md"] += "- [scripts/](scripts/) — контур разработки\n";
  const out = joined(rs.checkRootReadme(repo(tree)));
  assert.match(out, /scripts\//);
  assert.match(out, /README\.md/);
});

test("README корня нет — красный", () => {
  const tree = baseTree();
  delete tree["README.md"];
  assert.match(joined(rs.checkRootReadme(repo(tree))), /README\.md в корне: файла нет/);
});

for (const line of ["- [docs](docs/) — контур разработки", "- [./docs/](./docs/) — контур разработки", "- [docs/](docs/) — служебный", "- [docs/](docs/)", "- [docs/](docs/) — контур разработкипотом"]) {
  test(`неверная форма строки корня — красная: ${line}`, () => {
    const tree = baseTree();
    tree["README.md"] = ROOT_README.replace("- [docs/](docs/) — контур разработки", line);
    assert.ok(rs.checkRootReadme(repo(tree)).length > 0);
  });
}

// --- 1.2 frontmatter README модуля

test("имя модуля может отличаться от каталога", () => {
  const tree = baseTree();
  tree["src/viewer/README.md"] = fm("страница");
  assert.deepEqual(rs.checkModuleFrontmatter(repo(tree)), []);
});

test("род вне двух значений — красный и называет каталог и значение", () => {
  const tree = baseTree();
  tree["src/viewer/README.md"] = fm("viewer", "служебный");
  const out = joined(rs.checkModuleFrontmatter(repo(tree)));
  assert.match(out, /src\/viewer\//);
  assert.match(out, /служебный/);
});

test("род «технический» принят", () => {
  const tree = baseTree();
  tree["src/viewer/README.md"] = fm("viewer", "технический");
  assert.deepEqual(rs.checkModuleFrontmatter(repo(tree)), []);
});

test("README модуля без frontmatter — красный", () => {
  const tree = baseTree();
  tree["src/viewer/README.md"] = "# Просмотрщик\n";
  assert.match(joined(rs.checkModuleFrontmatter(repo(tree))), /src\/viewer\//);
});

test("новый каталог в `src/` без README — красный и назван", () => {
  const tree = baseTree();
  tree["src/новый/c.ts"] = "export const c = 3;\n";
  assert.match(joined(rs.checkRepository(build(tree))), /^src\/новый\/: у модуля нет README\.md$/m);
});

for (const nameLine of ['name: ""', "name:", "name:    ", "name: '  '"]) {
  test(`пустое имя модуля — красное: ${nameLine}`, () => {
    const tree = baseTree();
    tree["src/viewer/README.md"] = `---\n${nameLine}\nkind: доменный\n---\n`;
    assert.match(joined(rs.checkModuleFrontmatter(repo(tree))), /src\/viewer\//);
  });
}

test("два модуля с одним именем — красные, названы оба каталога", () => {
  const tree = baseTree();
  tree["src/viewer/README.md"] = fm("search");
  const out = joined(rs.checkModuleFrontmatter(repo(tree)));
  assert.match(out, /src\/search\//);
  assert.match(out, /src\/viewer\//);
});

for (const value of ["!!python/object/apply:os.system ['x']", "!Tag viewer", "&a viewer", "*a"]) {
  test(`тег YAML — красный и не исполняется: ${value}`, () => {
    const tree = baseTree();
    tree["src/viewer/README.md"] = `---\nname: ${value}\nkind: доменный\n---\n`;
    const out = joined(rs.checkModuleFrontmatter(repo(tree)));
    assert.match(out, /src\/viewer\//);
    assert.match(out, /тег/);
  });
}

test("тег в роде — красный", () => {
  const tree = baseTree();
  tree["src/viewer/README.md"] = "---\nname: viewer\nkind: !!str доменный\n---\n";
  assert.match(joined(rs.checkModuleFrontmatter(repo(tree))), /src\/viewer\//);
});

test("ручной разбор: кавычки, комментарий, CRLF, повтор поля", () => {
  assert.deepEqual(rs.parseFrontmatter('---\r\nname: "a b"  \r\nkind: технический # примечание\r\n---\r\n'), [{ name: "a b", kind: "технический" }, []]);
  assert.deepEqual(rs.parseFrontmatter("---\nname: a\nname: b\nkind: доменный\n---\n"), [{ name: "a", kind: "доменный" }, ["поле `name` повторено"]]);
  assert.deepEqual(rs.parseFrontmatter("---\nname: 'a\nkind: доменный\n---\n"), [{ kind: "доменный" }, ["поле `name`: незакрытая кавычка"]]);
  assert.deepEqual(rs.parseFrontmatter("# без frontmatter\n"), [null, []]);
});

test("README модуля с BOM читается", () => {
  const tree = baseTree();
  tree["src/viewer/README.md"] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fm("viewer"), "utf8")]);
  assert.deepEqual(rs.checkModuleFrontmatter(repo(tree)), []);
});

// --- 1.3 вложенные каталоги

function withNested(tree: Tree, body: string, dirs = ["test"]): Tree {
  tree["src/viewer/README.md"] = fm("viewer", "доменный", body);
  for (const d of dirs) tree[`src/viewer/${d}/t.test.ts`] = "t\n";
  return tree;
}

test("вложенный каталог описан ссылкой и строкой", () => {
  assert.deepEqual(rs.checkNestedDirs(repo(withNested(baseTree(), "- [test/](test/) — тесты модуля\n"))), []);
});

test("вложенный каталог появился без описания — красный, назван модуль и каталог", () => {
  const out = joined(rs.checkNestedDirs(repo(withNested(baseTree(), "Только текст.\n"))));
  assert.match(out, /src\/viewer\//);
  assert.match(out, /`test\/`/);
});

test("вложенный каталог вне git не требуется", () => {
  assert.deepEqual(rs.checkNestedDirs(repo(baseTree(), { "src/viewer/out/x.js": "x" })), []);
});

test("ссылка на удалённый каталог — красная, названы модуль и ссылка", () => {
  const tree = baseTree();
  tree["src/viewer/README.md"] = fm("viewer", "доменный", "- [fixtures/](fixtures/) — данные\n");
  const out = joined(rs.checkNestedDirs(repo(tree)));
  assert.match(out, /src\/viewer\//);
  assert.match(out, /fixtures\//);
});

test("ссылка с родительским путём не засчитывается: соседний модуль не вложенный каталог", () => {
  const out = joined(rs.checkNestedDirs(repo(withNested(baseTree(), "- [../search/](../search/) — сосед\n"))));
  assert.match(out, /`test\/` не описан/);
  assert.doesNotMatch(out, /search/);
});

test("ссылка через обход внутрь модуля нормализуется", () => {
  const body = "- [../viewer/test/x/](../viewer/test/x/) — глубже\n- [test/](test/) — тесты\n";
  assert.deepEqual(rs.checkNestedDirs(repo(withNested(baseTree(), body))), []);
});

for (const link of ["[test](test/)", "[./test/](./test/)", "[test/](./test/)", "[x/](test/)"]) {
  test(`другая форма ссылки на вложенный каталог — красная: ${link}`, () => {
    assert.match(joined(rs.checkNestedDirs(repo(withNested(baseTree(), `- ${link} — тесты\n`)))), /форме/);
  });
}

test("ссылка без строки о каталоге — красная", () => {
  assert.match(joined(rs.checkNestedDirs(repo(withNested(baseTree(), "[test/](test/)\n")))), /нет строки/);
});

test("ссылка в блоке кода не считается", () => {
  assert.match(joined(rs.checkNestedDirs(repo(withNested(baseTree(), "```\n- [test/](test/) — тесты\n```\n")))), /не описан/);
});

// --- 1.4 место модуля

test("модуль не на своём месте: README модуля глубже первого уровня вне `src/` — красный", () => {
  const tree = baseTree();
  tree["docs/sub/README.md"] = fm("sub", "технический");
  tree["docs/sub/x.md"] = "x\n";
  assert.match(joined(rs.checkModulePlaces(repo(tree))), /docs\/sub\/: модуль не на своём месте/);
});

test("каталог корня с пометкой «модуль» — не на своём месте: модули плагина в `src/`", () => {
  const tree = baseTree();
  tree["README.md"] += "- [hook/](hook/) — модуль\n";
  tree["hook/README.md"] = fm("hook");
  tree["hook/hook.py"] = "print('x')\n";
  assert.match(joined(rs.checkModulePlaces(repo(tree))), /^hook\/: модуль не на своём месте/m);
});

test("`src/` с пометкой «модуль» — красный: модули в нём оказываются вложенными", () => {
  const tree = baseTree();
  tree["README.md"] = ROOT_README.replace("- [src/](src/) — контур разработки", "- [src/](src/) — модуль");
  tree["src/README.md"] = fm("src");
  const out = joined(rs.checkModulePlaces(repo(tree)));
  assert.match(out, /src\/viewer\/: модуль внутри модуля src\//);
});

test("вложенный модуль — красный, названы оба каталога", () => {
  const tree = baseTree();
  tree["src/viewer/inner/README.md"] = fm("inner");
  tree["src/viewer/inner/i.ts"] = "i\n";
  const out = joined(rs.checkModulePlaces(repo(tree)));
  assert.match(out, /src\/viewer\/inner\//);
  assert.match(out, /модуль внутри модуля src\/viewer\//);
});

// --- 1.5 копии

test("копия в двух модулях — красная с обоими путями", () => {
  const tree = baseTree();
  tree["src/viewer/common.ts"] = "export const общий = 1;\n";
  tree["src/search/common.ts"] = "export const общий = 1;\n";
  const out = joined(rs.checkCopies(repo(tree)));
  assert.match(out, /src\/viewer\/common\.ts/);
  assert.match(out, /src\/search\/common\.ts/);
});

test("бинарная копия ловится по байтам", () => {
  const blob = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.from([0xff, 0xfe, 0x00, 0x80])]);
  const tree = baseTree();
  tree["src/viewer/icon.bin"] = blob;
  tree["src/search/media.bin"] = blob;
  const out = joined(rs.checkCopies(repo(tree)));
  assert.match(out, /src\/viewer\/icon\.bin/);
  assert.match(out, /src\/search\/media\.bin/);
});

test("пустые файлы, копии внутри одного модуля и вне модулей не считаются", () => {
  const tree = baseTree();
  tree["src/viewer/empty.ts"] = "";
  tree["src/search/empty.ts"] = "";
  tree["src/viewer/dup1.txt"] = "тот же\n";
  tree["src/viewer/dup2.txt"] = "тот же\n";
  tree["docs/copy.txt"] = "тот же\n";
  assert.deepEqual(rs.checkCopies(repo(tree)), []);
});

test("разные файлы с одним именем — не копии", () => {
  const tree = baseTree();
  tree["src/viewer/x.ts"] = "один\n";
  tree["src/search/x.ts"] = "два\n";
  assert.deepEqual(rs.checkCopies(repo(tree)), []);
});

// --- чужой frontmatter не делает README модульным

test("чужой frontmatter в контуре — не красный", () => {
  const tree = baseTree();
  tree["docs/README.md"] = "---\ntitle: Документы\n---\n# Документы\n";
  assert.deepEqual(rs.checkRepository(build(tree)), []);
});

test("чужой frontmatter глубже первого уровня — не красный", () => {
  const tree = baseTree();
  tree["docs/sub/README.md"] = "---\ntitle: Раздел\n---\n";
  tree["docs/sub/x.md"] = "x\n";
  assert.deepEqual(rs.checkRepository(build(tree)), []);
});

// --- лишний ключ рядом с name и kind не отменяет README модуля

const EXTRA = "---\nname: viewer\nkind: KIND\ndescription: что-то\n---\n";

test("лишний ключ: модуль узнан, проверки идут", () => {
  const tree = baseTree();
  tree["src/viewer/README.md"] = EXTRA.replace("KIND", "служебный");
  assert.match(joined(rs.checkModuleFrontmatter(repo(tree))), /служебный/);
});

test("лишний ключ в контуре — красный", () => {
  const tree = baseTree();
  tree["docs/README.md"] = EXTRA.replace("KIND", "доменный");
  assert.match(joined(rs.checkRootReadme(repo(tree))), /docs\//);
});

test("лишний ключ глубже места модуля — красный", () => {
  const tree = baseTree();
  tree["src/viewer/inner/README.md"] = EXTRA.replace("KIND", "доменный");
  tree["src/viewer/inner/i.ts"] = "i\n";
  assert.match(joined(rs.checkModulePlaces(repo(tree))), /src\/viewer\/inner\//);
});
