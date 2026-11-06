// Три уровня цвета (Р21): приходят из настроек расширения в переменные страницы.
import type { Colors } from "../protocol/protocol";

export function applyColors(c: Colors) {
  const s = document.documentElement.style;
  s.setProperty("--sym-signal", c.signal);
  s.setProperty("--sym-accent", c.accent);
  s.setProperty("--sym-muted", c.muted);
}
