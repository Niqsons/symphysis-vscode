// Данные `journal.py view-json` и черновик человека: общие для хоста и страницы, без vscode и DOM.

export interface Evidence {
  path: string;
  quote: string;
  line?: number | null;
  found?: boolean | null;
  verdict?: string | null;
}

export interface JournalOption {
  letter: string;
  text: string;
  added: boolean;
  unlikely: string | null;
  evidence: Evidence[];
  deviation?: string;
}

export interface Parking {
  addressee: string;
  text: string;
  finding?: string;
  destination?: string;
}

export interface JournalRecord {
  id: string;
  question: string;
  kind: "развилка" | "факт";
  status: string;
  addressee: string;
  depends_on: string[];
  delivery: string;
  options: JournalOption[];
  antipodes: { option: string; other: string }[];
  recommendation: { option: string; why: string; text?: string } | null;
  decision: { option: string; word: string; date: string } | null;
  reversibility: { level: string; why: string } | null;
  outcome: { kind: string; value: string; reason: string } | null;
  parking: Parking[];
  dispute: string;
  consequences: string;
  evidence: Evidence[];
  finding?: string;
  destination?: { label: string; note: string };
}

export interface AttackRow {
  claim: string;
  section: string;
  lens: string;
  invariant: string;
  severity: string;
  support: string;
  fix: string;
}

export interface AttackFile {
  path: string;
  frontmatter?: { status: string; targets: { path: string; sha256: string }[] };
  rows?: AttackRow[];
  error?: string;
}

export interface ViewPayload {
  title: string;
  source: string;
  generated?: string;
  sha256?: string;
  stats: {
    records: number;
    forks: number;
    facts: number;
    decided: number;
    parked: number;
    evidence_total: number;
    evidence_found: number;
  };
  records: JournalRecord[];
  notes: { date: string; text: string }[];
  attacks: AttackFile[];
}

export const ADDRESSEES = ["материалы", "человек", "ИБ"] as const;

export interface DecisionDraft {
  choice: string | null;
  word: string;
  parked: { text: string; addressee: string }[];
}

export interface NewForkDraft {
  id: string;
  question: string;
  options: string;
  word: string;
}

/** Работа человека, ещё не внесённая в журнал: `.symphysis/viewer/<изменение>.json`. */
export interface Draft {
  decisions: Record<string, DecisionDraft>;
  added: Record<string, { letter: string; text: string }[]>;
  newForks: NewForkDraft[];
  disputes: Record<string, string>;
  deps: Record<string, { add: string[]; remove: string[] }>;
  notes: string;
  attackDisputes: Record<string, string>;
}
