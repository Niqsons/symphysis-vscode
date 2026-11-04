import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPrompt, emptyDraft } from "../../src/shared/logic";
import { ReturnPanel, savedAnswerLine, type ReturnPanelProps } from "../../src/webview/ReturnPanel";
import { payload } from "./helpers";

const noop = () => {};

function html(over: Partial<ReturnPanelProps>): string {
  return renderToStaticMarkup(
    <ReturnPanel
      prompt={buildPrompt(payload([]), emptyDraft(), "2026-11-01")} open applying={false} blockedReason={null} result={null} copied={false}
      height={null} onHeight={noop} onToggle={noop} onApply={noop} onCopy={noop} onCopyAnswer={noop} onDismiss={noop} {...over}
    />,
  );
}

const ANSWER = "X:\\проект\\answers\\2026-11-04.md";

test("после внесения строка о файле ответа — отдельное поле с кнопками справа, лог ниже отдельным блоком", () => {
  const out = html({ result: { stage: "applied", answers: ANSWER, report: ["[ok] F-01: решено A"], rebuildOk: true, rebuildReport: [], sha256After: null } });
  const log = out.indexOf('class="report"');
  const field = out.slice(out.indexOf('class="report-saved"'), log);
  assert.ok(field.includes(`Внесено, ответ сохранён: <code>${ANSWER}</code>`), out);
  assert.ok(field.includes(">Копировать</button>"), out);
  assert.ok(field.includes(">×</button>"), out);
  assert.ok(!field.includes("[ok] F-01"), out);
  assert.ok(out.slice(log).includes("[ok] F-01"), out);
  assert.ok(!out.slice(log).includes(">×</button>"), out);
});

test("в буфер идёт текст поля вместе с путём", () => {
  assert.equal(savedAnswerLine(ANSWER), `Внесено, ответ сохранён: ${ANSWER}`);
});

test("нет файла ответа — нет поля и кнопки: отказ, ошибка, устаревший журнал; убрать отчёт можно", () => {
  for (const result of [{ stage: "stale" }, { stage: "error", text: "сбой" }, { stage: "refused", report: ["[!!] нет"] }] as const) {
    const out = html({ result: result as ReturnPanelProps["result"] });
    assert.ok(!out.includes("report-saved") && !out.includes(">Копировать</button>"), result.stage);
    assert.ok(out.includes(">×</button>"), result.stage);
  }
});

test("по умолчанию панель низкая: высота не задана, поле по числу строк", () => {
  const out = html({});
  assert.match(out, /<textarea[^>]*rows="2"/);
  assert.ok(!/<textarea[^>]*style=/.test(out));
});

test("запомненная высота применяется к полю промпта", () => {
  assert.match(html({ height: 320 }), /<textarea[^>]*style="height:320px"/);
});

test("предупреждение к отчёту видно сразу: сигналом и не в свёрнутой пересборке", () => {
  const out = html({ result: { stage: "applied", answers: "a.md", report: ["[ok] F-02: решено A", "[!!] агенту надо сказать самому"], rebuildOk: true, rebuildReport: [], sha256After: null } });
  const at = out.indexOf('<div class="signal">[!!] агенту надо сказать самому</div>');
  assert.ok(at >= 0, out);
  assert.ok(at < out.indexOf("<details"), out);
});

test("ручка есть, пока промпт открыт; свёрнут — тянуть нечего", () => {
  assert.ok(html({}).includes('class="return-handle"'));
  assert.ok(!html({ open: false }).includes('class="return-handle"'));
  assert.ok(!html({ open: false }).includes("<textarea"));
});
