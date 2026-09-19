from __future__ import annotations

import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .common import (
    SCHEMA_VERSION,
    expenditure_zip_entry,
    find_header,
    normalize_text,
    parse_int,
    relpath,
    source_ref,
    stable_id,
    write_json,
    write_jsonl,
    yen_from_thousand,
)

ZIP_RE = re.compile(r"^DL(?P<year>\d{4})(?P<kind>\d{2})(?P<seq>\d{3})\.zip$")

DOCUMENT_KINDS: dict[str, tuple[str, str]] = {
    "11": ("general", "initial"),
    "12": ("special", "initial"),
    "13": ("agency", "initial"),
    "21": ("general", "supplement"),
    "22": ("special", "supplement"),
    "31": ("general", "provisional"),
    "32": ("special", "provisional"),
    "33": ("agency", "provisional"),
    "76": ("agency", "settlement"),
    "77": ("general", "settlement"),
    "78": ("special", "settlement"),
}


def discover_mof_documents(raw_root: Path, years: set[int] | None = None) -> list[dict[str, Any]]:
    archive = raw_root / "mof.go.jp" / "archive"
    docs: list[dict[str, Any]] = []
    if not archive.exists():
        return docs
    for zip_path in sorted(archive.glob("*/*/csv/DL*.zip")):
        m = ZIP_RE.match(zip_path.name)
        if not m:
            continue
        fiscal_year = int(m.group("year"))
        if years and fiscal_year not in years:
            continue
        kind = m.group("kind")
        if kind not in DOCUMENT_KINDS:
            continue
        account_type, phase = DOCUMENT_KINDS[kind]
        seq = int(m.group("seq"))
        release_dir = zip_path.parent.parent.name
        submitted = release_dir.endswith("_teishutsu")
        if phase in {"initial", "provisional"}:
            status = "submitted" if submitted else "enacted"
        elif phase == "settlement":
            status = "settled"
        else:
            status = "submitted" if submitted else "published"
        docs.append(
            {
                "fiscalYear": fiscal_year,
                "kind": kind,
                "sequence": seq,
                "revision": seq if phase == "supplement" else None,
                "accountType": account_type,
                "phase": phase,
                "budgetStatus": status,
                "releaseDir": release_dir,
                "path": zip_path,
            }
        )
    return docs


def _standard_amount_column(headers: list[str], fiscal_year: int) -> str:
    # First-year amount columns vary: 予算額 / 要求額 / 予定額 and optional (千円).
    candidates = []
    for h in headers:
        if "前年度" in h or "比較" in h or "成立" in h or h.startswith("改"):
            continue
        if "年度" not in h:
            continue
        if any(word in h for word in ("予算額", "要求額", "予定額")):
            candidates.append(h)
    if not candidates:
        raise ValueError(f"standard amount column not found: {headers}")
    return candidates[0]


def _scope(row: dict[str, str], account_type: str) -> dict[str, str]:
    if account_type == "general":
        return {
            "ministry": row.get("所管", ""),
            "organization": row.get("組織", ""),
            "specialAccount": "",
            "subAccount": "",
            "agency": "",
        }
    if account_type == "special":
        return {
            "ministry": row.get("所管", ""),
            "organization": "",
            "specialAccount": row.get("特別会計", ""),
            "subAccount": row.get("勘定", ""),
            "agency": "",
        }
    return {
        "ministry": "",
        "organization": "",
        "specialAccount": "",
        "subAccount": row.get("業務", ""),
        "agency": row.get("政府関係機関", ""),
    }


def _section_natural_key(account_type: str, scope: dict[str, str], code: str, name: str) -> str:
    if account_type == "general":
        parts = [account_type, scope["ministry"], scope["organization"], code, name]
    elif account_type == "special":
        parts = [account_type, scope["ministry"], scope["specialAccount"], scope["subAccount"], code, name]
    else:
        parts = [account_type, scope["agency"], scope["subAccount"], code, name]
    return "|".join(normalize_text(p) for p in parts)


def _legacy_section_key(account_type: str, scope: dict[str, str], code: str) -> str:
    # Mirrors the code-centric identity that can collapse same-code/different-name special-account sections.
    if account_type == "general":
        parts = [account_type, scope["ministry"], scope["organization"], code]
    elif account_type == "special":
        parts = [account_type, scope["ministry"], scope["specialAccount"], scope["subAccount"], code]
    else:
        parts = [account_type, scope["agency"], scope["subAccount"], code]
    return "|".join(normalize_text(p) for p in parts)


def _scope_name_item_key(account_type: str, scope: dict[str, str], section_name: str, sub_item_name: str) -> str:
    if account_type == "general":
        parts = [account_type, scope["ministry"], scope["organization"], section_name, sub_item_name]
    elif account_type == "special":
        parts = [account_type, scope["ministry"], scope["specialAccount"], scope["subAccount"], section_name, sub_item_name]
    else:
        parts = [account_type, scope["agency"], scope["subAccount"], section_name, sub_item_name]
    return "|".join(normalize_text(p) for p in parts)


def normalize_mof_document(raw_root: Path, doc: dict[str, Any]) -> list[dict[str, Any]]:
    zip_path: Path = doc["path"]
    entry, rows = expenditure_zip_entry(zip_path)
    if not rows:
        return []
    headers = list(rows[0].keys())
    phase = doc["phase"]
    account_type = doc["accountType"]

    standard_col = _standard_amount_column(headers, doc["fiscalYear"]) if phase in {"initial", "provisional"} else None
    previous_col = find_header(headers, "前年度予算額")
    compare_col = find_header(headers, "比較増△減額")

    base_col = find_header(headers, "成立予算額") if phase == "supplement" else None
    add_col = find_header(headers, "補正", "追加額") if phase == "supplement" else None
    reduction_col = find_header(headers, "補正", "修正減少額") if phase == "supplement" else None
    delta_col = find_header(headers, "補正", "差引額") if phase == "supplement" else None
    revised_col = None
    if phase == "supplement":
        revised_col = next((h for h in headers if h.startswith("改") and ("予算額" in h or "予定額" in h)), None)

    out: list[dict[str, Any]] = []
    for row_number, row in enumerate(rows, start=2):
        scope = _scope(row, account_type)
        section_code = (row.get("項コード") or "").strip()
        section_name = (row.get("項名") or "").strip()
        sub_item_name = (row.get("目名") or "").strip()
        sub_item_code = (
            row.get("目番号")
            or row.get("目コード")
            or row.get("目別分類コード")
            or ""
        ).strip()
        section_key = _section_natural_key(account_type, scope, section_code, section_name)
        legacy_section_key = _legacy_section_key(account_type, scope, section_code)
        scope_name_key = _scope_name_item_key(account_type, scope, section_name, sub_item_name)
        item_key = "|".join([section_key, normalize_text(sub_item_code), normalize_text(sub_item_name)])

        rec: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "recordType": "mof_budget_item",
            "recordId": stable_id(relpath(zip_path, raw_root), entry, row_number, prefix="mofrow_"),
            "fiscalYear": doc["fiscalYear"],
            "phase": phase,
            "budgetStatus": doc["budgetStatus"],
            "revision": doc["revision"],
            "accountType": account_type,
            **scope,
            "sectionCode": section_code,
            "sectionName": section_name,
            "subItemCode": sub_item_code,
            "subItemName": sub_item_name,
            "sectionNaturalKey": section_key,
            "legacySectionKey": legacy_section_key,
            "itemNaturalKey": item_key,
            "scopeNameItemKey": scope_name_key,
            "source": source_ref(raw_root, zip_path, entry, row_number),
        }

        if phase in {"initial", "provisional"}:
            rec.update(
                {
                    "amountYen": yen_from_thousand(row.get(standard_col or "")),
                    "previousAmountYen": yen_from_thousand(row.get(previous_col or "")),
                    "differenceYen": yen_from_thousand(row.get(compare_col or "")),
                    "sourceAmountColumn": standard_col,
                }
            )
        elif phase == "supplement":
            rec.update(
                {
                    "baseAmountYen": yen_from_thousand(row.get(base_col or "")),
                    "supplementAdditionYen": yen_from_thousand(row.get(add_col or "")),
                    "supplementReductionYen": yen_from_thousand(row.get(reduction_col or "")),
                    "supplementDeltaYen": yen_from_thousand(row.get(delta_col or "")),
                    "revisedAmountYen": yen_from_thousand(row.get(revised_col or "")),
                    "sourceAmountColumns": {
                        "base": base_col,
                        "addition": add_col,
                        "reduction": reduction_col,
                        "delta": delta_col,
                        "revised": revised_col,
                    },
                }
            )
        elif phase == "settlement":
            if account_type == "agency":
                rec.update(
                    {
                        "budgetAmountYen": parse_int(row.get("支出予算額(円)")),
                        "carryoverInYen": parse_int(row.get("前年度繰越額(円)")),
                        "reserveUseYen": parse_int(row.get("予備費使用額(円)")),
                        "budgetRuleIncreaseYen": parse_int(row.get("予算総則の規定による経費増額(円)")),
                        "reallocationYen": parse_int(row.get("流用等増△減額(円)")),
                        "transferAdjustmentYen": 0,
                        "currentBudgetYen": parse_int(row.get("支出予算現額(円)")),
                        "spentYen": parse_int(row.get("支出済額(円)")),
                        "carryoverOutYen": parse_int(row.get("翌年度繰越額(円)")),
                        "unusedYen": parse_int(row.get("不用額(円)")),
                    }
                )
            else:
                rec.update(
                    {
                        "budgetAmountYen": parse_int(row.get("歳出予算額(円)")),
                        "carryoverInYen": parse_int(row.get("前年度繰越額(円)")),
                        "reserveUseYen": parse_int(row.get("予備費使用額(円)")),
                        "budgetRuleIncreaseYen": parse_int(row.get("予算総則の規定による経費増額(円)")),
                        "reallocationYen": parse_int(row.get("流用等増△減額(円)")),
                        "transferAdjustmentYen": parse_int(row.get("予算決定後移替増△減額(円)")),
                        "currentBudgetYen": parse_int(row.get("歳出予算現額(円)")),
                        "spentYen": parse_int(row.get("支出済歳出額(円)")),
                        "carryoverOutYen": parse_int(row.get("翌年度繰越額(円)")),
                        "unusedYen": parse_int(row.get("不用額(円)")),
                    }
                )
        out.append(rec)
    return out


def normalize_mof(raw_root: Path, output_root: Path, years: set[int] | None = None) -> dict[str, Any]:
    docs = discover_mof_documents(raw_root, years)
    by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
    doc_summaries: list[dict[str, Any]] = []
    for doc in docs:
        rows = normalize_mof_document(raw_root, doc)
        by_year[doc["fiscalYear"]].extend(rows)
        doc_summaries.append(
            {
                "fiscalYear": doc["fiscalYear"],
                "phase": doc["phase"],
                "budgetStatus": doc["budgetStatus"],
                "revision": doc["revision"],
                "accountType": doc["accountType"],
                "path": relpath(doc["path"], raw_root),
                "rowCount": len(rows),
            }
        )

    manifests: dict[str, Any] = {"schemaVersion": SCHEMA_VERSION, "years": {}}
    for year, rows in sorted(by_year.items()):
        rows.sort(
            key=lambda r: (
                r["phase"],
                r["budgetStatus"],
                r["revision"] or 0,
                r["accountType"],
                r["sectionNaturalKey"],
                r["subItemName"],
                r["recordId"],
            )
        )
        year_dir = output_root / "normalized" / "mof" / f"fy{year}"
        count = write_jsonl(year_dir / "budget-items.jsonl", rows)
        phase_counts = Counter((r["phase"], r["budgetStatus"], r["accountType"]) for r in rows)
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "fiscalYear": year,
            "rowCount": count,
            "phaseCounts": [
                {"phase": p, "budgetStatus": s, "accountType": a, "count": c}
                for (p, s, a), c in sorted(phase_counts.items())
            ],
            "inputs": [d for d in doc_summaries if d["fiscalYear"] == year],
        }
        write_json(year_dir / "manifest.json", manifest)
        manifests["years"][str(year)] = manifest
    write_json(output_root / "normalized" / "mof" / "manifest.json", manifests)
    return manifests
