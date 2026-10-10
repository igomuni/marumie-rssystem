/**
 * B 層 column continuity visual failure isolation の sample 選定 helper（analysis-only・production path から呼ばない）。
 * #412 の committed census だけを入力とし、PDF・raw-text・visual 情報は一切使わない。
 *
 * ---- 選定規則 v1（census を見る前に固定。結果を見て調整しない。#412 task doc §10 の提案をそのまま実装）----
 * population : census.pages[] のうち flags.P2 が true の page から、#411 sample の page を除いたもの（eligible）。
 * 解釈の固定 :
 *   - classifierSource = census page の classifierSource（DIRECT / INHERITED）。
 *   - left 末尾 kind   = q2.leftTail の最後の要素（left stream 末尾の最後の semantic row）の kind。ITEM / REQUEST 以外は層に入らない（欠けた層扱いではなく stratum 対象外）。
 *   - 右先頭 REQUEST 数 = q2.rightRequestsBeforeFirstItem。
 *   - 辞書順 = (localPdfPath, physicalPage) を localPdfPath は UTF-16 code unit 順の文字列比較、次に physicalPage 数値昇順。
 * (1) 層 = classifierSource × left 末尾 kind の最大 4 層（DIRECT/ITEM, DIRECT/REQUEST, INHERITED/ITEM, INHERITED/REQUEST）。各層で辞書順先頭 1 page。
 * (2) (1) の選択済みを除く eligible 全体から、右先頭 REQUEST 数の降順（同点は辞書順）で 2 page を追加（stratum = TOP_RIGHT_REQUESTS）。
 * (3) 合計最大 6 page。重複なし。層が空でも他の層で補わない（合計 6 未満でもよい）。
 * sample ID は選定順・層を示唆しないよう、選ばれた page を辞書順に並べて CC-01.. を採番する。
 * 無作為標本ではなく、prevalence は推定しない。
 */
export const SELECTION_ALGORITHM = 'column-continuity-visual-sample/v1';

export type CensusPageLike = {
  localPdfPath: string; physicalPage: number; partition: string; classifierSource: string; pageState: string;
  flags: { P2: boolean };
  q2: { rightRequestsBeforeFirstItem: number; leftTail: { kind: string; code: string | null }[] } | null;
};
export type PageId = { localPdfPath: string; physicalPage: number };
export type Selected = { page: CensusPageLike; stratum: string; reason: string };

export const cmpPage = (a: PageId, b: PageId): number =>
  a.localPdfPath < b.localPdfPath ? -1 : a.localPdfPath > b.localPdfPath ? 1 : a.physicalPage - b.physicalPage;
export const pageKey = (p: PageId): string => `${p.localPdfPath}#${p.physicalPage}`;
export const leftLastKind = (p: CensusPageLike): string | null => (p.q2 && p.q2.leftTail.length ? p.q2.leftTail[p.q2.leftTail.length - 1].kind : null);

export const STRATA = ['DIRECT/ITEM', 'DIRECT/REQUEST', 'INHERITED/ITEM', 'INHERITED/REQUEST'] as const;
export const stratumOf = (p: CensusPageLike): string => `${p.classifierSource}/${leftLastKind(p)}`;

export function eligiblePages(pages: CensusPageLike[], excluded: PageId[]): CensusPageLike[] {
  const ex = new Set(excluded.map(pageKey));
  return pages.filter(p => p.flags.P2 && !ex.has(pageKey(p))).sort(cmpPage);
}

export function selectSample(eligible: CensusPageLike[]): Selected[] {
  const sorted = [...eligible].sort(cmpPage);
  const picked: Selected[] = [];
  const taken = new Set<string>();
  for (const s of STRATA) {
    const first = sorted.find(p => stratumOf(p) === s);
    if (first) { picked.push({ page: first, stratum: s, reason: `LEXICOGRAPHIC_FIRST_IN_STRATUM(${s})` }); taken.add(pageKey(first)); }
  }
  const rest = sorted.filter(p => !taken.has(pageKey(p)))
    .sort((a, b) => (b.q2?.rightRequestsBeforeFirstItem ?? 0) - (a.q2?.rightRequestsBeforeFirstItem ?? 0) || cmpPage(a, b));
  for (const p of rest.slice(0, 2)) picked.push({ page: p, stratum: 'TOP_RIGHT_REQUESTS', reason: 'LARGEST_RIGHT_REQUESTS_BEFORE_FIRST_ITEM_EXCLUDING_SELECTED' });
  return picked.sort((a, b) => cmpPage(a.page, b.page));
}
