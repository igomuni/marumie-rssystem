from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import unicodedata
import zipfile
from pathlib import Path
from typing import Any, Iterable, Iterator

SCHEMA_VERSION = 1


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).strip()


def parse_int(value: Any, *, none_if_blank: bool = False) -> int | None:
    if value is None:
        return None if none_if_blank else 0
    s = str(value).strip().replace(",", "")
    if not s:
        return None if none_if_blank else 0
    try:
        if "." in s:
            return int(float(s))
        return int(s)
    except ValueError:
        return None if none_if_blank else 0


def yen_from_thousand(value: Any, *, none_if_blank: bool = False) -> int | None:
    n = parse_int(value, none_if_blank=none_if_blank)
    if n is None:
        return None
    return n * 1000


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def stable_id(*parts: Any, prefix: str = "") -> str:
    payload = "\x1f".join(normalize_text(str(p)) for p in parts)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]
    return f"{prefix}{digest}"


def read_zip_csv_entries(zip_path: Path) -> list[tuple[str, list[dict[str, str]]]]:
    out: list[tuple[str, list[dict[str, str]]]] = []
    with zipfile.ZipFile(zip_path) as zf:
        for name in sorted(zf.namelist()):
            if not name.lower().endswith(".csv"):
                continue
            text = zf.read(name).decode("utf-8-sig")
            rows = list(csv.DictReader(io.StringIO(text)))
            out.append((name, rows))
    return out


def is_expenditure_headers(headers: Iterable[str]) -> bool:
    return any("主要経費別分類" in h or "使途別分類" in h for h in headers)


def expenditure_zip_entry(zip_path: Path) -> tuple[str, list[dict[str, str]]]:
    for name, rows in read_zip_csv_entries(zip_path):
        if rows and is_expenditure_headers(rows[0].keys()):
            return name, rows
    raise ValueError(f"expenditure CSV not found in {zip_path}")


def find_header(headers: Iterable[str], *needles: str, exclude: tuple[str, ...] = ()) -> str | None:
    for header in headers:
        if all(n in header for n in needles) and not any(x in header for x in exclude):
            return header
    return None


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            f.write("\n")
            count += 1
    return count


def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    if not path.exists():
        return iter(())
    def _iter() -> Iterator[dict[str, Any]]:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    yield json.loads(line)
    return _iter()


def relpath(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def source_ref(raw_root: Path, zip_path: Path, entry: str, row_number: int) -> dict[str, Any]:
    return {
        "path": relpath(zip_path, raw_root),
        "zipEntry": entry,
        "rowNumber": row_number,
    }


def sorted_dict_rows(rows: Iterable[dict[str, Any]], *keys: str) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda r: tuple(str(r.get(k, "")) for k in keys))
