// Карточки журнала на React — по составу DOM как настоящая карточка: варианты, улики, рекомендация, слово.
import { memo, useCallback, useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { flushSync } from "react-dom";

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const Text = ({ s }: { s: string }) => <>{String(s ?? "").split(/`([^`]+)`/).map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))}</>;

const Evidence = ({ ev }: { ev: any }) => (
  <span className="ev">
    улика: <code>{ev.line ? `${ev.path}:${ev.line}` : ev.path}</code> «{ev.quote}»{" "}
    {ev.found ? <b className="ok">сверено</b> : ev.found === null ? <b>не проверить</b> : <b className="bad">не найдено: {ev.verdict ?? ""}</b>}
  </span>
);

const Card = memo(function Card({ rec, draft, onChoose, onWord }: any) {
  const chosen = draft?.choice ?? rec.decision?.option ?? null;
  return (
    <article className="card" id={rec.id}>
      <h3><span className="id">{rec.id}</span><Text s={rec.question} /></h3>
      <div>{rec.kind} · {rec.status}{rec.addressee ? ` · ${rec.addressee}` : ""}</div>
      {rec.depends_on.length > 0 && <div>зависит от: {rec.depends_on.join(", ")}</div>}
      {rec.options.map((o: any) => (
        <label className="opt" key={o.letter}>
          <input type="radio" name={rec.id} checked={chosen === o.letter} onChange={() => onChoose(rec.id, o.letter)} />{" "}
          <b>{o.letter}.</b> <Text s={o.text} />
          {o.unlikely && <em> — маловероятно: <Text s={o.unlikely} /></em>}
          {o.evidence.map((ev: any, i: number) => <Evidence ev={ev} key={i} />)}
        </label>
      ))}
      {rec.evidence.map((ev: any, i: number) => <Evidence ev={ev} key={i} />)}
      {rec.recommendation && <div className="rec">рекомендация: {rec.recommendation.option} — <Text s={rec.recommendation.why} /></div>}
      {rec.decision && <div>слово в журнале: «{rec.decision.word}»</div>}
      {rec.consequences && <div><Text s={rec.consequences} /></div>}
      {rec.parking.map((p: any, i: number) => <div key={i}>парковка → {p.addressee}: <Text s={p.text} /></div>)}
      <textarea rows={2} placeholder="слово человека" value={draft?.word ?? ""} onChange={(e) => onWord(rec.id, e.target.value)} />
    </article>
  );
});

let setFilterOutside: (ids: string[] | null) => void = () => {};

function App({ records }: { records: any[] }) {
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [filter, setFilter] = useState<string[] | null>(null);
  setFilterOutside = setFilter;
  const onChoose = useCallback((id: string, choice: string) => setDrafts((d) => ({ ...d, [id]: { ...d[id], choice } })), []);
  const onWord = useCallback((id: string, word: string) => setDrafts((d) => ({ ...d, [id]: { ...d[id], word } })), []);
  const shown = useMemo(() => (filter ? records.filter((r) => filter.includes(r.id)) : records), [records, filter]);
  return <main>{shown.map((r) => <Card key={r.id} rec={r} draft={drafts[r.id]} onChoose={onChoose} onWord={onWord} />)}</main>;
}

const host = document.getElementById("root")!;
let root: Root | null = null;

const afterPaint = () => new Promise<boolean>((resolve) => {
  const guard = setTimeout(() => resolve(false), 3000);
  requestAnimationFrame(() => setTimeout(() => { clearTimeout(guard); resolve(true); }, 0));
});
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const stats = (a: number[]) => ({ median: +median(a).toFixed(2), max: +Math.max(...a).toFixed(2), n: a.length });

async function bench() {
  const cards = [...document.querySelectorAll<HTMLElement>(".card")];
  const radios = cards.map((c) => [...c.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((r) => !r.checked)).filter(Boolean).slice(0, 20) as HTMLInputElement[];
  const click: number[] = [];
  for (const r of radios) {
    const t0 = performance.now();
    r.click();
    await Promise.resolve();
    click.push(performance.now() - t0);
  }
  const area = cards[0].querySelector("textarea")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  const keys: number[] = [];
  for (let i = 1; i <= 30; i++) {
    const t0 = performance.now();
    setValue.call(area, "слово".repeat(i).slice(0, i));
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    keys.push(performance.now() - t0);
  }
  const keyApplied = area.value === "слово".repeat(30).slice(0, 30);
  const ids = cards.slice(0, 5).map((c) => c.id);
  const t0 = performance.now();
  flushSync(() => setFilterOutside(ids));
  const filterOn = performance.now() - t0;
  const t1 = performance.now();
  flushSync(() => setFilterOutside(null));
  const filterOff = performance.now() - t1;
  vscode.postMessage({ type: "bench", checked: radios.filter((r) => r.checked).length, radios: radios.length,
    click: stats(click), key: stats(keys), keyApplied, filterOn: +filterOn.toFixed(2), filterOff: +filterOff.toFixed(2) });
}

window.addEventListener("message", async (ev) => {
  const m = ev.data;
  if (m.type === "load") {
    const transferMs = Date.now() - m.sentAt;
    root?.unmount();
    root = createRoot(host);
    const t0 = performance.now();
    flushSync(() => root!.render(<App records={m.records} />));
    const commit = performance.now() - t0;
    const painted = await afterPaint();
    vscode.postMessage({ type: "loaded", transferMs, commit: +commit.toFixed(1), paint: +(performance.now() - t0).toFixed(1), painted,
      cards: document.querySelectorAll(".card").length, dom: document.querySelectorAll("*").length,
      heapMb: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : null });
  } else if (m.type === "update") {
    const t0 = performance.now();
    flushSync(() => root!.render(<App records={m.records} />));
    vscode.postMessage({ type: "updated", ms: +(performance.now() - t0).toFixed(1), first: document.querySelector(".card h3")?.textContent ?? "" });
  } else if (m.type === "bench") {
    await bench();
  } else if (m.type === "filter") {
    const t0 = performance.now();
    flushSync(() => setFilterOutside(m.ids));
    vscode.postMessage({ type: "filtered", visible: [...document.querySelectorAll(".card")].map((c) => c.id), ms: +(performance.now() - t0).toFixed(2) });
  }
});
vscode.postMessage({ type: "ready" });
