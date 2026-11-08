// Вид «атака»: кнопки тяжести по правилам страницы ядра — у блокера и предупреждения, у справки и строк покрытия их нет;
// нажатая кнопка без обоснования видна как незавершённая (F-39), поле обоснования отдельно от поля спора.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPrompt, emptyDraft } from "../../journal/logic";
import type { AttackFile, AttackRow, Draft, ViewPayload } from "../../protocol/types";
import { AttackView } from "../AttackView";
import { LinksContext } from "../../ui/Text";
import { payload as basePayload } from "../../../test/unit/helpers";

const row = (over: Partial<AttackRow>): AttackRow =>
  ({ claim: "утверждение", section: "—", lens: "scenario-run", invariant: "—", severity: "блокер", support: "нет", fix: "правка", ...over });
const file = (rows: AttackRow[]): AttackFile =>
  ({ path: "attack/artifacts.md", frontmatter: { status: "gaps_found", targets: [{ path: "specs/x.md", sha256: "a" }] }, rows });
const key = (r: AttackRow) => `attack/artifacts.md|${r.section}|${r.claim}`;

function html(rows: AttackRow[], draft: Draft = emptyDraft()): string {
  const p: ViewPayload = { ...basePayload([]), attacks: [file(rows)] };
  return renderToStaticMarkup(
    <LinksContext.Provider value={{ links: p.file_links, open: () => {} }}>
      <AttackView payload={p} draft={draft} flags={buildPrompt(p, draft, "2026-11-01")} lens="all" update={() => {}} />
    </LinksContext.Provider>,
  );
}

const one = (over: Partial<AttackRow>, draft?: Draft) => html([row(over)], draft);

test("кнопки тяжести: у блокера «понизить», у предупреждения «повысить», у справки и строк покрытия кнопки нет", () => {
  assert.ok(one({ severity: "блокер" }).includes(">понизить</button>"));
  assert.ok(one({ severity: "предупреждение" }).includes(">повысить</button>"));
  assert.ok(!one({ severity: "справка" }).includes("sev-btn"));
  assert.ok(!one({ severity: "блокер", claim: "не пройдено" }).includes("sev-btn"));
  assert.ok(!one({ severity: "блокер", support: "нет: не пройдено" }).includes("sev-btn"));
  assert.ok(!one({ severity: "блокер", support: "нет: файла нет" }).includes("sev-btn"));
});

test("поле обоснования свёрнуто по умолчанию; поле спора видно как раньше", () => {
  const out = one({ severity: "блокер" });
  assert.ok(!/<details[^>]*open/.test(out));
  assert.ok(out.includes("обоснование тяжести — почему понизить"));
  assert.match(out, /<textarea[^>]*class="dispute"/);
});

test("нажатая кнопка без обоснования: пометка «нет обоснования…», поле раскрыто, кнопка нажата", () => {
  const r = row({ severity: "блокер" });
  const d: Draft = { ...emptyDraft(), attackSevs: { [key(r)]: { to: "предупреждение", why: "" } } };
  const out = html([r], d);
  assert.ok(out.includes("нет обоснования, строки о тяжести не будет"));
  assert.match(out, /aria-pressed="true"[^>]*>понизить</);
  assert.match(out, /<details[^>]*open/);
});

test("нажатая кнопка с обоснованием: пометки нет, текст обоснования в своём поле, спор в своём", () => {
  const r = row({ severity: "блокер" });
  const d: Draft = {
    ...emptyDraft(),
    attackSevs: { [key(r)]: { to: "предупреждение", why: "решено человеком" } },
    attackDisputes: { [key(r)]: "опора есть" },
  };
  const out = html([r], d);
  assert.ok(!out.includes("нет обоснования, строки о тяжести не будет"));
  assert.ok(out.includes("решено человеком"));
  assert.ok(out.includes("опора есть"));
  assert.match(out, /textarea[^>]*class="sev-why"/);
});

test("переключатель «прочитано»: у предупреждения есть, у блокера и справки нет; отметка — «не внесено»", () => {
  const r = row({ severity: "предупреждение" });
  const d: Draft = { ...emptyDraft(), attackReads: { "attack/artifacts.md|—": true } };
  const out = html([r], d);
  assert.ok(out.includes("прочитано · не внесено"));
  assert.match(out, /<input[^>]*type="checkbox"/);
  assert.ok(!/disabled/.test(out));
  assert.ok(!one({ severity: "блокер" }).includes("readtoggle"));
  assert.ok(!one({ severity: "справка" }).includes("readtoggle"));
});

test("флаг по заметке журнала: «в журнале», переключатель неактивен, отметки состояния нет", () => {
  const r = row({ severity: "предупреждение" });
  const p: ViewPayload = { ...basePayload([]), notes: [{ date: "2026-11-01", text: "предупреждение прочитано: —" }], attacks: [file([r])] };
  const out = renderToStaticMarkup(
    <LinksContext.Provider value={{ links: p.file_links, open: () => {} }}>
      <AttackView payload={p} draft={emptyDraft()} flags={buildPrompt(p, emptyDraft(), "2026-11-01")} lens="all" update={() => {}} />
    </LinksContext.Provider>,
  );
  assert.ok(out.includes("прочитано · в журнале"));
  assert.ok(!out.includes("прочитано · не внесено"));
  assert.match(out, /<input[^>]*disabled=""[^>]*checked=""/);
});
