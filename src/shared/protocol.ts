// Сообщения между хостом расширения и страницами: просмотрщиком и поиском в боковой панели.
import type { ParsedScheme } from "./scheme";
import type { SearchOutcome } from "./search";
import type { Draft, StepHelpOutput, ViewPayload } from "./types";

export type CoreFailure =
  | { kind: "no-journal" }
  | { kind: "no-tools"; root: string }
  | { kind: "tools-path"; reason: string }
  | { kind: "no-python"; reason: string; tried: string[] }
  | { kind: "old-core"; tools: string }
  | { kind: "contract"; need: "tools" | "vsix"; root: string }
  | { kind: "invalid-journal"; text: string }
  | { kind: "timeout" }
  | { kind: "crash"; text: string };

/** Отказы справки сверх отказов журнала: `command` — что запустить в терминале, `root` — папка без `openspec/`. */
export type HelpFailure = CoreFailure | { kind: "unreadable"; command: string } | { kind: "no-openspec"; root: string };

/** Строка списка изменений. `key` — каталог изменения; `folder` — имя папки, только когда папок в рабочей области несколько. */
export interface HelpChoice {
  key: string;
  change: string;
  folder: string | null;
}

/** Чем кончился расчёт: вывод ядра, список на выбор (активных несколько) или отказ. Случаи различаются по полям вывода, а не по тексту. */
export type HelpOutcome =
  | { kind: "output"; root: string; output: StepHelpOutput }
  | { kind: "choice"; choices: HelpChoice[] }
  | { kind: "failure"; failure: HelpFailure };

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
  | { type: "openFile"; link: string; line: number | null }
  | { type: "openPythonSetting" };

/** Вкладка схемы. */
export interface SchemeView extends ParsedScheme {
  name: string;
  exists: boolean;
}

export type SchemeHostMessage = { type: "scheme"; view: SchemeView };

/** Положение переключателя вкладки. */
export type PanelView = "scheme" | "help";

export type SchemePageMessage =
  | { type: "schemeReady" }
  | { type: "schemeNode"; id: string }
  | { type: "schemeOpenFile"; line: number | null }
  | { type: "panelView"; view: PanelView };

/** Справка на той же вкладке. `panel: "scheme"` здесь значит схему без изменения: рисовать нечего, и mermaid страница не грузит. `outcome: null` — ответа ещё нет. */
export interface HelpView {
  panel: PanelView;
  /** Каталог изменения: по нему страница узнаёт то же изменение, имя у двух папок может совпасть. */
  key: string | null;
  name: string | null;
  outcome: HelpOutcome | null;
  /** Версия плагина для малозаметной строки внизу (F-37). */
  pluginVersion: string;
}

export type HelpHostMessage = { type: "help"; view: HelpView };

export type HelpPageMessage =
  | { type: "helpReady" }
  | { type: "panelView"; view: PanelView }
  | { type: "helpChoose"; key: string }
  | { type: "helpRefresh" }
  | { type: "helpOpenFile"; link: string; line: number | null }
  | { type: "helpOpenSkill"; name: string }
  | { type: "openPythonSetting" };

/** Страница поиска в боковой панели. `scope` — открытое изменение; `null` — журнал не открыт, искать негде. */
export type SearchHostMessage = { type: "searchState"; query: string; scope: string | null; outcome: SearchOutcome; colors: Colors };

export type SearchPageMessage =
  | { type: "searchReady" }
  | { type: "searchQuery"; query: string }
  | { type: "searchOpen"; target: RevealTarget };
