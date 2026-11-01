// Режим «проверка»: снимок решений перед proposal. Только журнал: черновик человека сюда не входит, это не вердикт.
import { evidenceLevel } from "./ops";
import { ADDRESSEES, type Evidence, type JournalRecord, type Parking, type ViewPayload } from "./types";

const ONE_WAY = "в одну сторону";

export const isOneWay = (rec: JournalRecord): boolean => rec.reversibility?.level === ONE_WAY;
const isProbe = (rec: JournalRecord): boolean => rec.outcome?.kind === "проба";
const num = (id: string): number => parseInt(id.slice(2), 10) || 0;
const evidenceOf = (rec: JournalRecord): Evidence[] => [...rec.evidence, ...rec.options.flatMap((o) => o.evidence)];

export interface ParkingGroup {
  addressee: string;
  destination: string;
  items: (Parking & { rec: string })[];
}

export interface CheckSnapshot {
  decidedByDate: { date: string; records: JournalRecord[] }[];
  decided: JournalRecord[];
  probes: JournalRecord[];
  open: JournalRecord[];
  facts: JournalRecord[];
  parkings: ParkingGroup[];
  parkingTotal: number;
  counts: { decided: number; open: number; parked: Record<string, number>; disputedFacts: number; evidenceMissing: number; evidenceSignal: number };
}

export function checkSnapshot(p: ViewPayload): CheckSnapshot {
  const forks = p.records.filter((r) => r.kind === "развилка");
  const decidedAll = forks.filter((r) => r.decision);
  const decided = decidedAll.filter((r) => !isProbe(r));
  const open = forks.filter((r) => !r.decision);
  const facts = p.records.filter((r) => r.kind === "факт");
  const dates = [...new Set(decided.map((r) => r.decision!.date))].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const decidedByDate = dates.map((date) => ({
    date,
    records: decided.filter((r) => r.decision!.date === date).sort((a, b) => Number(isOneWay(b)) - Number(isOneWay(a)) || num(a.id) - num(b.id)),
  }));
  const parkingItems = p.records.flatMap((r) => r.parking.map((x) => ({ ...x, rec: r.id })));
  const parkings = ADDRESSEES.map((addressee) => {
    const items = parkingItems.filter((x) => x.addressee === addressee);
    return { addressee: addressee as string, destination: items.find((x) => x.destination)?.destination ?? "", items };
  }).filter((g) => g.items.length);
  const evidence = p.records.flatMap(evidenceOf);
  return {
    decidedByDate, decided, open, facts, parkings,
    probes: p.records.filter(isProbe),
    parkingTotal: parkingItems.length,
    counts: {
      decided: decidedAll.length,
      open: open.length,
      parked: Object.fromEntries(ADDRESSEES.map((a) => [a, parkingItems.filter((x) => x.addressee === a).length])),
      disputedFacts: facts.filter((r) => r.dispute.trim()).length,
      evidenceMissing: evidence.filter((ev) => ev.found === false).length,
      evidenceSignal: evidence.filter((ev) => evidenceLevel(ev) === "signal").length,
    },
  };
}
