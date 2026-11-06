"""Хук клиента: при каждом запросе человека сообщает агенту о внесённом кнопкой и о правке scheme.md.

Только стандартная библиотека, один файл. Лежит в <проект>/.symphysis/viewer/hook.py, корень проекта берёт
от своего файла. Выходит с кодом 0 при любом сбое (код 2 блокирует запрос человека у Claude Code, F-52, F-69);
причина идёт в stderr. Вход: JSON на stdin, читается только session_id (prompt, transcript_path, cwd не пишутся).
"""
import hashlib
import json
import os
import re
import sys
from pathlib import Path

LIMIT = 9000            # клиент режет вывод на 10 000 символов (F-71)
READ_MAX = 1024 * 1024  # читаем от курсора и не больше 1 МБ
NAME_MAX = 100
SCHEME_LINES_MAX = 10
SCHEME_BUDGET = 3000
HASH_SHORT = 8
EVENTS_REL = ".symphysis/viewer/events.jsonl"

# [0-9], а не \d: \d в str-шаблоне принимает цифры любых письменностей. \w нужен Unicode: имена бывают кириллицей.
NAME_RE = re.compile(r"\w[\w.-]*")
HASH_RE = re.compile(r"[0-9a-fA-F]{64}")


def answers_re(change):
    return re.compile(r"openspec/changes/" + re.escape(change) + r"/answers/[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?\.md")


def valid_name(name):
    return isinstance(name, str) and len(name) <= NAME_MAX and NAME_RE.fullmatch(name) is not None


def parse_event(raw):
    """Событие из строки файла или None, если строка не по форме. Годятся только проверенные поля."""
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        return None
    if not isinstance(data, dict):
        return None
    change, answers = data.get("change"), data.get("answers")
    before, after = data.get("sha256_before"), data.get("sha256_after")
    if not valid_name(change) or not isinstance(answers, str) or not answers_re(change).fullmatch(answers):
        return None
    for h in (before, after):
        if not isinstance(h, str) or not HASH_RE.fullmatch(h):
            return None
    return change, answers, before[:HASH_SHORT].lower(), after[:HASH_SHORT].lower()


def event_text(ev):
    change, answers, before, after = ev
    return (
        f"Человек внёс решения кнопкой «Внести» в просмотрщике журнала: изменение {change}. "
        f"Журнал изменён (хеш был {before}, стал {after}). Ответ человека лежит в файле {answers}. "
        "Перечитай журнал перед записью. Этот промпт вносить не надо: решения уже внесены."
    )


def scheme_text(change):
    return (
        f"Файл scheme.md изменения {change} правили с прошлого обращения. Это только сигнал: схема лишь "
        "представление журнала для человека, а не источник истины."
    )


def plural_events(n):
    if n % 10 == 1 and n % 100 != 11:
        return "событие"
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return "события"
    return "событий"


def read_unread(path, offset, size):
    """(строки, новое смещение, хвост обрезан). Только полные строки; хвост без перевода строки остаётся за курсором."""
    if size <= offset:
        return [], offset, False
    truncated = size - offset > READ_MAX
    with open(path, "rb") as f:
        if truncated:
            start = size - READ_MAX
            f.seek(start - 1)
            data = f.read(READ_MAX + 1)
            # первая строка хвоста может быть неполной: её отбрасываем, если перед хвостом не перевод строки
            first, data = data[:1], data[1:]
            base = start
            if first != b"\n":
                i = data.find(b"\n")
                cut = len(data) if i < 0 else i + 1
                data, base = data[cut:], start + cut
        else:
            f.seek(offset)
            data = f.read(size - offset)
            base = offset
    end = data.rfind(b"\n")
    if end < 0:
        return [], offset, truncated
    return data[: end + 1].split(b"\n")[:-1], base + end + 1, truncated


def active_changes(root):
    base = root / "openspec" / "changes"
    names = []
    try:
        entries = sorted(os.listdir(base))
    except OSError:
        return names
    for name in entries:
        if name != "archive" and valid_name(name) and (base / name).is_dir():
            names.append(name)
    return names


def scheme_hash(root, name):
    p = root / "openspec" / "changes" / name / "scheme.md"
    try:
        if not p.is_file():
            return None
        return hashlib.sha256(p.read_bytes()).hexdigest()
    except OSError:
        return None


def load_cursor(path):
    """Курсор или None: нет файла или он повреждён, тогда сессия считается новой."""
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return None
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    offset, schemes = data.get("offset"), data.get("schemes", {})
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0 or not isinstance(schemes, dict):
        return None
    return {"offset": offset, "schemes": schemes}


def save_cursor(path, cursor):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(cursor, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def run():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        return ""
    session = data.get("session_id") if isinstance(data, dict) else None
    if not isinstance(session, str) or not session:
        return ""

    root = Path(__file__).resolve().parents[2]
    viewer = root / ".symphysis" / "viewer"
    events = viewer / "events.jsonl"
    # Имя файла — хеш номера: `../` и зарезервированные имена Windows до файловой системы не доходят (F-105).
    cursor_path = viewer / "sessions" / (hashlib.sha256(session.encode("utf-8")).hexdigest() + ".json")

    try:
        size = events.stat().st_size
    except FileNotFoundError:
        size = 0
    names = active_changes(root)
    now = {n: scheme_hash(root, n) for n in names}
    cursor = load_cursor(cursor_path)

    if cursor is None:
        # Новая сессия: прошлого не видит (F-50), схемы только запоминает (F-74).
        save_cursor(cursor_path, {"offset": size, "schemes": now})
        return ""

    offset = cursor["offset"] if cursor["offset"] <= size else 0  # курсор дальше конца: файл урезали (F-72)
    lines, new_offset, truncated = read_unread(events, offset, size)
    parsed = [e for e in (parse_event(line) for line in lines) if e is not None]

    scheme_lines = []
    changed = [n for n in names if now[n] is not None and now[n] != cursor["schemes"].get(n)]
    for n in changed[:SCHEME_LINES_MAX]:
        scheme_lines.append(scheme_text(n))
    if len(changed) > SCHEME_LINES_MAX:
        scheme_lines.append(f"Ещё у {len(changed) - SCHEME_LINES_MAX} изменений правили scheme.md.")
    scheme_block = "\n".join(scheme_lines)

    # Новые события целиком, старые уступают место; хвост «ещё N» всегда помещается.
    budget = LIMIT - len(scheme_block) - 1 - 200
    shown, used = [], 0
    for ev in reversed(parsed):
        text = event_text(ev)
        if used + len(text) + 1 > budget:
            break
        shown.append(text)
        used += len(text) + 1
    shown.reverse()
    out = list(shown)
    more = len(parsed) - len(shown)
    if more:
        lower = "не меньше " if truncated else ""
        out.append(f"Показаны не все: ещё {lower}{more} {plural_events(more)} в `{EVENTS_REL}`.")
    elif truncated:
        out.append(f"Показаны не все: более ранние события лежат в `{EVENTS_REL}`.")
    if scheme_block:
        out.append(scheme_block)

    save_cursor(cursor_path, {"offset": new_offset, "schemes": now})
    return "\n".join(out) + "\n" if out else ""


def main():
    try:
        text = run()
        if text:
            sys.stdout.buffer.write(text.encode("utf-8"))
            sys.stdout.buffer.flush()
    except BaseException as e:  # запрос человека хук не останавливает ни при каком сбое
        try:
            sys.stderr.buffer.write(f"symphysis hook: {type(e).__name__}: {e}\n".encode("utf-8", "replace"))
            sys.stderr.buffer.flush()
        except BaseException:
            pass


if __name__ == "__main__":
    main()
