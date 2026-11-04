// Показ справки: всё из вывода `step_help.py`, своих текстов о шагах нет (F-38). Страница рисуется в HTML без браузера и проверяется по составу.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { HelpView } from "../../src/shared/protocol";
import type { HelpSkill, StepHelpOutput, StepHelpPage } from "../../src/shared/types";
import { HelpBody, SECTION_LABELS, type HelpActions, type ShownPage } from "../../src/webview/HelpBody";
import { noCoreReason, SYMPHYSIS } from "./fixture-project";

const noop = () => {};
const IDS = ["intent", "decisions", "specs", "archive"];
const EMPTY_TEXTS = { title: "", why: "", mechanics: "", if_skipped: "", what_to_check: "", command: "", how_to_prepare: "" };

function page(id: string, over: Partial<StepHelpPage> = {}): StepHelpPage {
  const at = IDS.indexOf(id);
  return {
    id, state: "ready", turn: "human", optional: false, blocks: [], stops_apply: false, waits_for: [], files: [], file_note: null,
    texts: { ...EMPTY_TEXTS, title: `Заголовок ${id}`, why: `Зачем ${id}`, mechanics: `Механика ${id}`, if_skipped: `Без шага ${id}`, what_to_check: `Проверка ${id}`, command: `команда-${id}`, how_to_prepare: id === "intent" ? "Пиши цель одной фразой" : "" },
    text_note: null, prev: IDS[at - 1] ?? null, next: IDS[at + 1] ?? null, skills: [], ...over,
  };
}

function output(over: Partial<StepHelpOutput> = {}, pages: Record<string, Partial<StepHelpPage>> = {}): StepHelpOutput {
  return {
    contract: 2, taken_at: "", versions: { openspec: "1.2.3-symphysis.1", symphysis: null }, change: "демо", changes: null, error: null,
    current_step: "specs", current_text: null, turn: "model", next_by_status: null, forks: null, tasks: null,
    steps: IDS.map((id) => page(id, pages[id])), file_links: {}, ...over,
  };
}

function render(out: StepHelpOutput, shown: ShownPage = { step: null, rules: false }, actions: Partial<HelpActions> = {}, pluginVersion = "0.2.0"): string {
  const view: HelpView = { panel: "help", key: "D:/п/openspec/changes/демо", name: "демо", outcome: { kind: "output", root: "D:/п", output: out }, pluginVersion };
  return renderToStaticMarkup(<HelpBody view={view} shown={shown} actions={{ select: noop, toggleRules: noop, openFile: noop, openSkill: noop, ...actions }} choose={noop} openPythonSetting={noop} />);
}
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("«Текущий шаг»: открыта страница текущего шага, пункт отмечен текущим, виден чей ход", () => {
  const html = render(output());
  assert.ok(html.includes("Заголовок specs"), html);
  assert.match(html, /<li class="current[^"]*" aria-current="step">/);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(flat(html), /specs · ход модели/);
  for (const t of ["Зачем specs", "Механика specs", "Без шага specs", "Проверка specs", "команда-specs"]) assert.ok(html.includes(t), t);
});

test("«Листание»: показана страница archive, текущим остался specs, «следующий» недоступна", () => {
  const html = render(output(), { step: "archive", rules: false });
  assert.ok(html.includes("Заголовок archive"), html);
  assert.ok(!html.includes("Заголовок specs"), html);
  assert.match(html, /<li class="current[^"]*" aria-current="step"><button[^>]*>specs</);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /<button[^>]*disabled=""[^>]*>следующий/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>предыдущий/);
});

test("листание: у середины обе кнопки доступны", () => {
  const html = render(output(), { step: "decisions", rules: false });
  assert.doesNotMatch(html, /disabled=""/);
});

test("«Правила намерения»: раздел intent показан, отметка текущего и причина сбоя на месте", () => {
  const out = output({ error: "openspec не найден", current_step: "specs" });
  const html = render(out, { step: null, rules: true });
  assert.ok(html.includes("Пиши цель одной фразой"), html);
  assert.ok(html.includes("openspec не найден"), html);
  assert.match(html, /aria-current="step"/);
  assert.match(render(out), /Как готовить intent\.md\?/);
});

test("«Правила намерения»: кнопка есть и при сбое без текущего шага", () => {
  const html = render(output({ error: "сбой", current_step: null, turn: null }));
  assert.match(html, /Как готовить intent\.md\?/);
  assert.ok(html.includes("сбой"));
});

test("«Текста шага нет»: показан `text_note`, данные графа на месте", () => {
  const html = render(output({}, { specs: { texts: { ...EMPTY_TEXTS }, text_note: "Текста шага нет: нет файла steps.md", waits_for: ["decisions"] } }));
  assert.ok(html.includes("Текста шага нет: нет файла steps.md"), html);
  assert.match(flat(html), /ход модели/);
  assert.ok(html.includes("decisions"), html);
});

test("«Файл есть, содержание не проверялось»: пометка из вывода, слова «выполняется» нет", () => {
  const html = render(output({}, { specs: { state: "done", file_note: "Файл есть, содержание не проверялось", files: [{ path: "openspec/changes/демо/specs/a.md", exists: true }] } }));
  assert.ok(html.includes("Файл есть, содержание не проверялось"), html);
  assert.doesNotMatch(html, /выполняется/i);
});

test("«Версии»: форк, symphysis «неизвестно» и плагин внизу малозаметно, предупреждения нет", () => {
  const html = render(output());
  assert.match(html, /<footer class="help-versions muted">/);
  const text = flat(html.slice(html.indexOf("help-versions")));
  assert.match(text, /форк 1\.2\.3-symphysis\.1/);
  assert.match(text, /symphysis неизвестно/);
  assert.match(text, /плагин 0\.2\.0/);
  assert.doesNotMatch(html, /не совпад|предупрежд|устарел/i);
});

test("«Файл шага в справке»: путь из карты ссылкой, путь, куда файл только ляжет, и путь не из карты кодом", () => {
  const out = output({ file_links: { "openspec/changes/демо/specs/a.md": "openspec/changes/демо/specs/a.md" } },
    { specs: { files: [{ path: "openspec/changes/демо/specs/a.md", exists: true }, { path: "openspec/changes/демо/design.md", exists: false }, { path: "constructor", exists: true }] } });
  const html = render(out);
  assert.equal((html.match(/data-file-link=/g) ?? []).length, 1, html);
  assert.match(html, /data-file-link="openspec\/changes\/демо\/specs\/a\.md"/);
  assert.ok(html.includes("<code>openspec/changes/демо/design.md</code>"), html);
  assert.ok(html.includes("<code>constructor</code>"), html);
});

const SKILLS: HelpSkill[] = [
  { name: "symphysis-proj", path: ".claude/skills/symphysis-proj/SKILL.md", base: "project" },
  { name: "symphysis-inst", path: "skills/symphysis-inst/SKILL.md", base: "install" },
  { name: "symphysis-lost", path: null, base: null },
];

test("«Скилл не найден»: имя текстом, найденные ссылками (проект — по карте, установка — по имени)", () => {
  const html = render(output({ file_links: { ".claude/skills/symphysis-proj/SKILL.md": ".claude/skills/symphysis-proj/SKILL.md" } }, { specs: { skills: SKILLS } }));
  assert.match(html, /data-file-link="\.claude\/skills\/symphysis-proj\/SKILL\.md"/);
  assert.match(html, /data-skill="symphysis-inst"/);
  assert.ok(!html.includes('data-skill="symphysis-lost"'), html);
  assert.ok(html.includes("symphysis-lost"), html);
  assert.equal((html.match(/data-file-link=|data-skill=/g) ?? []).length, 2);
});

test("скилл проекта, которого нет в карте, не ссылка", () => {
  const html = render(output({ file_links: {} }, { specs: { skills: SKILLS } }));
  assert.doesNotMatch(html, /data-file-link=/);
});

test("«Старое ядро без поля»: блока скиллов нет, текст шага прежний", () => {
  const old = page("specs") as Partial<StepHelpPage>;
  delete old.skills;
  const out = output();
  out.steps = out.steps.map((s) => (s.id === "specs" ? (old as StepHelpPage) : s));
  delete (out as Partial<StepHelpOutput>).file_links;
  const html = render(out);
  assert.doesNotMatch(html, /help-skills/);
  assert.ok(html.includes("Зачем specs"), html);
});

test("текст шага со ссылкой и кодом идёт через общий компонент текста", () => {
  const html = render(output({ file_links: { "a.md": "a.md" } }, { specs: { texts: { ...EMPTY_TEXTS, why: "Смотри `a.md:3` и `нет.md`" } } }));
  assert.match(html, /data-file-link="a\.md" data-file-line="3"/);
  assert.ok(html.includes("<code>нет.md</code>"), html);
});

test("разметка из вывода не создаётся: `<img onerror>` и `</script>` в steps.md и в error показаны текстом", () => {
  const evil = "<img src=x onerror=alert(1)></script><script>alert(2)</script>";
  const html = render(output({ error: evil }, { specs: { texts: { ...EMPTY_TEXTS, why: evil, title: evil }, text_note: evil, files: [{ path: evil, exists: true }] } }));
  assert.ok(!html.includes("<img"), html);
  assert.ok(!html.includes("<script"), html);
  assert.ok(!html.includes("</script>"), html);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), html);
});

test("счётчика задач и чисел развилок на странице справки нет (13.1)", () => {
  const html = render(output({ tasks: { state: "ok", total: 5, complete: 2, remaining: 3 }, forks: { open: 4, parked: 1 } }));
  assert.doesNotMatch(flat(html), /Задач закрыто|развилок/i);
});

test("в справке нет `dangerouslySetInnerHTML`", () => {
  for (const f of ["HelpBody.tsx", "help.tsx", "Text.tsx"]) {
    assert.ok(!fs.readFileSync(path.join(process.cwd(), "src", "webview", f), "utf8").includes("dangerouslySetInnerHTML"), f);
  }
});

test("подписи разделов те же слова, что заголовки `steps.md` ядра", { skip: noCoreReason }, () => {
  const steps = fs.readFileSync(path.join(SYMPHYSIS, "openspec", "schemas", "symphysis", "steps.md"), "utf8");
  const headings = new Set([...steps.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim()));
  assert.ok(SECTION_LABELS.length >= 5);
  for (const label of SECTION_LABELS) assert.ok(headings.has(label), `в steps.md нет подраздела «${label}»`);
  const html = render(output());
  for (const label of ["Механики", "Если пропустить", "Что смотреть"]) assert.ok(html.includes(`<b>${label}</b>`), label);
});

test("«Счётчика нет на вкладке»: шаг `apply`, задачи есть — ни чисел задач, ни чисел развилок", () => {
  const html = render(output({ current_step: "apply", tasks: { state: "ready", total: 5, complete: 2, remaining: 3 }, forks: { open: 4, parked: 1 } }));
  const text = flat(html);
  assert.doesNotMatch(text, /Задач закрыто|2 из 5|закрыто|развилок/i);
  assert.doesNotMatch(text, /\b[245]\b\s*(из|задач)/);
});
