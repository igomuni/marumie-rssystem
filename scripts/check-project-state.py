"""
プロジェクト状態確認スクリプト

会話開始時やタスク前に現在の状態を素早く把握するために使用する。

実行:
  python3 scripts/check-project-state.py
  python3 scripts/check-project-state.py --full   # lint + tsc も実行
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent

DATA_FILES = [
    {
        "label": "rs2024-structured",
        "json": "public/data/rs2024-structured.json",
        "gz":   "public/data/rs2024-structured.json.gz",
        "cmd":  "npm run generate-structured",
    },
    {
        "label": "rs2024-project-details",
        "json": "public/data/rs2024-project-details.json",
        "gz":   "public/data/rs2024-project-details.json.gz",
        "cmd":  "npm run generate-project-details",
    },
    {
        "label": "project-quality-recipients-2024",
        "json": "public/data/project-quality-recipients-2024.json",
        "gz":   "public/data/project-quality-recipients-2024.json.gz",
        "cmd":  "npm run score-quality",
    },
    {
        "label": "project-quality-recipients-2025",
        "json": "public/data/project-quality-recipients-2025.json",
        "gz":   "public/data/project-quality-recipients-2025.json.gz",
        "cmd":  "npm run score-quality-2025",
    },
    {
        "label": "sankey2-graph",
        "json": "public/data/sankey2-graph.json",
        "gz":   "public/data/sankey2-graph.json.gz",
        "cmd":  "npm run generate-sankey2",
    },
    {
        "label": "sankey2-layout",
        "json": "public/data/sankey2-layout.json",
        "gz":   "public/data/sankey2-layout.json.gz",
        "cmd":  "npm run compute-sankey2-layout",
    },
    {
        "label": "sankey-svg-2024-graph",
        "json": "public/data/sankey-svg-2024-graph.json",
        "gz":   "public/data/sankey-svg-2024-graph.json.gz",
        "cmd":  "npm run generate-sankey-svg",
    },
    {
        "label": "sankey-svg-2025-graph",
        "json": "public/data/sankey-svg-2025-graph.json",
        "gz":   "public/data/sankey-svg-2025-graph.json.gz",
        "cmd":  "npm run generate-sankey-svg-2025",
    },
    {
        "label": "subcontracts-2024",
        "json": "public/data/subcontracts-2024.json",
        "gz":   "public/data/subcontracts-2024.json.gz",
        "cmd":  "npm run generate-subcontracts",
    },
    {
        "label": "subcontracts-2025",
        "json": "public/data/subcontracts-2025.json",
        "gz":   "public/data/subcontracts-2025.json.gz",
        "cmd":  "npm run generate-subcontracts-2025",
    },
]

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
RESET  = "\033[0m"
BOLD   = "\033[1m"


def check(cond: bool) -> str:
    return f"{GREEN}✓{RESET}" if cond else f"{RED}✗{RESET}"


def run(cmd: list[str], cwd: Path) -> tuple[int, str]:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return result.returncode, result.stdout + result.stderr


def section(title: str):
    print(f"\n{BOLD}{title}{RESET}")
    print("─" * 50)


def main():
    parser = argparse.ArgumentParser(description="プロジェクト状態確認")
    parser.add_argument("--full", action="store_true", help="lint + tsc も実行する")
    args = parser.parse_args()

    print(f"\n{BOLD}=== Project State ==={RESET}")

    # ── Git ──────────────────────────────────────────────────
    section("Git")
    rc, branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], REPO_ROOT)
    branch = branch.strip()

    rc, ahead_behind = run(
        ["git", "rev-list", "--left-right", "--count", "main...HEAD"],
        REPO_ROOT,
    )
    if rc == 0:
        parts = ahead_behind.strip().split()
        behind, ahead = (int(parts[0]), int(parts[1])) if len(parts) == 2 else (0, 0)
        diff_str = ""
        if ahead:
            diff_str += f"  {GREEN}↑{ahead} ahead{RESET}"
        if behind:
            diff_str += f"  {YELLOW}↓{behind} behind{RESET}"
        if not ahead and not behind:
            diff_str = "  (up to date with main)"
        print(f"Branch : {BOLD}{branch}{RESET}{diff_str}")
    else:
        print(f"Branch : {BOLD}{branch}{RESET}")

    rc, log = run(["git", "log", "--oneline", "-3"], REPO_ROOT)
    for line in log.strip().splitlines():
        print(f"  {line}")

    # ── Data Files ───────────────────────────────────────────
    section("Data Files")
    missing_cmds = []
    for f in DATA_FILES:
        json_path = REPO_ROOT / f["json"]
        gz_path   = REPO_ROOT / f["gz"]
        json_ok   = json_path.exists()
        gz_ok     = gz_path.exists()

        if json_ok and gz_ok:
            size_mb = json_path.stat().st_size / 1_000_000
            print(f"  {check(True)} {f['label']:<35} {size_mb:.1f}MB")
        elif gz_ok:
            print(f"  {YELLOW}~{RESET} {f['label']:<35} (.gz only, not expanded)")
        else:
            print(f"  {check(False)} {f['label']:<35} → {YELLOW}{f['cmd']}{RESET}")
            missing_cmds.append(f["cmd"])

    if missing_cmds:
        print(f"\n  {YELLOW}要実行:{RESET}")
        for cmd in missing_cmds:
            print(f"    {cmd}")

    # ── Task Docs ────────────────────────────────────────────
    section("Task Docs")
    tasks_dir = REPO_ROOT / "docs" / "tasks"
    archive_dir = tasks_dir / "archive"
    all_mds = list(tasks_dir.glob("*.md"))
    archived = list(archive_dir.glob("*.md")) if archive_dir.exists() else []
    print(f"  docs/tasks/         : {len(all_mds)} files")
    if archived:
        print(f"  docs/tasks/archive/ : {len(archived)} files")
    if len(all_mds) > 100:
        print(f"  {YELLOW}⚠ ファイルが多い。python3 scripts/task-archive.py --before YYYY-MM-DD を検討{RESET}")

    # ── Lint + TypeScript (--full のみ) ──────────────────────
    if args.full:
        section("Lint")
        rc, out = run(["npm", "run", "lint"], REPO_ROOT)
        errors = [l for l in out.splitlines() if "error" in l.lower() and "warning" not in l.lower()]
        warnings = [l for l in out.splitlines() if "warning" in l.lower()]
        if errors:
            print(f"  {check(False)} {len(errors)} errors")
            for e in errors[:5]:
                print(f"    {e}")
        else:
            print(f"  {check(True)} 0 errors, {len(warnings)} warnings")

        section("TypeScript")
        rc, out = run(["npx", "tsc", "--noEmit"], REPO_ROOT)
        if rc == 0:
            print(f"  {check(True)} OK")
        else:
            lines = [l for l in out.splitlines() if l.strip()]
            print(f"  {check(False)} {len(lines)} errors")
            for l in lines[:5]:
                print(f"    {l}")

    print()


if __name__ == "__main__":
    main()
