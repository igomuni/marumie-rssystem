#!/usr/bin/env python3
"""MOF の archive の公式 CSV（b.csv）から 項・目 の CSV を作る（原本の形のまま。値の補正・推測はしない）。

  python3 -I scripts/research/build-mof-archive-kou-moku-csv.py <out-root>

契約: docs/tasks/20261015_0822_MOF_Archive_CSV_Primitives_Contract.md。
<out-root>/{version}/ に kou-general.csv, moku-general.csv, kou-special.csv, moku-special.csv, summary.json を書く（version = 2024, 2025, 2025_teishutsu）。
入力の zip の SHA-256 が凍結値と違えば、何も出さずに STOP する。
"""
import collections, csv, hashlib, io, json, os, sys, zipfile

A = 'data/download/mof.go.jp/archive'
FROZEN = {
    '2024/2024/csv/DL202411001.zip': '234bd440ac8647a07e458e3609457d00a133ffbbef2fc766b1421e1c5510e06f',
    '2024/2024/csv/DL202412001.zip': '48392740ce2a8b83c6e3af0141f37e3ebeebd268466890a506658fa75487603c',
    '2025/2025/csv/DL202511001.zip': 'ad3e482a8c2102f29e8ccd1fc2484b4144650993781cd9c53e2b7a66166cdc2d',
    '2025/2025/csv/DL202512001.zip': '7332b8691a2fecf625338785d4972f879e45236698fe4a58ea60fdbd17982e15',
    '2025/2025_teishutsu/csv/DL202511001.zip': '8af4d9f0b5f0d38fdee72f67b458e39bfa9c016b7f3f789009abf29a31cbadc7',
    '2025/2025_teishutsu/csv/DL202512001.zip': '4031d7f9e387ed2211156cb9168e5dba2d42078f2899c153ce92c503886f8766',
}
# version → (csv の置き場, 帳票 ID の年部分)
VERSIONS = {'2024': ('2024/2024/csv', '2024'), '2025': ('2025/2025/csv', '2025'), '2025_teishutsu': ('2025/2025_teishutsu/csv', '2025')}
# 項のキーにする列（原本の見出し）
KOU_KEY = {'general': ['所管', '組織', '項コード', '項名'],
           'special': ['所管', '特別会計', '勘定', '項コード', '項名', '共管所管名', '共管組織名']}
ACCOUNTS = {'general': '11001', 'special': '12001'}


def sha(path):
    with open(path, 'rb') as fh: return hashlib.sha256(fh.read()).hexdigest()


def read_b(zip_path, name):
    text = zipfile.ZipFile(zip_path).read(name).decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    rows = list(csv.reader(io.StringIO(text)))
    return rows[0], [r for r in rows[1:] if r]


def write(path, header, rows):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n'); w.writerow(header); w.writerows(rows)


def main(out_root):
    for rel, h in FROZEN.items():
        if sha(f'{A}/{rel}') != h: sys.exit(f'STOP: {rel} SHA-256 mismatch')
    for version, (csv_dir, year) in VERSIONS.items():
        out = f'{out_root}/{version}'; os.makedirs(out, exist_ok=True)
        summary = {'version': version, 'inputs': {}}
        for account, doc in ACCOUNTS.items():
            zp = f'{A}/{csv_dir}/DL{year}{doc}.zip'
            rel = os.path.relpath(zp, A)
            header, rows = read_b(zp, f'DL{year}{doc}b.csv')
            ix = {h: i for i, h in enumerate(header)}
            key_cols = KOU_KEY[account]
            miss = [c for c in key_cols if c not in ix]
            if miss: sys.exit(f'STOP: {rel} lacks columns {miss}')
            cur_i, prv_i = len(header) - 3, len(header) - 2   # 末尾3列が 当年度・前年度・比較増△減（見出しは版で違う）
            for r in rows:
                if len(r) != len(header): sys.exit(f'STOP: {rel} row length {len(r)} != {len(header)}')
                for i in (cur_i, prv_i, cur_i + 2):
                    int(r[i])   # 整数でなければ STOP
            # 項（文書順の最初の出現順）
            kou, order = collections.OrderedDict(), []
            for r in rows:
                k = tuple(r[ix[c]] for c in key_cols)
                e = kou.setdefault(k, {'rows': 0, 'cur': 0, 'prv': 0}); e['rows'] += 1; e['cur'] += int(r[cur_i]); e['prv'] += int(r[prv_i])
            if account == 'special':   # 共管の列は1つの項の中で一定でなければならない
                base = collections.defaultdict(set)
                for k in kou: base[k[:5]].add(k[5:])
                bad = {k: v for k, v in base.items() if len(v) > 1}
                if bad: sys.exit(f'STOP: {rel} 共管 columns vary within a 項: {list(bad)[:3]}')
            write(f'{out}/kou-{account}.csv', key_cols + ['目の行数', f'{header[cur_i]}の合計', f'{header[prv_i]}の合計'],
                  [list(k) + [e['rows'], e['cur'], e['prv']] for k, e in kou.items()])
            write(f'{out}/moku-{account}.csv', header + ['source_row'], [r + [str(n)] for n, r in enumerate(rows, 1)])
            tot_cur, tot_prv = sum(int(r[cur_i]) for r in rows), sum(int(r[prv_i]) for r in rows)
            assert tot_cur == sum(e['cur'] for e in kou.values()) and tot_prv == sum(e['prv'] for e in kou.values())
            top = 'ministry' if account == 'general' else 'ministry'
            summary[account] = {'zip': rel, 'zip_sha256': FROZEN[rel], 'moku_rows': len(rows), 'kou': len(kou),
                                '所管': len({r[ix['所管']] for r in rows}),
                                ('組織' if account == 'general' else '特別会計'): len({tuple(r[ix[c]] for c in (['所管', '組織'] if account == 'general' else ['所管', '特別会計'])) for r in rows}),
                                'columns': header, 'total_current(千円)': tot_cur, 'total_previous(千円)': tot_prv,
                                'sum_of_kou_totals_equals_total': True}
        json.dump(summary, open(f'{out}/summary.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        open(f'{out}/summary.json', 'a').write('\n')
        print(json.dumps({v: {k: summary[v][k] for k in ('moku_rows', 'kou')} for v in ('general', 'special')} | {'version': version}, ensure_ascii=False))


main(sys.argv[1])
