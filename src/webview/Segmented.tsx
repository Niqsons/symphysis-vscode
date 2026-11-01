// Переключатель одного значения: режимы и фильтры. Выбранное залито цветом кнопки — одно правило на все переключатели страницы.
import type { ReactNode } from "react";

export interface SegmentedProps<T extends string> {
  label?: string;
  className?: string;
  items: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange(value: T): void;
}

export function Segmented<T extends string>({ label, className, items, value, onChange }: SegmentedProps<T>) {
  return (
    <div className={`seg${className ? ` ${className}` : ""}`}>
      {label && <b>{label}</b>}
      {items.map((i) => (
        <button type="button" className={i.value === value ? "active" : ""} aria-pressed={i.value === value} title={i.title} key={i.value} onClick={() => onChange(i.value)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}
