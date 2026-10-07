/**
 * Page Classification v0 の DIRECT title matcher（preregistration で freeze。GT を見た後に変更しない）。
 * これは classifier ではなく、GT candidate 生成が使う凍結 matcher。INHERITED rule・評価は実装しない。
 *
 * rule: PR-1 の nonEmptyLines の先頭 DIRECT_WINDOW 行について、行内の whitespace（JS /\s/。全角空白を含む）をすべて除いた文字列が
 * 「令和」で始まり、かつ title literal で終わる行を title 行とする。NFKC・文字置換・fuzzy・辞書補完はしない。
 * title は precedence 順に評価する（specific → generic）。ページ内に異なる family が複数あれば CONFLICT（推測で解決しない）。
 */
export const DIRECT_WINDOW = 5;

export type DirectFamily = 'PRIORITY_SUMMARY' | 'PRIORITY_DETAIL' | 'SUMMARY' | 'DETAIL' | 'STAFFING' | 'TOC' | 'COVER';

/** precedence 順 */
export const DIRECT_TITLES: readonly { family: DirectFamily; title: string }[] = [
  { family: 'PRIORITY_SUMMARY', title: '重要政策推進枠要望額総表' },
  { family: 'PRIORITY_DETAIL', title: '重要政策推進枠要望額明細表' },
  { family: 'SUMMARY', title: '概算要求額総表' },
  { family: 'DETAIL', title: '概算要求額明細表' },
  { family: 'STAFFING', title: '概算要求定員表' },
  { family: 'TOC', title: '目次' },
  { family: 'COVER', title: '歳出概算要求書' },
];

/** continuation state を持てる family（COVER は継承しない） */
export const INHERITABLE: readonly DirectFamily[] = ['TOC', 'SUMMARY', 'DETAIL', 'STAFFING', 'PRIORITY_SUMMARY', 'PRIORITY_DETAIL'];

export type DirectResult = { kind: 'NONE' } | { kind: 'DIRECT'; family: DirectFamily } | { kind: 'CONFLICT'; families: DirectFamily[] };

export function directMatch(nonEmptyLines: { text: string }[]): DirectResult {
  const found = new Set<DirectFamily>();
  for (const line of nonEmptyLines.slice(0, DIRECT_WINDOW)) {
    const w = line.text.replace(/\s/g, '');
    if (!w.startsWith('令和')) continue;
    for (const t of DIRECT_TITLES) if (w.endsWith(t.title)) found.add(t.family);
  }
  if (found.size === 0) return { kind: 'NONE' };
  if (found.size === 1) return { kind: 'DIRECT', family: [...found][0] };
  return { kind: 'CONFLICT', families: DIRECT_TITLES.map(t => t.family).filter(f => found.has(f)) };
}
