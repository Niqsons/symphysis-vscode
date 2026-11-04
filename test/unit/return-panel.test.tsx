import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPrompt, emptyDraft } from "../../src/shared/logic";
import { ReturnPanel, type ReturnPanelProps } from "../../src/webview/ReturnPanel";
import { payload } from "./helpers";

const noop = () => {};

function html(over: Partial<ReturnPanelProps>): string {
  return renderToStaticMarkup(
    <ReturnPanel
      prompt={buildPrompt(payload([]), emptyDraft(), "2026-11-01")} open applying={false} blockedReason={null} result={null} copied={false}
      height={null} onHeight={noop} onToggle={noop} onApply={noop} onCopy={noop} onDismiss={noop} {...over}
    />,
  );
}

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
