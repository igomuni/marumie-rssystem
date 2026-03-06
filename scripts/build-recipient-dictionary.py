"""
支出先 法人辞書構築スクリプト

data/result/recipients_without_total.csv を元に、ユニークな支出先名リストを作成し
法人番号DB（data/houjin.db）との突合結果を付加する。

出力: data/result/recipient_dictionary.csv

列:
  name             - 元の支出先名
  normalized_name  - 略称解除後の名称
  corporate_number - クリーニング済み法人番号（最頻出または唯一のもの）
  cn_count         - この名前に紐づく法人番号の種類数（複数=同名異法人の可能性）
  name_in_db       - normalized_name が法人番号DBに存在するか
  cn_in_db         - corporate_number が法人番号DBに存在するか
  name_cn_match    - corporate_number の法人名が normalized_name と一致するか
  db_name_by_cn    - corporate_number から引いたDBの法人名
  valid            - name_in_db OR name_cn_match

実行:
  python3 scripts/build-recipient-dictionary.py
"""

import csv
import re
import sqlite3
import collections
from pathlib import Path

REPO_ROOT   = Path(__file__).parent.parent
INPUT_CSV   = REPO_ROOT / 'data' / 'result' / 'recipients_without_total.csv'
HOUJIN_DB   = REPO_ROOT / 'data' / 'houjin.db'
OUTPUT_CSV  = REPO_ROOT / 'data' / 'result' / 'recipient_dictionary.csv'

# ─────────────────────────────────────────────────────────────
# 略称展開マップ
# 位置によって展開先の配置が変わる:
#   先頭にある → 直後の名称に前置  例: (株)○○ → 株式会社○○
#   末尾にある → 直前の名称に後置  例: ○○(株) → ○○株式会社
# ─────────────────────────────────────────────────────────────
ABBREV_MAP = {
    '(株)':   '株式会社',
    '（株）': '株式会社',
    '(有)':   '有限会社',
    '（有）': '有限会社',
    '(合)':   '合同会社',
    '（合）': '合同会社',
    '(同)':   '合同会社',   # 合同会社の略称（非標準だが実データに存在）
    '（同）': '合同会社',
    '(資)':   '合資会社',
    '（資）': '合資会社',
    '(名)':   '合名会社',
    '（名）': '合名会社',
    '(一社)': '一般社団法人',
    '（一社）': '一般社団法人',
    '(公社)': '公益社団法人',
    '（公社）': '公益社団法人',
    '(一財)': '一般財団法人',
    '（一財）': '一般財団法人',
    '(公財)': '公益財団法人',
    '（公財）': '公益財団法人',
}

# 略称の正規表現（前後どちらにあるか判断する）
_ABBREV_RE = re.compile(
    '|'.join(re.escape(k) for k in sorted(ABBREV_MAP, key=len, reverse=True))
)

def expand_abbreviations(name: str) -> str:
    """略称を正式名称に展開する"""
    result = name
    for abbr, full in sorted(ABBREV_MAP.items(), key=lambda x: len(x[0]), reverse=True):
        if abbr not in result:
            continue
        # 先頭にある場合
        if result.startswith(abbr):
            result = full + result[len(abbr):]
        # 末尾にある場合
        elif result.endswith(abbr):
            result = result[:-len(abbr)] + full
        # 中間にある場合（まれなケース、そのまま置換）
        else:
            result = result.replace(abbr, full)
    return result

# ─────────────────────────────────────────────────────────────
# 法人番号クリーニング
# ─────────────────────────────────────────────────────────────

def clean_cn(cn: str) -> str | None:
    cn = cn.strip()
    if not cn or cn in ('FALSE', '0', ''):
        return None
    if not cn.isdigit():
        return None
    if len(cn) == 13:
        return cn
    if len(cn) == 12:
        return '0' + cn   # 先頭0落ちの記載ミス補正
    return None

# ─────────────────────────────────────────────────────────────
# 法人番号DBロード（メモリに展開）
# ─────────────────────────────────────────────────────────────

def normalize(name: str) -> str:
    """全角→半角（NFKC）正規化。DBの全角名称と支出先名の半角名称を統一する"""
    import unicodedata
    return unicodedata.normalize('NFKC', name)

def load_houjin_db(db_path: Path) -> tuple[dict, dict]:
    """
    Returns:
      norm_to_cn:  { NFKC正規化済み法人名 → corporate_number }
      cn_to_name:  { corporate_number → 元の法人名 }
    """
    print('法人番号DB読み込み中...')
    conn = sqlite3.connect(db_path)
    cur  = conn.cursor()
    cur.execute('SELECT name, corporate_number FROM houjin')
    norm_to_cn: dict[str, str] = {}
    cn_to_name: dict[str, str] = {}
    for name, cn in cur.fetchall():
        norm_to_cn[normalize(name)] = cn
        cn_to_name[cn] = name
    conn.close()
    print(f'  {len(norm_to_cn):,}件ロード完了')
    return norm_to_cn, cn_to_name

# ─────────────────────────────────────────────────────────────
# メイン
# ─────────────────────────────────────────────────────────────

def main():
    # ── 入力CSV読み込み ──
    print('入力CSV読み込み中...')
    with open(INPUT_CSV, encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    print(f'  {len(rows):,}行')

    # ── 支出先名ごとに法人番号を収集 ──
    # name → Counter{cn: 出現回数}
    name_cn_counter: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in rows:
        name = r['支出先名'].strip()
        if not name:
            continue
        cn = clean_cn(r.get('法人番号', ''))
        if cn:
            name_cn_counter[name][cn] += 1
        else:
            name_cn_counter[name]  # 存在だけ記録

    print(f'ユニーク支出先名: {len(name_cn_counter):,}件')

    # ── 法人番号DBロード ──
    norm_to_cn, cn_to_name = load_houjin_db(HOUJIN_DB)

    # ── 各支出先名を評価 ──
    out_rows = []
    for name, cn_counter in name_cn_counter.items():
        normalized = expand_abbreviations(name)
        norm_key   = normalize(normalized)   # NFKC正規化キー（DB検索用）

        # 代表法人番号: 最頻出のもの（なければ空）
        if cn_counter:
            best_cn = cn_counter.most_common(1)[0][0]
        else:
            best_cn = ''

        cn_count = len(cn_counter)

        # 法人DBとの突合
        name_in_db    = norm_key in norm_to_cn
        cn_in_db      = best_cn in cn_to_name if best_cn else False
        db_name_by_cn = cn_to_name.get(best_cn, '') if best_cn else ''
        name_cn_match = (normalize(db_name_by_cn) == norm_key) if (best_cn and db_name_by_cn) else False
        # 名前一致 かつ CN あり かつ CN→名前も一致、の3条件すべて必要
        valid = name_in_db and bool(best_cn) and name_cn_match
        # CNはDBに存在し、かつDBの法人名が支出先名に含まれている（親組織名を含む支出先名等）
        db_name_norm = normalize(db_name_by_cn) if db_name_by_cn else ''
        cn_name_contained = cn_in_db and not name_cn_match and bool(db_name_norm) and db_name_norm in norm_key

        out_rows.append({
            'name':           name,
            'normalized_name': normalized,
            'corporate_number': best_cn,
            'cn_count':       cn_count,
            'name_in_db':     name_in_db,
            'cn_in_db':       cn_in_db,
            'name_cn_match':  name_cn_match,
            'cn_name_contained': cn_name_contained,
            'db_name_by_cn':  db_name_by_cn,
            'valid':          valid,
        })

    out_rows.sort(key=lambda r: r['name'])

    # ── 出力 ──
    fieldnames = ['name', 'normalized_name', 'corporate_number', 'cn_count',
                  'name_in_db', 'cn_in_db', 'name_cn_match', 'cn_name_contained', 'db_name_by_cn', 'valid']
    with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(out_rows)

    # ── サマリー ──
    total       = len(out_rows)
    valid_rows  = [r for r in out_rows if r['valid']]
    name_match  = [r for r in out_rows if r['name_in_db']]
    cn_match    = [r for r in out_rows if r['name_cn_match']]
    cn_only     = [r for r in out_rows if r['cn_in_db'] and not r['name_in_db']]
    invalid     = [r for r in out_rows if not r['valid']]
    multi_cn    = [r for r in out_rows if r['cn_count'] > 1]
    normalized_diff = [r for r in out_rows if r['name'] != r['normalized_name']]

    print()
    print('=' * 60)
    print('  支出先 法人辞書構築 サマリー')
    print('=' * 60)
    print(f'ユニーク支出先名:      {total:>7,}件')
    print(f'略称展開あり:          {len(normalized_diff):>7,}件')
    print(f'同名異法人（CN複数）:  {len(multi_cn):>7,}件')
    print()
    print(f'valid（法人DB確認済）: {len(valid_rows):>7,}件  ({len(valid_rows)/total*100:.1f}%)')
    print(f'  └ 法人名で一致:      {len(name_match):>7,}件')
    print(f'  └ CN→名称で一致:    {len(cn_match):>7,}件')
    print(f'invalid（DB未確認）:   {len(invalid):>7,}件  ({len(invalid)/total*100:.1f}%)')
    print(f'  └ CNあるが名称不一致: {len(cn_only):>6,}件')
    print()

    # ── 略称展開サンプル ──
    print('略称展開サンプル（先頭20件）:')
    for r in normalized_diff[:20]:
        match = '✓' if r['valid'] else '✗'
        print(f'  [{match}] {r["name"]}  →  {r["normalized_name"]}')

    # ── invalid 上位（金額は持たないので件数のみ）──
    print()
    print('invalid サンプル（先頭30件、CN付き）:')
    invalid_with_cn = [r for r in invalid if r['corporate_number']]
    for r in invalid_with_cn[:30]:
        print(f'  cn={r["corporate_number"]}  db={r["db_name_by_cn"] or "（なし）"}  name={r["name"]}')

    print()
    print(f'出力: {OUTPUT_CSV}')

if __name__ == '__main__':
    main()
