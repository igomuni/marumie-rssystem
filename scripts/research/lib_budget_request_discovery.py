"""概算要求書 PDF の探索（巡回・候補選定）で共有する、年度の判定。

文字列（リンクの文字・URL）に現れる年度を、令和N年度の N の集合として取り出す。
  令和9・令和９年度・R9・r09・9年度・2027（前後が数字でない 4 桁）・fy2027 → 9
  平成N・H N（例 h30）は、令和より前の年度とみなし、負の数（N - 31 以下）で表す（対象年度には決してならない）
別の年度が書かれていて対象年度がなければ「他の年度」とみなし、リンクをたどらない・候補にしない。年度が何も書かれていなければ「年度不明」で、除外しない。
"""
import re
import unicodedata

_PATTERNS = (
    (re.compile(r'令和\s*(\d{1,2})'), 0),
    (re.compile(r'(?<![\d令和])(\d{1,2})\s*年度'), 0),
    (re.compile(r'(?<![0-9A-Za-z])[Rr]\s*0?(\d{1,2})(?!\d)'), 0),
    (re.compile(r'平成\s*(\d{1,2})'), 31),
    (re.compile(r'(?<![0-9A-Za-z])[Hh]\s*0?(\d{1,2})(?!\d)'), 31),
    (re.compile(r'(?<!\d)(20\d\d)(?!\d)'), 2018),
    (re.compile(r'[Ff][Yy](20\d\d)(?!\d)'), 2018),
)


def reiwa_years(s: str) -> set[int]:
    t = unicodedata.normalize('NFKC', s)
    out: set[int] = set()
    for pat, off in _PATTERNS:
        for m in pat.finditer(t):
            n = int(m.group(1)) - off
            if -40 <= n <= 30: out.add(n)
    return out


def is_other_year(s: str, n: int) -> bool:
    """年度が書かれていて、対象（令和 n 年度）がないとき True。年度が書かれていなければ False"""
    ys = reiwa_years(s)
    return bool(ys) and n not in ys
