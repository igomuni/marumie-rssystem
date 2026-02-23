"""
完全一致・格分類 統合カバレッジ調査スクリプト

Step 1: public/data/dictionaries/ の全辞書（完全一致 + 正規表現）
Step 2: 格パターン（法人格分類）

実行:
  python3 scripts/analyze-label-coverage.py
"""

import csv
import os
import re
import sys
from collections import defaultdict

# ─────────────────────────────────────────────────────────────
# パス設定
# ─────────────────────────────────────────────────────────────
REPO_ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_CSV  = os.path.join(REPO_ROOT, 'data', 'result', 'recipients_without_total.csv')
DICT_DIR   = os.path.join(REPO_ROOT, 'public', 'data', 'dictionaries')

# ─────────────────────────────────────────────────────────────
# 府省庁スキーマ: name 列を持たない辞書の抽出対象列
# ─────────────────────────────────────────────────────────────
MINISTRY_SCHEMA_COLS = {
    'ministry_names.csv':       ['ministry', 'bureau', 'division', 'section', 'office', 'team', 'unit'],
    'ministry_from_ichiran.csv': ['ministry', 'bureau', 'bureau_alias', 'section'],
    'ministry_supplement.csv':  ['ministry', 'bureau', 'bureau_alias', 'section'],
}

# ─────────────────────────────────────────────────────────────
# Step 2: 格パターン定義（L1大分類, L2中分類, 正規表現）
# 出典: docs/tasks/20260223_0807_格による支出先法人格分類設計.md §3
# ─────────────────────────────────────────────────────────────
KAKU_PATTERNS = [
    ('民間企業',      '株式会社',          r'株式会社|[（(]株[）)]'),
    ('民間企業',      '有限会社',          r'有限会社|[（(]有[）)]'),
    ('民間企業',      '合同会社',          r'合同会社|[（(]合[）)]'),
    ('民間企業',      '合資会社',          r'合資会社'),
    ('民間企業',      '合名会社',          r'合名会社'),
    ('独立行政法人等', '国立研究開発法人',  r'国立研究開発法人'),
    ('独立行政法人等', '独立行政法人',      r'独立行政法人'),
    ('大学法人',      '国立大学法人',      r'国立大学法人'),
    ('大学法人',      '公立大学法人',      r'公立大学法人'),
    ('大学法人',      '学校法人（大学）',  r'学校法人.*大学|大学.*学校法人'),
    ('公益法人・NPO', '公益社団法人',      r'公益社団法人|[（(]公社[）)]'),
    ('公益法人・NPO', '公益財団法人',      r'公益財団法人|[（(]公財[）)]'),
    ('公益法人・NPO', '一般社団法人',      r'一般社団法人|[（(]一社[）)]'),
    ('公益法人・NPO', '一般財団法人',      r'一般財団法人|[（(]一財[）)]'),
    ('公益法人・NPO', '特定非営利活動法人', r'特定非営利活動法人|NPO法人'),
    ('協同組合等',    '農業協同組合',      r'農業協同組合'),
    ('協同組合等',    '漁業協同組合',      r'漁業協同組合'),
    ('協同組合等',    '森林組合',          r'森林組合'),
    ('協同組合等',    '消費生活協同組合',  r'消費生活協同組合'),
    ('協同組合等',    '共済組合',          r'共済組合'),
    ('協同組合等',    '商工会議所',        r'商工会議所'),
    ('協同組合等',    '商工会',            r'商工会'),
    ('協同組合等',    '連合会',            r'連合会'),
    ('協同組合等',    '年金基金',          r'年金基金'),
    ('学校法人',      '学校法人',          r'学校法人'),
    ('医療・福祉法人', '社会医療法人',     r'社会医療法人'),
    ('医療・福祉法人', '医療法人',         r'医療法人'),
    ('医療・福祉法人', '社会福祉法人',     r'社会福祉法人'),
    ('医療・福祉法人', '赤十字',           r'赤十字'),
    ('その他法人',    '宗教法人',          r'宗教法人'),
]

KAKU_COMPILED = [(l1, l2, re.compile(pat)) for l1, l2, pat in KAKU_PATTERNS]
SEPARATORS    = re.compile(r'[・、]')


# ─────────────────────────────────────────────────────────────
# ヘルパー
# ─────────────────────────────────────────────────────────────
def to_cho(yen: int) -> str:
    return f'{yen / 1e12:.2f}兆円'


def pct(num: int, denom: int) -> str:
    return f'{num / denom * 100:.1f}%' if denom else '0.0%'


def is_skip_target(name: str) -> bool:
    """
    共同企業体等の合算名称を検出してスキップ対象とする。
    条件: 区切り文字(・ or 、)を含み、かつ区切られた複数セグメントの
         うち 2 セグメント以上に格ワードがマッチする。
    """
    if not SEPARATORS.search(name):
        return False
    segments = SEPARATORS.split(name)
    kaku_segments = sum(
        1 for seg in segments
        if any(pat.search(seg) for _, _, pat in KAKU_COMPILED)
    )
    return kaku_segments >= 2


# ─────────────────────────────────────────────────────────────
# 辞書の読み込み
# ─────────────────────────────────────────────────────────────
def load_dictionaries(dict_dir: str):
    """
    戻り値:
      dict_exact : {filename: set[str]}         完全一致セット
      dict_regex : {filename: list[re.Pattern]}  正規表現リスト
    """
    dict_exact: dict[str, set] = {}
    dict_regex: dict[str, list] = {}

    for fname in sorted(os.listdir(dict_dir)):
        if not fname.endswith('.csv'):
            continue

        fpath = os.path.join(dict_dir, fname)
        exact_set: set[str] = set()
        regex_list: list = []

        with open(fpath, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames or []

            if 'name' in fieldnames:
                # 標準スキーマ
                has_match_type = 'match_type' in fieldnames
                for row in reader:
                    name = row.get('name', '').strip()
                    if not name:
                        continue
                    if has_match_type and row.get('match_type', '').strip() == 'regex':
                        try:
                            regex_list.append(re.compile(name))
                        except re.error as e:
                            print(f'  [WARN] regex compile error in {fname}: {name!r} ({e})',
                                  file=sys.stderr)
                    else:
                        exact_set.add(name)

            elif fname in MINISTRY_SCHEMA_COLS:
                # 府省庁スキーマ
                for row in reader:
                    for col in MINISTRY_SCHEMA_COLS[fname]:
                        val = row.get(col, '').strip()
                        if val:
                            exact_set.add(val)

        dict_exact[fname] = exact_set
        dict_regex[fname] = regex_list

    return dict_exact, dict_regex


# ─────────────────────────────────────────────────────────────
# 入力 CSV の読み込み
# ─────────────────────────────────────────────────────────────
def load_recipients(input_csv: str) -> dict[str, int]:
    """
    戻り値: {支出先名: 金額合計（円）}
    """
    name_amount: dict[str, int] = defaultdict(int)
    with open(input_csv, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('支出先名', '').strip()
            try:
                amount = int(row.get('金額', '0').replace(',', ''))
            except ValueError:
                amount = 0
            if name:
                name_amount[name] += amount
    return dict(name_amount)


# ─────────────────────────────────────────────────────────────
# メイン
# ─────────────────────────────────────────────────────────────
def main():
    # ── 存在確認 ──────────────────────────────────────────────
    if not os.path.exists(INPUT_CSV):
        print(f'エラー: 入力ファイルが見つかりません: {INPUT_CSV}', file=sys.stderr)
        print('  npm run normalize && npm run generate-structured を先に実行してください',
              file=sys.stderr)
        sys.exit(1)

    # ── データ読み込み ─────────────────────────────────────────
    print('読み込み中...', end=' ', flush=True)
    name_amount  = load_recipients(INPUT_CSV)
    dict_exact, dict_regex = load_dictionaries(DICT_DIR)
    print('完了')

    all_names    = list(name_amount.keys())
    total_count  = len(all_names)
    total_amount = sum(name_amount.values())

    # ══════════════════════════════════════════════════════════
    # Step 1: 完全一致辞書マッチング
    # ══════════════════════════════════════════════════════════
    dict_hit_names: dict[str, set] = {}  # fname -> set of matched names

    for fname in dict_exact:
        exact_set  = dict_exact[fname]
        regex_list = dict_regex.get(fname, [])
        hits: set[str] = set()
        for name in all_names:
            if name in exact_set:
                hits.add(name)
            elif regex_list and any(p.fullmatch(name) for p in regex_list):
                hits.add(name)
        dict_hit_names[fname] = hits

    # aggregate_names の exact/regex 内訳（表示用）
    agg_fname     = 'aggregate_names.csv'
    agg_exact_hits: set[str] = set()
    agg_regex_hits: set[str] = set()
    if agg_fname in dict_exact:
        for name in all_names:
            if name in dict_exact[agg_fname]:
                agg_exact_hits.add(name)
            elif dict_regex.get(agg_fname) and any(
                    p.fullmatch(name) for p in dict_regex[agg_fname]):
                agg_regex_hits.add(name)

    # 全辞書の和集合
    s1_hit_names: set[str] = set()
    for hits in dict_hit_names.values():
        s1_hit_names |= hits
    s1_count  = len(s1_hit_names)
    s1_amount = sum(name_amount[n] for n in s1_hit_names)

    # ══════════════════════════════════════════════════════════
    # Step 2: 格パターンマッチング
    # ══════════════════════════════════════════════════════════
    skipped_names = {n for n in all_names if is_skip_target(n)}
    target_names  = [n for n in all_names if n not in skipped_names]

    l1_hits:   dict[str, set] = defaultdict(set)
    l2_hits:   dict[str, set] = defaultdict(set)
    label_cnt: dict[str, int] = {}   # name -> L2 ラベル数

    for name in target_names:
        matched = [(l1, l2) for l1, l2, pat in KAKU_COMPILED if pat.search(name)]
        for l1, l2 in matched:
            l1_hits[l1].add(name)
            l2_hits[l2].add(name)
        label_cnt[name] = len(matched)

    s2_hit_names: set[str] = set()
    for hits in l2_hits.values():
        s2_hit_names |= hits
    s2_count  = len(s2_hit_names)
    s2_amount = sum(name_amount[n] for n in s2_hit_names)

    # ラベル数分布
    dist = {0: 0, 1: 0, 2: 0}
    for name in target_names:
        c = label_cnt.get(name, 0)
        dist[min(c, 2)] += 1

    # ══════════════════════════════════════════════════════════
    # 合算・未カバー
    # ══════════════════════════════════════════════════════════
    union_names   = s1_hit_names | s2_hit_names
    overlap_names = s1_hit_names & s2_hit_names
    union_count   = len(union_names)
    union_amount  = sum(name_amount[n] for n in union_names)

    uncovered = sorted(
        ((name_amount[n], n) for n in all_names if n not in union_names),
        reverse=True
    )

    # ══════════════════════════════════════════════════════════
    # レポート出力
    # ══════════════════════════════════════════════════════════
    SEP = '─' * 58

    print()
    print('=== 完全一致・格分類 統合カバレッジレポート ===')
    print(f'入力: {INPUT_CSV}')
    print(f'ユニーク支出先名: {total_count:,}件 / 総金額: {to_cho(total_amount)}')

    # ── Step 1 ───────────────────────────────────────────────
    print()
    print(SEP)
    print('Step 1: 完全一致辞書')
    print(SEP)
    print('[辞書別ヒット数（辞書間重複含む）]')

    for fname in sorted(dict_hit_names.keys()):
        hits     = dict_hit_names[fname]
        h_count  = len(hits)
        h_amount = sum(name_amount[n] for n in hits)
        extra    = ''
        if fname == agg_fname:
            extra = f'  (exact: {len(agg_exact_hits)}件 / regex: {len(agg_regex_hits)}件)'
        print(f'  {fname:<38s}: {h_count:5,}件  {to_cho(h_amount)}{extra}')

    print()
    print('[Step 1 合計（辞書間重複除外）]')
    print(f'  件数カバレッジ: {s1_count:,}件 / {total_count:,}件 = {pct(s1_count, total_count)}')
    print(f'  金額カバレッジ: {pct(s1_amount, total_amount)}')

    # ── Step 2 ───────────────────────────────────────────────
    print()
    print(SEP)
    print(f'Step 2: 格パターン（スキップ {len(skipped_names):,}件除く {len(target_names):,}件対象）')
    print(SEP)

    L1_ORDER = [
        '民間企業', '公益法人・NPO', '協同組合等', '独立行政法人等',
        '大学法人', '学校法人', '医療・福祉法人', 'その他法人',
    ]
    print('[L1大分類別]')
    for l1 in L1_ORDER:
        hits = l1_hits.get(l1, set())
        if hits:
            print(f'  {l1:<18s}: {len(hits):6,}件  {to_cho(sum(name_amount[n] for n in hits))}')

    print()
    print('[L2中分類別（件数降順）]')
    for l2, hits in sorted(l2_hits.items(), key=lambda x: -len(x[1])):
        print(f'  {l2:<22s}: {len(hits):6,}件  {to_cho(sum(name_amount[n] for n in hits))}')

    print()
    print('[ラベル数分布]')
    print(f'  0ラベル（格なし）: {dist[0]:6,}件  {pct(dist[0], len(target_names))}')
    print(f'  1ラベル          : {dist[1]:6,}件  {pct(dist[1], len(target_names))}')
    print(f'  2ラベル以上      : {dist[2]:6,}件  {pct(dist[2], len(target_names))}')

    print()
    print('[Step 2 合計]')
    print(f'  件数カバレッジ: {s2_count:,}件 / {total_count:,}件 = {pct(s2_count, total_count)}')
    print(f'  金額カバレッジ: {pct(s2_amount, total_amount)}')

    # ── 合算 ─────────────────────────────────────────────────
    print()
    print(SEP)
    print('Step 1 ∪ Step 2 合算')
    print(SEP)
    print(f'  件数カバレッジ: {union_count:,}件 / {total_count:,}件 = {pct(union_count, total_count)}')
    print(f'  金額カバレッジ: {pct(union_amount, total_amount)}')
    print(f'  重複（両ステップでヒット）: {len(overlap_names):,}件')

    # ── 未カバー ─────────────────────────────────────────────
    top_n = 20
    print()
    print(SEP)
    print(f'未カバー 上位{top_n}件（金額降順）')
    print(SEP)
    for amount, name in uncovered[:top_n]:
        print(f'  {to_cho(amount)}  {name}')

    print()


if __name__ == '__main__':
    main()
