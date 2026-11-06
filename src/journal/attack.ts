// Правила режима «атака»: закрытые списки линз, тяжесть и понижение, сверка вердикта с журналом, группы строк.
import type { AttackFile, AttackRow, Draft, JournalRecord } from "../protocol/types";

/** Закрытые списки скилла symphysis-attack: слуг не из списка своего файла — строка невалидна, группа «вне списка». */
const LENSES = {
  journal: [
    { slug: "context-compliance", label: "соответствие журналу" },
    { slug: "claim-authority", label: "числа и факты" },
    { slug: "claim-extraction", label: "существование имён" },
    { slug: "coverage", label: "покрытие разделов" },
  ],
  artifacts: [
    { slug: "scenario-run", label: "прогон сценария" },
    { slug: "claim-extraction", label: "существование имён" },
    { slug: "trace-link", label: "связи изменения" },
  ],
};

export const OUTSIDE = "__outside__";
export const ALL_LENSES = "all";
const SEVERITIES = ["блокер", "предупреждение", "справка"];

export function attackKind(att: AttackFile): "journal" | "artifacts" {
  const targets = att.frontmatter?.targets ?? [];
  return targets.length === 1 && targets[0].path === "decisions.json" ? "journal" : "artifacts";
}

const lensList = (att: AttackFile) => LENSES[attackKind(att)];

export const lensLabel = (att: AttackFile, slug: string): string => lensList(att).find((l) => l.slug === slug)?.label ?? "";
export const isKnownLens = (att: AttackFile, slug: string): boolean => lensList(att).some((l) => l.slug === slug);

/** Тяжесть — первое слово ячейки; причина понижения — текст в скобках после него. */
export function sevBase(severity: string): string {
  const m = /^(блокер|предупреждение|справка)(?![а-яёa-z])/i.exec(severity.trim());
  return m ? m[1].toLowerCase() : severity.trim();
}

export function sevReason(severity: string): string {
  return /\(([^)]+)\)/.exec(severity)?.[1].trim() ?? "";
}

export function severityLevel(severity: string): "signal" | "accent" | "muted" | "plain" {
  const base = sevBase(severity);
  return base === "блокер" ? "signal" : base === "предупреждение" ? "accent" : base === "справка" ? "muted" : "plain";
}

/** При опоре «нет» тяжесть источника — блокер; ниже блокера — понижение, причина в скобках или её нет. */
export function demotion(row: AttackRow): { reason: string } | null {
  const noSupport = /^нет(?![а-яёa-z0-9])/i.test(row.support.trim());
  return !noSupport || sevBase(row.severity) === "блокер" ? null : { reason: sevReason(row.severity) };
}

/** Раздел `F-NN, поле` с записью в журнале — переход к карточке; записи нет — ссылки нет. */
export function recordIdOf(section: string, records: JournalRecord[]): string | null {
  const id = /^(F-\d+)(?!\d)/.exec(section.trim())?.[1];
  return id && records.some((r) => r.id === id) ? id : null;
}

export const journalTarget = (att: AttackFile) => att.frontmatter?.targets.find((t) => t.path === "decisions.json");

/** Сверка хеша цели `decisions.json` из frontmatter атаки с хешем файла журнала. */
export function verdictState(att: AttackFile, journalSha: string | undefined): "none" | "no-hash" | "match" | "stale" {
  const target = journalTarget(att);
  if (!target || !journalSha) return "none";
  if (!target.sha256) return "no-hash";
  return target.sha256 === journalSha ? "match" : "stale";
}

export interface LensGroup {
  slug: string;
  count: number;
  severities: { severity: string; rows: AttackRow[] }[];
}

export interface FileGroups {
  groups: LensGroup[];
  /** По всему файлу: фильтр по линзе на них не влияет, блокер виден при любом фильтре. */
  severityCounts: { блокер: number; предупреждение: number; справка: number; прочих: number };
  lensCounts: [string, number][];
  outside: number;
}

function bySeverity(rows: AttackRow[]): LensGroup["severities"] {
  const others = [...new Set(rows.map((r) => sevBase(r.severity)))].filter((s) => !SEVERITIES.includes(s));
  return [...SEVERITIES, ...others]
    .map((severity) => ({ severity, rows: rows.filter((r) => sevBase(r.severity) === severity) }))
    .filter((part) => part.rows.length);
}

export function fileGroups(att: AttackFile): FileGroups {
  const rows = att.rows ?? [];
  const known = lensList(att).map((l) => ({ slug: l.slug, rows: rows.filter((r) => r.lens === l.slug) })).filter((g) => g.rows.length);
  const outsideRows = rows.filter((r) => !isKnownLens(att, r.lens));
  const groups = [...known, ...(outsideRows.length ? [{ slug: OUTSIDE, rows: outsideRows }] : [])]
    .map((g) => ({ slug: g.slug, count: g.rows.length, severities: bySeverity(g.rows) }));
  const count = (s: string) => rows.filter((r) => sevBase(r.severity) === s).length;
  return {
    groups,
    severityCounts: { блокер: count("блокер"), предупреждение: count("предупреждение"), справка: count("справка"), прочих: rows.filter((r) => !SEVERITIES.includes(sevBase(r.severity))).length },
    lensCounts: known.map((g) => [g.slug, g.rows.length]),
    outside: outsideRows.length,
  };
}

export function lensFilters(attacks: AttackFile[]): { total: number; lenses: [string, number][] } {
  const counts = new Map<string, number>();
  for (const att of attacks) {
    if (att.error) continue;
    for (const g of fileGroups(att).groups) counts.set(g.slug, (counts.get(g.slug) ?? 0) + g.count);
  }
  return { total: [...counts.values()].reduce((a, b) => a + b, 0), lenses: [...counts] };
}

/** Выбранная линза, которой у этого журнала нет, — «все»: иначе человек смотрел бы на пустой режим. */
export function effectiveLens(lens: string, attacks: AttackFile[]): string {
  return lensFilters(attacks).lenses.some(([slug]) => slug === lens) ? lens : ALL_LENSES;
}

/** Якоря режима «атака»: номер файла и строки в данных журнала. Страница ставит их, оглавление и поиск к ним ведут. */
export const attackAnchor = (file: number) => `atk-${file}`;
export const lensAnchor = (file: number, slug: string) => `atk-${file}-${slug}`;
export const rowAnchor = (file: number, row: number) => `atk-${file}-r${row}`;

export const attackFileName = (att: AttackFile) => att.path.split("/").pop() ?? att.path;
export const lensTitle = (slug: string) => (slug === OUTSIDE ? "вне списка" : slug);

export interface OutlineRow {
  kind: "row";
  anchor: string;
  section: string;
  claim: string;
  severity: string;
  level: ReturnType<typeof severityLevel>;
}

export interface OutlineLens {
  kind: "lens";
  anchor: string;
  title: string;
  label: string;
  count: number;
  blockers: number;
  warnings: number;
  rows: OutlineRow[];
}

export interface OutlineFile {
  kind: "file";
  anchor: string;
  name: string;
  status: string;
  stale: boolean;
  error?: string;
  blockers: number;
  warnings: number;
  lenses: OutlineLens[];
}

/** Оглавление атаки: файл → линза → строка, в том же порядке, что и на странице. */
export function attackOutline(attacks: AttackFile[], journalSha: string | undefined): OutlineFile[] {
  return attacks.map((att, file) => {
    const { groups, severityCounts } = fileGroups(att);
    const index = new Map((att.rows ?? []).map((r, i) => [r, i]));
    return {
      kind: "file",
      anchor: attackAnchor(file),
      name: attackFileName(att),
      status: att.frontmatter?.status ?? "",
      stale: verdictState(att, journalSha) === "stale",
      ...(att.error ? { error: att.error } : {}),
      blockers: severityCounts.блокер,
      warnings: severityCounts.предупреждение,
      lenses: groups.map((g) => ({
        kind: "lens",
        anchor: lensAnchor(file, g.slug),
        title: lensTitle(g.slug),
        label: lensLabel(att, g.slug),
        count: g.count,
        blockers: g.severities.find((s) => s.severity === "блокер")?.rows.length ?? 0,
        warnings: g.severities.find((s) => s.severity === "предупреждение")?.rows.length ?? 0,
        rows: g.severities.flatMap((s) => s.rows).map((r) => ({
          kind: "row",
          anchor: rowAnchor(file, index.get(r)!),
          section: r.section,
          claim: r.claim.replace(/`/g, ""),
          severity: r.severity,
          level: severityLevel(r.severity),
        })),
      })),
    };
  });
}

export function setAttackDispute(d: Draft, key: string, text: string): Draft {
  const next = { ...d.attackDisputes };
  if (text.trim()) next[key] = text;
  else delete next[key];
  return { ...d, attackDisputes: next };
}
