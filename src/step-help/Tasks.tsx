// Часть строки счётчиков просмотрщика: «Задач закрыто N из N». Нет чисел или задач 0 — части нет.
import type { JournalView } from "../protocol/protocol";

export function TasksPart({ tasks }: { tasks: JournalView["tasks"] | undefined }) {
  if (!tasks || !(tasks.total > 0)) return null;
  return <> · Задач закрыто <b>{tasks.complete} из {tasks.total}</b></>;
}
