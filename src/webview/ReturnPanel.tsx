// Нижняя панель режима «решения»: промпт возврата, «Внести», «Скопировать», отчёт внесения дословно.
import { useRef, useState, type PointerEvent } from "react";
import type { Prompt } from "../shared/logic";
import { clampPromptHeight } from "../shared/ops";
import type { ApplyReport } from "../shared/protocol";

export interface ReturnPanelProps {
  prompt: Prompt;
  open: boolean;
  applying: boolean;
  blockedReason: string | null;
  result: ApplyReport | null;
  copied: boolean;
  height: number | null;
  onHeight(height: number | null): void;
  onToggle(): void;
  onApply(): void;
  onCopy(): void;
  onDismiss(): void;
}

const Lines = ({ lines }: { lines: string[] }) => (
  <pre className="report-lines">
    {lines.map((l, i) => <div key={i} className={l.startsWith("[!!]") ? "signal" : l.startsWith("[--]") || l.startsWith("[..]") ? "muted" : ""}>{l}</div>)}
  </pre>
);

function Report({ result, onDismiss }: { result: ApplyReport; onDismiss(): void }) {
  let body;
  if (result.stage === "stale") {
    body = <div className="signal">Журнал изменён после показа. Ничего не внесено: посмотри обновлённые записи и нажми «Внести» ещё раз.</div>;
  } else if (result.stage === "error") {
    body = <div className="signal">Внесение не выполнено: {result.text}</div>;
  } else if (result.stage === "refused") {
    body = <><div className="signal">apply отказал, журнал не тронут. Поправь выбор в карточке и нажми «Внести» ещё раз.</div><Lines lines={result.report} /></>;
  } else {
    body = (
      <>
        <div>Внесено, ответ сохранён: <code>{result.answers}</code></div>
        <Lines lines={result.report} />
        {!result.rebuildOk && <div className="signal">Журнал внесён, но производные файлы собраны не все:</div>}
        <details open={!result.rebuildOk}>
          <summary>пересборка: check, render-md, render-html</summary>
          <Lines lines={result.rebuildReport} />
        </details>
      </>
    );
  }
  return (
    <div className="report">
      <button type="button" className="small report-close" onClick={onDismiss} title="убрать отчёт">×</button>
      {body}
    </div>
  );
}

export function ReturnPanel({ prompt, open, applying, blockedReason, result, copied, height, onHeight, onToggle, onApply, onCopy, onDismiss }: ReturnPanelProps) {
  const count = prompt.empty ? 0 : prompt.text.split("\n").filter((l) => /^(- F-|Замечания к схеме:)/.test(l)).length;
  const area = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ startY: number; startHeight: number; last: number | null } | null>(null);
  // Пока тянут, высота живёт здесь: страница не перерисовывает карточки на каждое движение, запоминается итог.
  const [dragged, setDragged] = useState<number | null>(null);
  const shown = dragged ?? height;

  const onHandleDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!area.current) return;
    e.preventDefault();
    // Захват держит движение и отпускание, когда указатель ушёл за край страницы.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* событие без активного указателя */ }
    drag.current = { startY: e.clientY, startHeight: area.current.offsetHeight, last: null };
  };
  const onHandleMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.last = clampPromptHeight(drag.current.startHeight + drag.current.startY - e.clientY, window.innerHeight);
    setDragged(drag.current.last);
  };
  const onHandleUp = () => {
    const last = drag.current?.last ?? null;
    drag.current = null;
    if (last !== null) onHeight(last);
    setDragged(null);
  };

  return (
    <footer className="return">
      {open && (
        <div
          className="return-handle" title="тяни, чтобы изменить высоту промпта; двойной клик — вернуть низкую"
          onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onDoubleClick={() => onHeight(null)}
        />
      )}
      {result && <Report result={result} onDismiss={onDismiss} />}
      <div className="return-bar">
        <button type="button" className="small" onClick={onToggle} title={open ? "свернуть промпт" : "показать промпт"}>{open ? "▾" : "▸"}</button>
        <b>Возврат решений</b>
        <span className="muted">{count ? `строк: ${count}` : "нового нет"}</span>
        {copied && <span className="muted">скопировано</span>}
        <span className="spacer" />
        <button type="button" className="secondary" disabled={prompt.empty} onClick={onCopy}>Скопировать</button>
        <button type="button" className="primary" disabled={prompt.empty || applying || !!blockedReason} title={blockedReason ?? "внести через journal.py apply"} onClick={onApply}>
          {applying ? "Вношу…" : "Внести"}
        </button>
      </div>
      {blockedReason && !prompt.empty && <div className="note accent">{blockedReason}</div>}
      {open && <textarea ref={area} className="prompt-text" readOnly rows={Math.min(8, Math.max(2, prompt.text.split("\n").length))} style={shown === null ? undefined : { height: shown }} value={prompt.text} />}
    </footer>
  );
}
