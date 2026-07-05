#!/usr/bin/env python3
"""
支出先の法人番号解決マッピング生成（houjin.db 裏取り）。

支出先インデックス再設計 Phase 3b。houjin.db を ground truth に、同一実体と確認できる
誤記載のみ自動統合し、番号欠落を一意名称一致で補完するマッピングを出力する。
自動マージは「別実体を誤って束ねない」よう houjin.db で裏取りしたケースに限定する。

使い方:
  python3 scripts/generate-recipient-resolution.py [--year YEAR]

入力:
  data/year_{YEAR}/5-1_RS_{YEAR}_支出先_支出情報.csv  (UTF-8)
  data/houjin.db

出力:
  public/data/recipient-resolution-{YEAR}.json
  {
    "mergeCn":     { "<正規化名>": { "<誤記載cn>": "<正規cn>" }, ... },
        # 同名の複数有効番号のうち houjin公式名が正確に1つ一致 → 他を正規へ統合。
        # 誤記載cnは別の名前では正規番号でありうる(例 4000020330001 は岡山県では正規)ため、
        # 必ず (名前, 番号) の組で判定する。
    "supplement":  { "<正規化名>": "<cn>", ... }          # 番号欠落/無効かつ houjin完全一致が一意 → 補完
  }

解決の適用は app/lib/recipient-key.ts の resolveRecipientKey が行う（Pure）。
生成器（generate-recipient-index.ts / generate-sankey-svg-data.ts）が本JSONを読んで適用する。
"""

import argparse
import csv
import json
import re
import sqlite3
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

parser = argparse.ArgumentParser(description='支出先の法人番号解決マッピング生成（houjin.db 裏取り）')
parser.add_argument('--year', type=int, default=2024)
args = parser.parse_args()
YEAR = args.year

SPEND_CSV = REPO_ROOT / 'data' / f'year_{YEAR}' / f'5-1_RS_{YEAR}_支出先_支出情報.csv'
HOUJIN_DB = REPO_ROOT / 'data' / 'houjin.db'
OUT_JSON = REPO_ROOT / 'public' / 'data' / f'recipient-resolution-{YEAR}.json'

for p in (SPEND_CSV, HOUJIN_DB):
    if not p.exists():
        print(f'ERROR: 入力が見つかりません: {p}', file=sys.stderr)
        sys.exit(1)

# 法人格略記の統一（recipient-key.ts の CORPORATE_ABBREVIATIONS と同一）
_ABBR = [
    (re.compile(r'[(（]株[)）]|㈱'), '株式会社'),
    (re.compile(r'[(（]有[)）]|㈲'), '有限会社'),
    (re.compile(r'[(（]合[)）]'), '合同会社'),
    (re.compile(r'[(（]財[)）]'), '財団法人'),
    (re.compile(r'[(（]社[)）]'), '社団法人'),
    (re.compile(r'[(（]独[)）]'), '独立行政法人'),
]


def normalize_name(name: str) -> str:
    """recipient-key.ts の normalizeRecipientName と同一: NFKC + 空白除去 + 小文字化 + 法人格統一。"""
    s = unicodedata.normalize('NFKC', name)
    s = re.sub(r'\s+', '', s).lower()
    for pat, rep in _ABBR:
        s = pat.sub(rep, s)
    return s


def has_valid_check_digit(cn: str) -> bool:
    base = cn[1:]
    s = sum(int(base[12 - n]) * (1 if n % 2 == 1 else 2) for n in range(1, 13))
    return 9 - (s % 9) == int(cn[0])


def is_valid_cn(cn: str) -> bool:
    cn = cn.strip()
    if len(cn) != 13 or not cn.isdigit():
        return False
    if cn == cn[0] * 13:
        return False
    return has_valid_check_digit(cn)


EXCLUDED_NAMES = {'', 'その他', '其他'}

# ── 1. RS集計 ──
print(f'[1/3] RS集計: {SPEND_CSV.name}')
name_cns = defaultdict(set)          # 支出先名 → {有効法人番号}
name_has_missing = defaultdict(bool)  # 支出先名 → 欠落/無効(=ダミー含む)の行があるか
with open(SPEND_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        name = (r.get('支出先名') or '').strip()
        if name in EXCLUDED_NAMES:
            continue
        cn = (r.get('法人番号') or '').strip()
        if is_valid_cn(cn):
            name_cns[name].add(cn)
        else:
            name_has_missing[name] = True

# ── 2. houjin.db 突合 ──
print('[2/3] houjin.db 裏取り')
conn = sqlite3.connect(f'file:{HOUJIN_DB}?mode=ro', uri=True)
cur = conn.cursor()


def houjin_name(cn: str):
    row = cur.execute('SELECT name FROM houjin WHERE corporate_number=?', (cn,)).fetchone()
    return row[0] if row else None


# mergeCn: 同名に複数有効番号 → houjin公式名が正確に1つ一致するとき、他を正規へ
# 誤記載cnは別名では正規番号でありうるため、(正規化名, 誤記載cn) の組で持つ
merge_cn = {}
merge_pairs = 0
for name, cns in name_cns.items():
    if len(cns) < 2:
        continue
    nn = normalize_name(name)
    matches = [cn for cn in cns if (hn := houjin_name(cn)) and normalize_name(hn) == nn]
    if len(matches) == 1:
        canonical = matches[0]
        others = {cn: canonical for cn in cns if cn != canonical}
        merge_cn[nn] = {**merge_cn.get(nn, {}), **others}
        merge_pairs += len(others)

# supplement: 番号欠落/無効の名前 → houjin完全一致が一意
supplement = {}
missing_names = [n for n, m in name_has_missing.items() if m]
for name in missing_names:
    hits = cur.execute(
        'SELECT corporate_number FROM houjin WHERE name=?', (name,)
    ).fetchall()
    if len(hits) == 1:
        supplement[normalize_name(name)] = hits[0][0]

conn.close()
print(f'  mergeCn: {merge_pairs}件（{len(merge_cn)}名の統合）/ supplement: {len(supplement)}件')

# ── 3. 出力 ──
print('[3/3] 出力')
OUT_JSON.write_text(
    json.dumps({'mergeCn': merge_cn, 'supplement': supplement}, ensure_ascii=False),
    encoding='utf-8'
)
print(f'完了: {OUT_JSON}')
