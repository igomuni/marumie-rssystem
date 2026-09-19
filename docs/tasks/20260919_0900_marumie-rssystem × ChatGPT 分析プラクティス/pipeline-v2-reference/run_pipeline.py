#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from pipeline_v2.normalize_mof import normalize_mof
from pipeline_v2.normalize_rs import normalize_rs
from pipeline_v2.derive import derive_all
from pipeline_v2.validate import validate_all


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description='Independent reference implementation for marumie-rssystem Pipeline V2')
    p.add_argument('--raw-root', type=Path, required=True, help='Directory containing mof.go.jp/ and rssystem.go.jp/')
    p.add_argument('--output-root', type=Path, required=True)
    p.add_argument('--fiscal-years', nargs='*', type=int, default=[2024, 2025])
    p.add_argument('--review-years', nargs='*', type=int, default=[2024, 2025])
    return p.parse_args()


def main() -> None:
    args = parse_args()
    args.output_root.mkdir(parents=True, exist_ok=True)
    print('[1/4] normalize MOF')
    normalize_mof(args.raw_root, args.output_root, set(args.fiscal_years))
    print('[2/4] normalize RS')
    normalize_rs(args.raw_root, args.output_root, set(args.review_years))
    print('[3/4] derive events / identity / links')
    derive_all(args.output_root, args.fiscal_years, args.review_years)
    print('[4/4] validate')
    report = validate_all(args.raw_root, args.output_root, args.fiscal_years, args.review_years)
    print(f"done: {args.output_root}")
    print(f"validation: {args.output_root / 'validation' / 'report.md'}")


if __name__ == '__main__':
    main()
