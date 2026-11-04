// Сообщения между хостом расширения и страницами: просмотрщиком и поиском в боковой панели.
import type { ParsedScheme } from "./scheme";
import type { SearchOutcome } from "./search";
import type { Draft, ViewPayload } from "./types";

export type CoreFailure =
  | { kind: "no-journal" }
  | { kind: "no-tools"; root: string }
  | { kind: "no-python"; reason: string; tried: string[] }
  | { kind: "old-core"; tools: string }
  | { kind: "contract"; need: "tools" | "vsix"; root: string }
  | { kind: "invalid-journal"; text: string }
  | { kind: "timeout" }
  | { kind: "crash"; text: string };

export interface Colors {
  signal: string;
  accent: string;
  muted: string;
}

export type ViewMode = "decisions" | "check" | "attack";

/** Какие записи показывает режим «решения». */
export type RecordFilter = "all" | "forks" | "open" | "facts";

/** Удобства интерфейса: живут в workspaceState (Р4), в черновик не идут. */
export interface UiState {
  mode: ViewMode;
  attackLens: string;
  recordFilter: RecordFilter;
  promptOpen: boolean;
  /** Высота поля промпта в пикселях; `null` — низкая по умолчанию, по числу строк. */
  promptHeight: number | null;
}

export const DEFAULT_UI: UiState = { mode: "decisions", attackLens: "all", recordFilter: "all", promptOpen: true, promptHeight: null };

export interface JournalView {
  key: string;
  name: string;
  payload: ViewPayload | null;
  failure: CoreFailure | null;
  loading: boolean;
  /** Текст схемы изменения: подсказка «узел не найден». Нет схемы — `null`. */
  scheme: string | null;
}

export type ApplyReport =
  | { stage: "stale" }
  | { stage: "refused"; report: string[] }
  | { stage: "applied"; answers: string; report: string[]; rebuildOk: boolean; rebuildReport: string[]; sha256After: string | null }
  | { stage: "error"; text: string };

/** Куда перейти на странице: якорь и режим, в котором он живёт; режима нет — запись журнала, она есть и в «решениях», и в «проверке». */
export interface RevealTarget {
  id: string;
  mode?: ViewMode;
}

export type HostMessage =
  | { type: "show"; view: JournalView; draft: Draft; damagedDraft: string | null; colors: Colors; ui: UiState }
  | { type: "journal"; view: JournalView }
  | { type: "colors"; colors: Colors }
  | ({ type: "reveal" } & RevealTarget)
  | { type: "node"; id: string }
  | { type: "applied"; key: string; result: ApplyReport };

export type PageMessage =
  | { type: "ready" }
  | { type: "draft"; key: string; draft: Draft }
  | { type: "ui"; ui: UiState }
  | { type: "copy"; text: string }
  | { type: "apply"; key: string; text: string; shownSha: string | undefined; date: string }
  | { type: "reset"; key: string }
  | { type: "openScheme"; key: string }
  | { type: "openPythonSetting" };

/** Вкладка схемы. */
export interface SchemeView extends ParsedScheme {
  name: string;
  exists: boolean;
}

export type SchemeHostMessage = { type: "scheme"; view: SchemeView };

export type SchemePageMessage =
  | { type: "schemeReady" }
  | { type: "schemeNode"; id: string }
  | { type: "schemeOpenFile"; line: number | null };

/** Страница поиска в боковой панели. `scope` — открытое изменение; `null` — журнал не открыт, искать негде. */
export type SearchHostMessage = { type: "searchState"; query: string; scope: string | null; outcome: SearchOutcome; colors: Colors };

export type SearchPageMessage =
  | { type: "searchReady" }
  | { type: "searchQuery"; query: string }
  | { type: "searchOpen"; target: RevealTarget };
