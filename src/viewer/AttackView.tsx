// Режим «атака»: строки attack/*.md по линзам. Запись журнала и строка атаки — разные сущности: ссылка на запись — переход, не слияние.
import { memo, useRef, type ChangeEvent } from "react";
import { ALL_LENSES, attackAnchor, attackKind, demotion, effectiveLens, fileGroups, isKnownLens, isWarning, lensAnchor, lensFilters, lensLabel, lensTitle, OUTSIDE, readByNotes, readKey, recordIdOf, rowAnchor, setAttackDispute, setAttackRead, setAttackSev, severityLevel, sevMove, verdictState, type SevMark } from "../journal/attack";
import { disputeKey, norm, type Prompt } from "../journal/logic";
import { isHumanOption } from "../journal/ops";
import type { AttackFile, AttackRow, Draft, JournalRecord, ViewPayload } from "../protocol/types";
import { Text } from "../ui/Text";
import { Segmented } from "../ui/Segmented";

const HINT = "По спору apply строку атаки не меняет: её закрывает правка цели (журнала или артефакта) и повторная атака. Исключение — тяжесть: у блокера кнопка «понизить», у предупреждения «повысить»; обоснование пишется в своём скрытом поле (не в поле спора), кнопка берёт его при нажатии, без текста строки о тяжести не будет, а повторное нажатие снимает отметку вместе с обоснованием. Отметка уходит строкой «- тяжесть: <файл> · <раздел> · «<утверждение>» → <тяжесть> — «<обоснование>»» над «Замечания к схеме:»; apply вписывает в ячейку «<тяжесть> (<обоснование>)» и пересчитывает status файла атаки, журнал не меняется. У справки и строк покрытия кнопки нет. Спор по строке (почему опора есть, почему не блокер) уходит в промпт возврата одной строкой «Замечания к схеме:» и ложится в notes[] журнала; ответ на строку с закрытием «вопрос человеку» и разделом «F-NN, decision» уходит словом к решению. Фильтр по линзе прячет группы, но не счётчики тяжести в шапке файла. Переключатель «прочитано» у строки предупреждение уходит текстом «предупреждение прочитано: <раздел>» в ту же строку «Замечания к схеме:» и после apply возвращается флагом по заметке журнала; тяжесть и вердикт он не меняет.";

export const ShaChip = ({ sha, missing }: { sha?: string; missing: string }) =>
  (sha ? <code title={sha}>{sha.slice(0, 12)}</code> : <span className="muted">{missing}</span>);

export function VerdictBadge({ att, journalSha }: { att: AttackFile; journalSha: string | undefined }) {
  switch (verdictState(att, journalSha)) {
    case "stale": return <span className="badge signal">вердикт устарел: журнал изменён после атаки</span>;
    case "match": return <span className="badge muted">хеш журнала совпал</span>;
    case "no-hash": return <span className="badge accent">хеш журнала в атаке не записан</span>;
    case "none": return null;
  }
}

/** Выбранный вариант записи — один вид в «проверке» и в блоке записи «атаки». */
export function PickedOption({ rec }: { rec: JournalRecord }) {
  const picked = rec.options.find((o) => o.letter === rec.decision?.option);
  if (!picked) return null;
  return (
    <div className="picked">
      <span className="letter">{picked.letter}.</span> <Text s={picked.text} />
      {isHumanOption(picked) && <span className="tag plain">добавлен человеком</span>}
      {picked.deviation && <span className="tag accent">отступление от {picked.deviation}</span>}
    </div>
  );
}

function RecordBlock({ rec }: { rec: JournalRecord }) {
  return (
    <details className="recblock">
      <summary>запись {rec.id} — текст вопроса</summary>
      <div className="q"><Text s={rec.question} /></div>
      {rec.decision ? <PickedOption rec={rec} /> : <div className="cons">решения нет — запись открыта</div>}
      <div className="cons"><a href={`#${rec.id}`}>к карточке {rec.id} в режиме «решения»</a></div>
    </details>
  );
}

interface RowProps {
  anchor: string;
  att: AttackFile;
  row: AttackRow;
  records: JournalRecord[];
  value: string;
  mark: SevMark | null;
  readJournal: boolean;
  readState: boolean;
  conflict: boolean;
  undecided: boolean;
  update(fn: (d: Draft) => Draft): void;
}

/** Кнопка тяжести, скрытое поле обоснования и пометка без текста (F-39). Обоснование — из поля карточки, набранное до нажатия. */
function SevBlock({ att, row, mark, update }: { att: AttackFile; row: AttackRow; mark: SevMark | null; update(fn: (d: Draft) => Draft): void }) {
  const move = sevMove(row);
  const key = disputeKey(att.path, row);
  const why = useRef<HTMLTextAreaElement>(null);
  if (!move) return null;
  const pressed = !!mark && mark.to === move.to;
  const onPress = () => {
    const value = why.current?.value ?? "";
    update((d) => setAttackSev(d, key, pressed ? null : { to: move.to, why: value }));
  };
  const onChangeWhy = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (!pressed || !mark) return; // поле пишет в отметку только пока она есть
    update((d) => setAttackSev(d, key, { to: mark.to, why: e.target.value }));
  };
  return (
    <>
      <div className="row sevrow">
        <button type="button" className={`small sev-btn${pressed ? " active" : ""}`} aria-pressed={pressed}
          title="ход тяжести: строка о тяжести уйдёт в промпт возврата, если есть обоснование"
          onClick={onPress}>{move.label}</button>
      </div>
      {pressed && !norm(mark!.why) && <div className="note accent">нет обоснования, строки о тяжести не будет</div>}
      <details className="park sevwhy" open={pressed}>
        <summary>обоснование тяжести — почему {move.label}</summary>
        <div className="row">
          <textarea ref={why} className="sev-why" key={String(pressed)} rows={2} defaultValue={pressed ? mark!.why : ""}
            placeholder="обоснование хода тяжести: уйдёт в промпт возврата и в ячейку тяжести"
            onChange={onChangeWhy} />
        </div>
      </details>
    </>
  );
}

const Row = memo(function Row({ anchor, att, row, records, value, mark, readJournal, readState, conflict, undecided, update }: RowProps) {
  const id = recordIdOf(row.section, records);
  const rec = id ? records.find((r) => r.id === id) : undefined;
  const lowered = demotion(row);
  return (
    <div className={`card attackrow${conflict ? " conflict" : ""}`} id={anchor}>
      <header className="card-head">
        <span className={`badge ${severityLevel(row.severity)}`}>{row.severity}</span>
        {lowered && (lowered.reason
          ? <span className="badge accent">понижено: {lowered.reason}</span>
          : <span className="badge signal">понижение без причины</span>)}
        <span className="badge plain">{id ? <a href={`#${id}`} title={`к записи ${id} в режиме «решения»`}>{row.section}</a> : row.section}</span>
        {isWarning(row) && (readJournal
          ? <span className="badge muted" title="заметка notes[] журнала">прочитано · в журнале</span>
          : readState
            ? <span className="badge accent" title="отметка в браузере, в журнал ещё не внесена">прочитано · не внесено</span>
            : null)}
        {isWarning(row) && (
          <label className="readtoggle" title={readJournal ? "внесено в журнал" : "отметить прочитанным: текст уйдёт в «Замечания к схеме:» промпта возврата"}>
            <input type="checkbox" checked={readJournal || readState} disabled={readJournal}
              onChange={(e) => update((d) => setAttackRead(d, readKey(att, row), e.target.checked))} /> прочитано
          </label>
        )}
        {!isKnownLens(att, row.lens) && <span className="badge signal">линза «{row.lens}» вне списка — строка невалидна</span>}
      </header>
      <h3 className="q"><Text s={row.claim} /></h3>
      <div className="cons">инвариант: <Text s={row.invariant} /></div>
      <div className="cons">опора: <Text s={row.support} /></div>
      <div className="cons">чем закрыть: <Text s={row.fix} /></div>
      {rec && <RecordBlock rec={rec} />}
      <SevBlock att={att} row={row} mark={mark} update={update} />
      {undecided && <div className="note accent">запись не решена — ответ уйдёт в замечания; выбери вариант в карточке</div>}
      {conflict && <div className="note signal">конфликт ответов к одному решению — оставь один, иначе слово к решению не уйдёт в промпт</div>}
      <div className="row">
        <textarea
          className="dispute" rows={2} value={value} placeholder="спор: почему опора есть / почему не блокер — уйдёт в промпт возврата; при закрытии «вопрос человеку» и разделе F-NN, decision — слово к решению"
          onChange={(e) => update((d) => setAttackDispute(d, disputeKey(att.path, row), e.target.value))}
        />
      </div>
    </div>
  );
});

function FileHeader({ att, journalSha }: { att: AttackFile; journalSha: string | undefined }) {
  const fm = att.frontmatter;
  const { severityCounts: s, lensCounts, outside } = fileGroups(att);
  return (
    <div className="card">
      <header className="card-head">
        <span className="rid">{att.path}</span>
        <span className={`badge ${fm?.status === "passed" ? "muted" : "accent"}`}>status: {fm?.status || "—"}</span>
        <VerdictBadge att={att} journalSha={journalSha} />
        <span className="badge muted">{attackKind(att) === "journal" ? "линзы журнала" : "линзы артефактов"}</span>
      </header>
      <div className="meta">
        цели: {(fm?.targets ?? []).map((t) => <span className="chip" key={t.path}>{t.path} <ShaChip sha={t.sha256} missing="без хеша" /></span>)}
      </div>
      <div className="counters">
        по тяжести, весь файл: блокеров <b className={s.блокер ? "signal" : ""}>{s.блокер}</b> · предупреждений <b className={s.предупреждение ? "accent" : ""}>{s.предупреждение}</b> · справок <b>{s.справка}</b>
        {s.прочих > 0 && <> · прочих <b>{s.прочих}</b></>}
      </div>
      <div className="counters">
        по линзе: {lensCounts.map(([slug, n], i) => <span key={slug}>{i > 0 && " · "}<code>{slug}</code> <b>{n}</b></span>)}
        {outside > 0 && <> · строк вне списка (невалидны, в счётчике линз их нет): <b className="signal">{outside}</b></>}
      </div>
    </div>
  );
}

/** Фильтр по линзе: в шапке страницы, чтобы выбранный оставался на виду при прокрутке. */
export function LensFilter({ attacks, lens, onLens }: { attacks: AttackFile[]; lens: string; onLens(lens: string): void }) {
  const filters = lensFilters(attacks);
  return (
    <Segmented
      label="линза:" className="lensfilter" value={effectiveLens(lens, attacks)} onChange={onLens}
      items={[{ value: ALL_LENSES, label: `все · ${filters.total}` }, ...filters.lenses.map(([slug, n]) => ({ value: slug, label: `${lensTitle(slug)} · ${n}` }))]}
    />
  );
}

export interface AttackViewProps {
  payload: ViewPayload;
  draft: Draft;
  flags: Prompt;
  lens: string;
  update(fn: (d: Draft) => Draft): void;
}

export function AttackView({ payload, draft, flags, lens, update }: AttackViewProps) {
  if (!payload.attacks.length) return <div className="empty">Атаки ещё нет: у изменения нет файлов <code>attack/*.md</code>.</div>;
  const current = effectiveLens(lens, payload.attacks);
  const conflict = new Set(flags.conflictKeys);
  const undecided = new Set(flags.undecidedKeys);
  return (
    <div className="view">
      <details className="howto">
        <summary>как устроен режим</summary>
        <div className="hint">{HINT}</div>
      </details>
      {payload.attacks.map((att, file) => {
        if (att.error) return <div className="note signal block" id={attackAnchor(file)} key={att.path}>Файл атаки не разобран: {att.error}</div>;
        const shown = fileGroups(att).groups.filter((g) => current === ALL_LENSES || g.slug === current);
        const index = new Map((att.rows ?? []).map((r, i) => [r, i]));
        return (
          <section key={att.path}>
            <div id={attackAnchor(file)}><FileHeader att={att} journalSha={payload.sha256} /></div>
            {shown.length === 0 && <div className="cons">по фильтру в этом файле строк нет</div>}
            {shown.map((g) => (
              <div key={g.slug}>
                <h2 id={lensAnchor(file, g.slug)}>{g.slug === OUTSIDE ? "вне списка — слуг не из закрытого списка линз файла" : <><code>{g.slug}</code> · {lensLabel(att, g.slug)}</>} · {g.count}</h2>
                {g.severities.map((part) => (
                  <div key={part.severity}>
                    <h3>{part.severity} · {part.rows.length}</h3>
                    {part.rows.map((row, i) => {
                      const key = disputeKey(att.path, row);
                      return <Row key={`${key}|${i}`} anchor={rowAnchor(file, index.get(row)!)} att={att} row={row} records={payload.records} value={draft.attackDisputes[key] ?? ""} mark={draft.attackSevs[key] ?? null} readJournal={readByNotes(payload.notes, row)} readState={!!draft.attackReads[readKey(att, row)]} conflict={conflict.has(key)} undecided={undecided.has(key)} update={update} />;
                    })}
                  </div>
                ))}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
