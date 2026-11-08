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
  /** Узлы схемы, к которым относится запись; поле необязательно (F-23). */
  nodes?: string[];
  question: string;
  kind: "развилка" | "факт";
  status: string;
  addressee: string;
  depends_on: string[];
  delivery: string;
  options: JournalOption[];
  antipodes: { option: string; other: string }[];
  recommendation: { option: string; why: string } | null;
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

/** Скилл шага. `base` — где найден файл, `path` от этого каталога; не найден — оба `null`. */
export interface HelpSkill {
  name: string;
  path: string | null;
  base: "project" | "install" | null;
}

/** Страница шага в выводе `step_help.py`. `state` бывает `null` без графа: нет изменения или форк упал. */
export interface StepHelpPage {
  id: string;
  state: string | null;
  turn: "human" | "model";
  optional: boolean;
  blocks: string[];
  stops_apply: boolean;
  waits_for: string[];
  files: { path: string; exists: boolean }[];
  file_note: string | null;
  texts: { title: string; why: string; mechanics: string; if_skipped: string; what_to_check: string; command: string; how_to_prepare: string };
  text_note: string | null;
  prev: string | null;
  next: string | null;
  /** Нет поля у старого ядра. */
  skills?: HelpSkill[];
}

/** Вывод `step_help.py`: поля в `test_output_shape` ядра, исходы и коды в `step_help.py --help`. Сбой идёт полем `error`, тексты шагов при этом на месте. */
export interface StepHelpOutput {
  contract: number;
  taken_at: string;
  versions: { openspec: string | null; symphysis: string | null };
  change: string | null;
  changes: string[] | null;
  error: string | null;
  current_step: string | null;
  current_text: string | null;
  turn: "human" | "model" | null;
  next_by_status: string | null;
  /** Журнал не читается — слова вместо чисел. */
  forks: { open: number | string; parked: number | string } | null;
  tasks: { state: string; total: number; complete: number; remaining: number } | null;
  steps: StepHelpPage[];
  /** Нет поля у старого ядра. */
  file_links?: Record<string, string>;
}

export interface ViewPayload {
  /** Номер контракта с ядром; сверяет `viewJson`, дальше по страницам он не нужен. */
  contract?: number;
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
  /** Карта «текст без хвоста `:строка` — путь от корня проекта»; у старого ядра её нет. */
  file_links?: Record<string, string>;
  notes: { date: string; text: string }[];
  attacks: AttackFile[];
}

export const ADDRESSEES = ["агент", "человек", "ИБ"] as const;

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
