# -*- coding: utf-8 -*-
"""Прообраз `journal.py view-json` для пробного запуска: журнал со сверкой улик и атаки — JSON на stdout.
Аргументы: каталог tools, decisions.json, затем файлы атаки."""
import json
import sys
from pathlib import Path

tools, journal_path, *attack_paths = sys.argv[1:]
sys.path.insert(0, tools)

from journal_apply import check_evidence, default_roots, sha256_file  # noqa: E402
from journal_model import load_journal, validate_journal  # noqa: E402
from journal_render import _viewer_record, parse_attack_md  # noqa: E402

journal = load_journal(Path(journal_path))
errors = validate_journal(journal)
evidence = check_evidence(journal, default_roots(None)) if not errors else {"found": 0, "total": 0}
payload = {
    "title": journal.get("title"),
    "sha256": sha256_file(Path(journal_path)),
    "errors": errors,
    "evidence": {"found": evidence["found"], "total": evidence["total"]},
    "records": [_viewer_record(r) for r in journal["records"]] if not errors else [],
    "notes": journal.get("notes") or [],
    "attacks": [parse_attack_md(Path(p)) for p in attack_paths],
}
sys.stdout.reconfigure(encoding="utf-8")
sys.stdout.write(json.dumps(payload, ensure_ascii=False))
