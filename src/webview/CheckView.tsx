// Режим «проверка»: снимок решений перед proposal. Только чтение: режим ничего не пишет и вердиктом не считается — вердикт у атаки.
import { journalTarget } from "../shared/attack";
import { checkSnapshot, isOneWay } from "../shared/check";
import { isHumanOption } from "../shared/ops";
import { NOTES_ANCHOR } from "../shared/search";
import { ADDRESSEES, type JournalRecord, type ViewPayload } from "../shared/types";
import { PickedOption, ShaChip, VerdictBadge } from "./AttackView";
import { EvidenceLine } from "./Card";
import { Text } from "./Text";

function Record({ rec, anchor }: { rec: JournalRecord; anchor: boolean }) {
  const isFact = rec.kind === "факт";
  const dest = rec.destination;
  return (
    <article className={`card${isFact ? " fact" : ""}`} id={anchor ? rec.id : undefined}>
      <header className="card-head">
        <span className="rid">{rec.id}</span>
        <span className="badge muted">{rec.kind} · {rec.status}</span>
        {rec.delivery && <span className="badge muted">{rec.delivery}</span>}
        {isOneWay(rec) && <span className="badge accent">в одну сторону</span>}
        {dest && <span className="badge plain" title="куда уйдёт — по правилам render-design">→ {dest.label}{dest.note ? ` · ${dest.note}` : ""}</span>}
      </header>
      <h3 className="q"><Text s={rec.question} /></h3>
      {rec.decision && <PickedOption rec={rec} />}
      {rec.decision?.word && <div className="note"><b>слово ({rec.decision.date || "без даты"}):</b> «<Text s={rec.decision.word} />»</div>}
      {rec.reversibility && <div className="cons">обратимость: {rec.reversibility.level}{rec.reversibility.why && <> — <Text s={rec.reversibility.why} /></>}</div>}
      {rec.outcome && <div className="cons">исход: {rec.outcome.kind} — <b>{rec.outcome.value}</b>{rec.outcome.reason && <> — <Text s={rec.outcome.reason} /></>}</div>}
      {!rec.decision && !isFact && (
        <>
          {rec.options.map((o) => (
            <div className="picked plain" key={o.letter}>
              <span className="letter">{o.letter}.</span> <Text s={o.text} />
              {o.unlikely && <span className="tag muted">маловероятно</span>}
              {isHumanOption(o) && <span className="tag plain">добавлен человеком</span>}
              {o.deviation && <span className="tag accent">отступление от {o.deviation}</span>}
              {o.unlikely && <span className="ev">маловероятно: <Text s={o.unlikely} /></span>}
            </div>
          ))}
          {rec.recommendation && (
            <div className="rec">рекомендация: {rec.recommendation.text
              ? <Text s={rec.recommendation.text} />
              : <><b>{rec.recommendation.option}</b> — <Text s={rec.recommendation.why} /></>}
            </div>
          )}
        </>
      )}
      {rec.decision && rec.options.some((o) => isHumanOption(o) && o.letter !== rec.decision!.option) && (
        <div className="cons">добавлены человеком: {rec.options.filter((o) => isHumanOption(o) && o.letter !== rec.decision!.option).map((o) => `${o.letter}. ${o.text}`).join("; ")}</div>
      )}
      {isFact && (
        <>
          {rec.evidence.map((ev, i) => <EvidenceLine ev={ev} key={i} />)}
          {rec.dispute.trim() ? <div className="note"><b>спор:</b> <Text s={rec.dispute} /></div> : <div className="cons">спора нет</div>}
        </>
      )}
      {rec.consequences && <div className="cons">следствия: <Text s={rec.consequences} /></div>}
    </article>
  );
}

function Section({ title, records, anchor }: { title: string; records: JournalRecord[]; anchor(rec: JournalRecord): boolean }) {
  return (
    <>
      <h2>{title} · {records.length}</h2>
      {records.length === 0 ? <div className="cons">—</div> : records.map((rec) => <Record rec={rec} anchor={anchor(rec)} key={rec.id} />)}
    </>
  );
}

export function CheckView({ payload }: { payload: ViewPayload }) {
  const s = checkSnapshot(payload);
  const snapshot = payload.attacks.find((a) => journalTarget(a));
  const { counts } = s;
  return (
    <div className="view">
      <div className="card">
        <header className="card-head">
          <span className="rid">снимок</span>
          <span className="badge muted">{payload.source}</span>
          <span className="badge muted">sha256 журнала: <ShaChip sha={payload.sha256} missing="нет" /></span>
          {snapshot
            ? <><span className={`badge ${snapshot.frontmatter?.status === "passed" ? "muted" : "accent"}`}>атака: {snapshot.frontmatter?.status || "—"}</span><VerdictBadge att={snapshot} journalSha={payload.sha256} /></>
            : <span className="badge muted">атаки нет</span>}
        </header>
        <h3 className="q"><Text s={payload.title} /></h3>
        <div className="cons">только чтение: режим ничего не пишет и вердиктом не считается — снимок решений перед proposal и spec.md; «→» у записи — куда она уйдёт по правилам render-design</div>
      </div>
      <div className="counters">
        решено <b>{counts.decided}</b> · открыто <b className={counts.open ? "accent" : ""}>{counts.open}</b> · припарковано: {ADDRESSEES.map((a) => `${a} ${counts.parked[a]}`).join(" / ")}
        {" "}· фактов оспорено <b>{counts.disputedFacts}</b> · улик не найдено <b className={counts.evidenceSignal ? "signal" : ""}>{counts.evidenceMissing}</b>
      </div>

      <h2>Решено — по дате решения · {s.decided.length}</h2>
      {s.decidedByDate.length === 0 && <div className="cons">—</div>}
      {s.decidedByDate.map((g) => (
        <div key={g.date}>
          <h3>{g.date || "без даты"} · {g.records.length}</h3>
          {g.records.map((rec) => <Record rec={rec} anchor key={rec.id} />)}
        </div>
      ))}
      <Section title="Открытые развилки — с рекомендацией" records={s.open} anchor={() => true} />
      {/* Открытая проба стоит и выше: якорь один, у первого появления. */}
      <Section title="Пробы — с исходом" records={s.probes} anchor={(rec) => !!rec.decision} />
      <Section title="Факты — улики и спор" records={s.facts} anchor={() => true} />

      <h2>Парковки — по адресатам · {s.parkingTotal}</h2>
      {s.parkings.length === 0 && <div className="cons">—</div>}
      {s.parkings.map((g) => (
        <div key={g.addressee}>
          <h3>→ {g.addressee} · {g.items.length} {g.destination && <span className="badge plain">{g.destination}</span>}</h3>
          {g.items.map((p, i) => (
            <div className="parkitem" key={i}>
              <span className="who">{p.rec}</span>
              <span><Text s={p.text} />{p.finding && <> — <b>находка:</b> <Text s={p.finding} /></>}</span>
            </div>
          ))}
        </div>
      ))}

      <h2 id={NOTES_ANCHOR}>Заметки · {payload.notes.length}</h2>
      {payload.notes.length === 0 ? <div className="cons">—</div> : payload.notes.map((n, i) => <div className="cons" key={i}>{n.date} — <Text s={n.text} /></div>)}
    </div>
  );
}
