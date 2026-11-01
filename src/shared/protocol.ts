// Сообщения между хостом расширения и страницей просмотрщика.
import type { Draft, ViewPayload } from "./types";

export type CoreFailure =
  | { kind: "no-journal" }
  | { kind: "no-tools"; root: string }
  | { kind: "no-python"; reason: string; tried: string[] }
  | { kind: "old-core"; tools: string }
  | { kind: "invalid-journal"; text: string }
  | { kind: "timeout" }
  | { kind: "crash"; text: string };

export interface Colors {
  signal: string;
  accent: string;
  muted: string;
}

/** Удобства интерфейса: живут в workspaceState (Р4), в черновик не идут. */
export interface UiState {
  openOnly: boolean;
  promptOpen: boolean;
  /** Высота поля промпта в пикселях; `null` — низкая по умолчанию, по числу строк. */
  promptHeight: number | null;
}

export const DEFAULT_UI: UiState = { openOnly: false, promptOpen: true, promptHeight: null };

export interface JournalView {
  key: string;
  name: string;
  payload: ViewPayload | null;
  failure: CoreFailure | null;
  loading: boolean;
}

export type ApplyReport =
  | { stage: "stale" }
  | { stage: "refused"; report: string[] }
  | { stage: "applied"; answers: string; report: string[]; rebuildOk: boolean; rebuildReport: string[]; sha256After: string }
  | { stage: "error"; text: string };

export type HostMessage =
  | { type: "show"; view: JournalView; draft: Draft; damagedDraft: string | null; colors: Colors; ui: UiState }
  | { type: "journal"; view: JournalView }
  | { type: "colors"; colors: Colors }
  | { type: "reveal"; id: string }
  | { type: "applied"; key: string; result: ApplyReport };

export type PageMessage =
  | { type: "ready" }
  | { type: "draft"; key: string; draft: Draft }
  | { type: "ui"; ui: UiState }
  | { type: "copy"; text: string }
  | { type: "apply"; key: string; text: string; shownSha: string | undefined; date: string }
  | { type: "reset"; key: string }
  | { type: "openPythonSetting" };
