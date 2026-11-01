import type { JournalOption, JournalRecord, ViewPayload } from "../../src/shared/types";

export function option(letter: string, over: Partial<JournalOption> = {}): JournalOption {
  return { letter, text: `вариант ${letter}`, added: false, unlikely: null, evidence: [], ...over };
}

export function fork(id: string, over: Partial<JournalRecord> = {}): JournalRecord {
  return {
    id, question: `вопрос ${id}`, kind: "развилка", status: "открыт", addressee: "", depends_on: [], delivery: "",
    options: [option("A"), option("B")], antipodes: [], recommendation: null, decision: null, reversibility: null, outcome: null,
    parking: [], dispute: "", consequences: "", evidence: [], ...over,
  };
}

export function fact(id: string, over: Partial<JournalRecord> = {}): JournalRecord {
  return { ...fork(id), kind: "факт", options: [], ...over };
}

export function payload(records: JournalRecord[], over: Partial<ViewPayload> = {}): ViewPayload {
  return {
    title: "журнал", source: "decisions.json", sha256: "a".repeat(64),
    stats: { records: records.length, forks: 0, facts: 0, decided: 0, parked: 0, evidence_total: 0, evidence_found: 0 },
    records, notes: [], attacks: [], ...over,
  };
}
