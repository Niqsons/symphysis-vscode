// Страница просмотрщика: один журнал, три режима. Хост присылает журнал и черновик; черновик человек правит здесь,
// хост его только сохраняет. Пока Python работает, на экране остаётся прежний журнал.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ALL_LENSES, lensFilters } from "../shared/attack";
import { buildPrompt, chosen, cleanupIngested, effectiveDeps, emptyDraft, antipodesOf } from "../shared/logic";
import { addNewFork, hasNodes, inNode, localDate, matchesRecordFilter, removeNewFork, setNotes, stats } from "../shared/ops";
import { DEFAULT_UI, type ApplyReport, type HostMessage, type JournalView, type PageMessage, type RecordFilter, type UiState, type ViewMode } from "../shared/protocol";
import { nodeInScheme } from "../shared/scheme";
import { NOTES_ANCHOR } from "../shared/search";
import type { Draft, JournalRecord, ViewPayload } from "../shared/types";
import { AttackView, LensFilter } from "./AttackView";
import { Card, Text, type CardContext } from "./Card";
import { CheckView } from "./CheckView";
import { FailureText } from "./FailureText";
import { applyColors } from "./colors";
import { ReturnPanel } from "./ReturnPanel";
import { Segmented } from "./Segmented";

const MODES: { mode: ViewMode; label: string; title: string }[] = [
  { mode: "decisions", label: "решения", title: "круг просмотрщика: варианты, слово, парковка, промпт возврата" },
  { mode: "check", label: "проверка", title: "снимок решений перед proposal, только чтение" },
  { mode: "attack", label: "атака", title: "строки attack/*.md по линзам" },
];

const NOTHING_SHOWN: Record<RecordFilter, string> = {
  all: "В журнале нет записей.",
  forks: "Развилок нет.",
  open: "Открытых развилок нет.",
  facts: "Фактов нет.",
};

declare const acquireVsCodeApi: () => { postMessage(m: PageMessage): void };
const vscode = acquireVsCodeApi();
const post = (m: PageMessage) => vscode.postMessage(m);

const SAVE_DELAY_MS = 200;

/** Записи, чей выбор меняет вид этой карточки: зависимости и антиподы. Дальше строка выбора — признак перерисовки для memo. */
function relatedIds(p: ViewPayload, rec: JournalRecord): string[] {
  const ids = new Set(rec.depends_on);
  for (const o of rec.options) for (const k of antipodesOf(p.records, rec.id, o.letter)) ids.add(k.split(".")[0]);
  return [...ids];
}

function NewForks({ draft, update }: { draft: Draft; update(fn: (d: Draft) => Draft): void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState("");
  const [word, setWord] = useState("");
  const add = () => {
    if (!question.trim()) return;
    update((d) => addNewFork(d, question, options, word));
    setQuestion(""); setOptions(""); setWord("");
  };
  return (
    <section className="newforks">
      <details>
        <summary>Развилка, которой нет в журнале{draft.newForks.length > 0 ? ` (${draft.newForks.length})` : ""}</summary>
        <div className="row"><input type="text" placeholder="вопрос" value={question} onChange={(e) => setQuestion(e.target.value)} /></div>
        <div className="row"><textarea rows={2} placeholder="варианты — по одному на строку" value={options} onChange={(e) => setOptions(e.target.value)} /></div>
        <div className="row"><textarea rows={2} placeholder="слово: почему это развилка и что рекомендуешь" value={word} onChange={(e) => setWord(e.target.value)} /></div>
        <div className="row"><button type="button" className="small" onClick={add}>добавить развилку</button></div>
      </details>
      {draft.newForks.map((f) => (
        <div className="card" id={f.id} key={f.id}>
          <header className="card-head">
            <span className="rid">{f.id}</span>
            <span className="badge plain">добавлена человеком</span>
            <span className="spacer" />
            <button type="button" className="small" onClick={() => update((d) => removeNewFork(d, f.id))}>убрать</button>
          </header>
          <h3 className="q"><Text s={f.question} /></h3>
          <div className="meta">варианты: <Text s={f.options.replace(/\n+/g, " · ")} /></div>
          {f.word && <div className="cons"><Text s={f.word} /></div>}
        </div>
      ))}
    </section>
  );
}

export function App() {
  const [view, setView] = useState<JournalView | null>(null);
  const [draft, setDraftState] = useState<Draft>(emptyDraft);
  const [ui, setUi] = useState<UiState>(DEFAULT_UI);
  const [damaged, setDamaged] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [nodeFilter, setNodeFilter] = useState<string | null>(null);

  const draftRef = useRef(draft);
  const uiRef = useRef(ui);
  const scrollByMode = useRef<Partial<Record<ViewMode, number>>>({});
  const keyRef = useRef<string | null>(null);
  const payloadRef = useRef<ViewPayload | null>(null);
  const applyingRef = useRef(false);
  const ownShas = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const nodeRef = useRef<string | null>(null);
  const pendingNode = useRef<string | null>(null);

  const flush = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (keyRef.current) post({ type: "draft", key: keyRef.current, draft: draftRef.current });
  }, []);

  const putDraft = useCallback((next: Draft) => {
    draftRef.current = next;
    setDraftState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; if (keyRef.current) post({ type: "draft", key: keyRef.current, draft: draftRef.current }); }, SAVE_DELAY_MS);
  }, []);

  const update = useCallback((fn: (d: Draft) => Draft) => {
    const next = fn(draftRef.current);
    if (next !== draftRef.current) putDraft(next);
  }, [putDraft]);

  const putUi = useCallback((next: UiState, sync = false) => {
    uiRef.current = next;
    if (sync) flushSync(() => setUi(next));
    else setUi(next);
    post({ type: "ui", ui: next });
  }, []);

  const setMode = useCallback((mode: ViewMode, sync = false) => {
    scrollByMode.current[uiRef.current.mode] = mainRef.current?.scrollTop ?? 0;
    putUi({ ...uiRef.current, mode }, sync);
  }, [putUi]);

  const putNode = useCallback((id: string | null) => {
    nodeRef.current = id;
    setNodeFilter(id);
  }, []);

  /** Клик по узлу: режим «решения», условие рядом с «показать»; повторный клик снимает (F-27). Данных ещё нет — подождёт их. */
  const onNode = useCallback((id: string) => {
    const p = payloadRef.current;
    if (!p) { pendingNode.current = id; return; }
    if (!hasNodes(p)) { setNotice("Записи журнала не связаны со схемой: поля nodes нет ни у одной."); return; }
    const next = nodeRef.current === id ? null : id;
    if (next && uiRef.current.mode !== "decisions") setMode("decisions");
    putNode(next);
  }, [putNode, setMode]);

  const reveal = useCallback((id: string, mode?: ViewMode) => {
    const show = (next: Partial<UiState>) => {
      scrollByMode.current[uiRef.current.mode] = mainRef.current?.scrollTop ?? 0;
      putUi({ ...uiRef.current, ...next }, true);
    };
    // Сначала режим, и только если цель всё ещё скрыта — снятие фильтра: снятие запоминается, как снятие руками, зря его не делаем.
    if (mode && uiRef.current.mode !== mode) show({ mode });
    if (!mode && !document.getElementById(id) && uiRef.current.mode !== "decisions") show({ mode: "decisions" });
    // Цель скрыта условием «узел X»: условие снимается, как снимается фильтр (F-75).
    if (!document.getElementById(id) && nodeRef.current) flushSync(() => putNode(null));
    if (!document.getElementById(id)) show(uiRef.current.mode === "attack" ? { attackLens: ALL_LENSES } : { recordFilter: "all" });
    const el = document.getElementById(id);
    if (!el) return;
    el.closest("details")?.setAttribute("open", "");
    el.scrollIntoView({ block: "start" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  }, [putNode, putUi]);

  // У каждого режима своя прокрутка: вернулся из «атаки» — карточки там же, где были.
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = scrollByMode.current[ui.mode] ?? 0;
  }, [ui.mode]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent<HostMessage>) => {
      const m = ev.data;
      if (m.type === "show") {
        flush();
        if (keyRef.current !== m.view.key) putNode(null);
        keyRef.current = m.view.key;
        payloadRef.current = m.view.payload;
        ownShas.current.clear();
        scrollByMode.current = {};
        applyColors(m.colors);
        uiRef.current = m.ui;
        setUi(m.ui);
        setView(m.view);
        setDamaged(m.damagedDraft);
        setNotice(null);
        setResult(null);
        applyingRef.current = false;
        setApplying(false);
        const clean = m.view.payload ? cleanupIngested(m.view.payload, m.draft) : m.draft;
        draftRef.current = clean;
        setDraftState(clean);
        if (clean !== m.draft) post({ type: "draft", key: m.view.key, draft: clean });
        mainRef.current?.scrollTo(0, 0);
      } else if (m.type === "journal") {
        if (m.view.key !== keyRef.current) return;
        const before = payloadRef.current;
        if (m.view.payload) {
          const sha = m.view.payload.sha256;
          const foreign = before && sha !== before.sha256 && !applyingRef.current && !(sha && ownShas.current.has(sha));
          if (foreign) {
            const known = new Set(before.records.map((r) => r.id));
            const added = m.view.payload.records.filter((r) => !known.has(r.id)).map((r) => r.id);
            setNotice(added.length ? `Журнал обновлён снаружи, новые записи: ${added.join(", ")}` : "Журнал обновлён снаружи");
          }
          payloadRef.current = m.view.payload;
          const clean = cleanupIngested(m.view.payload, draftRef.current);
          if (clean !== draftRef.current) putDraft(clean);
          if (pendingNode.current) {
            const id = pendingNode.current;
            pendingNode.current = null;
            onNode(id);
          }
        }
        setView((v) => ({ ...m.view, payload: m.view.payload ?? v?.payload ?? null }));
      } else if (m.type === "colors") {
        applyColors(m.colors);
      } else if (m.type === "reveal") {
        reveal(m.id, m.mode);
      } else if (m.type === "node") {
        onNode(m.id);
      } else if (m.type === "applied") {
        if (m.key !== keyRef.current) return;
        if (m.result.stage === "applied" && m.result.sha256After) ownShas.current.add(m.result.sha256After);
        applyingRef.current = false;
        setApplying(false);
        setResult(m.result);
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [flush, onNode, putDraft, putNode, reveal]);

  const payload = view?.payload ?? null;
  const ctx: CardContext | null = useMemo(() => (payload ? { payload, getDraft: () => draftRef.current, update } : null), [payload, update]);
  const related = useMemo(() => new Map(payload?.records.map((r) => [r.id, relatedIds(payload, r)]) ?? []), [payload]);
  const prompt = useMemo(() => (payload ? buildPrompt(payload, draft, localDate()) : null), [payload, draft]);
  const counts = useMemo(() => (payload ? stats(payload, draft) : null), [payload, draft]);
  const attackRows = useMemo(() => (payload ? lensFilters(payload.attacks).total : 0), [payload]);

  const onApply = () => {
    if (!prompt || !payload || !keyRef.current) return;
    flush();
    applyingRef.current = true;
    setApplying(true);
    setResult(null);
    post({ type: "apply", key: keyRef.current, text: prompt.text, shownSha: payload.sha256, date: localDate() });
  };

  const onCopy = () => {
    if (!prompt) return;
    post({ type: "copy", text: prompt.text });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!view) return <div className="empty">Выбери изменение в боковой панели Symphysis.</div>;

  // Перечитывание «Внести» не закрывает: от устаревшего показа защищает сверка хеша, а кнопка не мигает при каждой записи агента.
  const blockedReason = view.failure?.kind === "contract" ? "Плагин и инструменты symphysis расходятся — сначала обнови" : view.failure ? "Журнал сейчас негоден — вносить не во что" : prompt?.conflictKeys.length ? "Два разных ответа к одному решению — оставь один" : null;
  const inCondition = (r: JournalRecord) => !nodeFilter || inNode(r, nodeFilter);
  const shown = payload?.records.filter((r) => matchesRecordFilter(payload, draft, r, ui.recordFilter) && inCondition(r)) ?? [];
  // Условие не прячет, что вне узла что-то не решено: счётчик идёт по всему журналу (F-104).
  const hiddenOpen = payload ? payload.records.filter((r) => matchesRecordFilter(payload, draft, r, "open") && !inCondition(r)).length : 0;
  const missingNodes = (r: JournalRecord) => (view.scheme ? (r.nodes ?? []).filter((n) => !nodeInScheme(view.scheme!, n)).join(", ") : "");
  const links = (rec: JournalRecord) => {
    if (!payload) return "";
    const ids = new Set([...(related.get(rec.id) ?? []), ...effectiveDeps(rec, draft).map((x) => x.id)]);
    return [...ids].map((id) => `${id}:${chosen(payload, draft, id) ?? ""}`).join();
  };

  return (
    <div className="page">
      <header className="top">
        <div className="top-row">
          <h1 title={payload?.title}>{view.name}</h1>
          <Segmented
            className="modes" value={ui.mode} onChange={(mode) => setMode(mode)}
            items={MODES.map(({ mode, label, title }) => ({ value: mode, title, label: `${label}${mode === "attack" && attackRows > 0 ? ` · ${attackRows}` : ""}` }))}
          />
          <button type="button" className="small" onClick={() => post({ type: "openScheme", key: view.key })} title="схема решения рядом: scheme.md этого изменения">схема</button>
          <span className="spacer" />
          {view.loading && ui.mode !== "decisions" && <span className="muted">перечитывается…</span>}
          {ui.mode !== "check" && <button type="button" className="small" onClick={() => post({ type: "reset", key: view.key })} title="убрать весь черновик этого журнала">Сбросить</button>}
        </div>
        {/* Фильтры в шапке: выбранный на виду при любой прокрутке. */}
        {counts && payload && ui.mode === "decisions" && (
          <Segmented
            label="показать:" className="recordfilter" value={ui.recordFilter} onChange={(recordFilter) => putUi({ ...uiRef.current, recordFilter })}
            items={[
              { value: "all", label: `все · ${payload.records.length}` },
              { value: "forks", label: `развилки · ${counts.forks}` },
              { value: "open", label: `открытые · ${counts.open}` },
              { value: "facts", label: `факты · ${counts.facts}` },
            ]}
          />
        )}
        {nodeFilter && ui.mode === "decisions" && (
          <div className="nodefilter">только узел <b>{nodeFilter}</b> <button type="button" className="small" title="снять условие" onClick={() => putNode(null)}>×</button></div>
        )}
        {payload && ui.mode === "attack" && payload.attacks.length > 0 && (
          <LensFilter attacks={payload.attacks} lens={ui.attackLens} onLens={(attackLens) => putUi({ ...uiRef.current, attackLens })} />
        )}
        {counts && payload && ui.mode === "decisions" && (
          <div className="stats">
            развилок <b>{counts.forks}</b> · решено <b>{counts.decided}</b>{counts.changed > 0 && <> · изменено здесь <b className="accent">{counts.changed}</b></>}
            {" "}· открыто <b className={counts.open ? "accent" : ""}>{counts.open}</b>{hiddenOpen > 0 && <> · из них скрыто условием <b className="accent">{hiddenOpen}</b></>} · с парковкой <b>{counts.parked}</b> · фактов <b>{counts.facts}</b>
            {counts.disputed > 0 && <> · оспорено <b>{counts.disputed}</b></>}
            {counts.newForks > 0 && <> · новых развилок <b>{counts.newForks}</b></>}
            {" "}· <span className="muted">улик сверено {payload.stats.evidence_found} из {payload.stats.evidence_total}</span>
            {counts.quoteMissing > 0 && <> · <b className="signal">цитат не найдено: {counts.quoteMissing}</b></>}
            {view.loading && <span className="muted"> · перечитывается…</span>}
          </div>
        )}
      </header>
      <main ref={mainRef} onClick={(e) => {
        const link = (e.target as HTMLElement).closest("a[href^='#']");
        if (!link) return;
        e.preventDefault();
        reveal(link.getAttribute("href")!.slice(1));
      }}>
        {view.failure && <div className={`note ${view.failure.kind === "no-journal" ? "" : "signal"} block`}><FailureText failure={view.failure} openPythonSetting={() => post({ type: "openPythonSetting" })} />{payload && <div className="muted">Ниже — журнал, каким он был до этого.</div>}</div>}
        {damaged && <div className="note signal block">Файл черновика был испорчен и отложен: <code>{damaged}</code>. Начат пустой черновик.</div>}
        {notice && <div className="note accent block">{notice} <button type="button" className="small" onClick={() => setNotice(null)}>×</button></div>}
        {payload && ui.mode === "check" && <CheckView payload={payload} />}
        {payload && prompt && ui.mode === "attack" && (
          <AttackView payload={payload} draft={draft} flags={prompt} lens={ui.attackLens} update={update} />
        )}
        {ctx && ui.mode === "decisions" && (
          <>
            <NewForks draft={draft} update={update} />
            {shown.map((rec) => (
              <Card key={rec.id} rec={rec} ctx={ctx} entry={draft.decisions[rec.id]} added={draft.added[rec.id]} deps={draft.deps[rec.id]} dispute={draft.disputes[rec.id]} links={links(rec)} missingNodes={missingNodes(rec)} />
            ))}
            {payload && shown.length === 0 && <div className="empty">{nodeFilter ? `У узла ${nodeFilter} записей нет.` : NOTHING_SHOWN[ui.recordFilter]}</div>}
            {/* Якорь на свёрнутом блоке: переход из поиска его раскрывает. Заметок журнала нет — ведёт к полю. */}
            <section className="notes" id={payload?.notes.length ? undefined : NOTES_ANCHOR}>
              <h2>Замечания к схеме и плану</h2>
              <textarea rows={3} placeholder="что не так в схеме работы, в поставках, в этапах" value={draft.notes} onChange={(e) => update((d) => setNotes(d, e.target.value))} />
              {payload && payload.notes.length > 0 && (
                <details id={NOTES_ANCHOR}>
                  <summary>заметки в журнале ({payload.notes.length})</summary>
                  {payload.notes.map((n, i) => <div className="cons" key={i}>{n.date}: <Text s={n.text} /></div>)}
                </details>
              )}
            </section>
          </>
        )}
      </main>
      {/* «Проверка» ничего не возвращает: панели возврата в ней нет. */}
      {prompt && ui.mode !== "check" && (
        <ReturnPanel
          prompt={prompt} open={ui.promptOpen} applying={applying} blockedReason={blockedReason} result={result} copied={copied}
          height={ui.promptHeight} onHeight={(promptHeight) => putUi({ ...ui, promptHeight })}
          onToggle={() => putUi({ ...ui, promptOpen: !ui.promptOpen })} onApply={onApply} onCopy={onCopy} onDismiss={() => setResult(null)}
        />
      )}
    </div>
  );
}
