#!/usr/bin/env python3
"""MOF V1 事項データ（public/data/mof-jikou-{Y}.json.gz）を canonical jikou record に写す adapter（名前の付け替えと絞り込みだけ。値は変えない）。

  python3 -I scripts/research/mof-v1-jikou-adapter.py compare-fy2024 [V2 normalized fy2024 dir]
  python3 -I scripts/research/mof-v1-jikou-adapter.py emit <year> <out.jsonl>

compare-fy2024: adapter 出力と V2 budget-jikou.jsonl を canonical フィールドの組の多重集合で比較する（標準出力は JSON）。
emit: adapter 出力を JSONL に書く。FY2025 にはこのファイルを変えずに使う。
入力 hash が凍結値と違えば STOP する。
"""
import collections, gzip, hashlib, json, os, sys

V1 = 'public/data/mof-jikou-{}.json.gz'
FROZEN_V1_SHA = {
    2024: 'c9d9db1be311181d35e73a79d1d0e97ec0959ec3acc07ef16646fe3ae4ad1070',
    2025: '634a4166e84590dd1320691519f6a2bc4b5212d613c5fdbce1cb6a382ba686a5',
}
FROZEN_V2_SHA = 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e'
SAME = ['accountType', 'ministry', 'organization', 'specialAccount', 'subAccount', 'agency', 'sectionCode', 'sectionName', 'page', 'sourceUrl']
RENAMED = {'jikouName': 'name', 'col4Raw': 'majorExpenseCode', 'amountYen': 'amount', 'previousAmountYen': 'previousAmount', 'differenceYen': 'difference'}
FIELDS = SAME + list(RENAMED)


def sha(path):
    with open(path, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def load_v1(year):
    path = V1.format(year)
    if sha(path) != FROZEN_V1_SHA[year]: sys.exit(f'STOP: {path} SHA-256 mismatch')
    with gzip.open(path, 'rt', encoding='utf-8') as fh: return json.load(fh)['items']


def adapt(items, year):
    doc = f'{year}11001'
    out = []
    for it in items:
        if it.get('documentId') != doc: continue
        rec = {}
        for f in FIELDS:
            src = RENAMED.get(f, f)
            if src not in it or it[src] is None: sys.exit(f'STOP: {it.get("id")} lacks {src}')
            rec[f] = it[src]
        out.append(rec)
    return out


def v2_canonical(rec):
    r = {f: rec[f] for f in FIELDS if f not in ('page', 'sourceUrl')}
    r['page'] = rec['sourceLocator']['page']
    r['sourceUrl'] = rec['source']['sourceUrl']
    return r


def key(r): return tuple(r[f] for f in FIELDS)


def compare(v2dir):
    p = os.path.join(v2dir, 'budget-jikou.jsonl')
    if sha(p) != FROZEN_V2_SHA: sys.exit('STOP: budget-jikou.jsonl SHA-256 mismatch')
    with open(p, encoding='utf-8') as fh: v2 = [v2_canonical(json.loads(l)) for l in fh if l.strip()]
    v1 = adapt(load_v1(2024), 2024)
    c1, c2 = collections.Counter(map(key, v1)), collections.Counter(map(key, v2))
    only1, only2 = c1 - c2, c2 - c1
    # フィールド別: そのフィールドの値の多重集合の差（両方向の合計）
    per_field = {f: sum((collections.Counter(r[f] for r in v1) - collections.Counter(r[f] for r in v2)).values())
                 + sum((collections.Counter(r[f] for r in v2) - collections.Counter(r[f] for r in v1)).values()) for f in FIELDS}
    ex = lambda c: [dict(zip(FIELDS, k)) for k in list(c.elements())[:10]]
    res = {
        'inputs': {'v1_2024': FROZEN_V1_SHA[2024], 'v2_2024': FROZEN_V2_SHA, 'adapter_sha256': sha(__file__)},
        'counts': {'v1_adapter': len(v1), 'v2': len(v2), 'v1_unique_tuples': len(c1), 'v2_unique_tuples': len(c2)},
        'multisetEqual': c1 == c2,
        'onlyV1': sum(only1.values()), 'onlyV2': sum(only2.values()),
        'perFieldValueMultisetDiff': per_field,
        'examplesOnlyV1': ex(only1), 'examplesOnlyV2': ex(only2),
        'decision': 'GO' if c1 == c2 else 'STOP',
    }
    print(json.dumps(res, ensure_ascii=False, indent=2))


def emit(year, out):
    recs = adapt(load_v1(year), year)
    with open(out, 'w', encoding='utf-8') as fh:
        for r in recs: fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(json.dumps({'year': year, 'records': len(recs), 'out': out, 'outSha256': sha(out), 'adapter_sha256': sha(__file__)}, ensure_ascii=False))


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['compare-fy2024']: compare(a[1] if len(a) > 1 else os.path.expanduser('~/MyGitHub/marumie-rssystem/data/normalized/mof/fy2024'))
    elif a[:1] == ['emit'] and len(a) == 3: emit(int(a[1]), a[2])
    else: sys.exit(__doc__)
