"""
タスクドキュメント アーカイブスクリプト

docs/tasks/ 配下の古いファイルを docs/tasks/archive/ に移動する。
ファイル名の先頭 YYYYMMDD から日付を判定する。

実行:
  python3 scripts/task-archive.py --before 2026-03-01          # 実行
  python3 scripts/task-archive.py --before 2026-03-01 --dry-run  # 確認のみ
"""

import argparse
import re
import shutil
import sys
from datetime import date, datetime
from pathlib import Path

REPO_ROOT  = Path(__file__).parent.parent
TASKS_DIR  = REPO_ROOT / "docs" / "tasks"
ARCHIVE_DIR = TASKS_DIR / "archive"

DATE_PATTERN = re.compile(r"^(\d{8})")


def parse_date_from_filename(name: str) -> date | None:
    m = DATE_PATTERN.match(name)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y%m%d").date()
    except ValueError:
        return None


def main():
    parser = argparse.ArgumentParser(description="古いタスクドキュメントをアーカイブする")
    parser.add_argument(
        "--before",
        required=True,
        metavar="YYYY-MM-DD",
        help="この日付より前のファイルを対象にする",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="実際には移動せず対象一覧のみ表示する",
    )
    args = parser.parse_args()

    try:
        cutoff = datetime.strptime(args.before, "%Y-%m-%d").date()
    except ValueError:
        print(f"エラー: --before の日付形式が不正です: {args.before}")
        sys.exit(1)

    targets = []
    skipped_no_date = []

    for path in sorted(TASKS_DIR.iterdir()):
        if path.is_dir():
            continue
        if path.name.startswith("."):
            continue
        file_date = parse_date_from_filename(path.name)
        if file_date is None:
            skipped_no_date.append(path.name)
            continue
        if file_date < cutoff:
            targets.append(path)

    if not targets:
        print(f"対象ファイルなし（{cutoff} より前の日付ファイルが存在しません）")
        return

    label = "[dry-run] " if args.dry_run else ""
    print(f"{label}{len(targets)} ファイルを docs/tasks/archive/ に移動します（cutoff: {cutoff}）\n")

    if not args.dry_run:
        ARCHIVE_DIR.mkdir(exist_ok=True)

    for path in targets:
        dest = ARCHIVE_DIR / path.name
        print(f"  {'→' if not args.dry_run else '~'} {path.name}")
        if not args.dry_run:
            if dest.exists():
                print(f"    ⚠ スキップ（archive/ に同名ファイルが存在）")
                continue
            shutil.move(str(path), str(dest))

    if skipped_no_date:
        print(f"\n日付パターン未検出のためスキップ（{len(skipped_no_date)} 件）:")
        for name in skipped_no_date:
            print(f"  {name}")

    if not args.dry_run:
        print(f"\n完了: {len(targets)} ファイルをアーカイブしました")
    else:
        print(f"\n（dry-run: 実際には移動していません。--dry-run を外して実行してください）")


if __name__ == "__main__":
    main()
