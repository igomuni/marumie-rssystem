/**
 * Family B header-zone tokenless の independent positive discovery review sample（20 candidate 行）を決定的に選ぶ analysis-only helper。
 * production path から呼ばない。入力は #406 の committed census.json と #407 の review-sample-manifest.json（row identity の取得のみ）。
 * PDF・raw-text 本文・#407 の visual 結果は選定に使わない。sample は「既知 positive に似たもの」ではなく feature-space coverage だけで選ぶ。
 * 禁止: offsetFromE / rightTextChars / leftBlank を positive らしさとして優先すること、文言の検索、H2/H7 との類似度、positive probability の重み付け。
 *
 * ---- 選定手順（census を実行・出力を見る前に固定。結果を見て変更しない）----
 * eligible    = census の mechanical candidate 91 行から、行単位（localPdfPath, physicalPage, lineIndex）で
 *               H2/H7 anchor 行（census.anchors の humanLine）と #407 manifest の role=CONTROL 10 行を除いたもの（ちょうど 79 行でなければ STOP）
 *               同一ページの他の行は eligible のまま
 * 特徴ベクトル = 9 成分（全て同等の重み）
 *               [distanceToHeaderEnd, nearestTrigger, offsetFromE, leftBlank?0:1, rightTextChars, candidatesOnPage,
 *                hasTrigger(triggerCount>0 ?1:0), hasAttachment(currentFragmentsAttached>0 ?1:0), lineIndex]
 *               nearestTrigger = min(precedingTriggerDistance, followingTriggerDistance)（null は除外、両方 null なら NO_TRIGGER_SENTINEL）
 *               各成分は eligible 全体の min-max で [0,1] に正規化（range 0 の成分は 0）。距離は Euclid
 * 順序キー     = (localPdfPath, physicalPage, lineIndex) の辞書順。同値 tie は常にこの順で先のものを選ぶ
 * 選択（farthest-first = 未使用ページの行のうち、既選択への最小距離が最大の行を選ぶ）:
 *   seed        = eligible 全体の centroid から最も遠い行（1 件目。その partition の最小保証に数える）
 *   保証フェーズ = いずれかの partition の選択数が MIN_PER_PARTITION(5) 未満の間、選択数が最小の partition（tie は partition 名の辞書順）
 *                 の未使用ページの行から farthest-first で 1 件。partition の未使用ページが尽きたら STOP
 *   残り        = 合計 20 件になるまで、全 partition の未使用ページの行から farthest-first
 * 原則 1 sample / page（使用済みページの行は候補から除外。20 unique page を確保できなければ STOP）。
 * 出力順・sample ID = 順序キー昇順に PD-01..PD-20（ID は選定順・特徴を示唆しない）
 */
import * as fs from 'fs';
import { sha256Hex } from './budget-request-raw-text';
import {
  NO_TRIGGER_SENTINEL, cmp, loadCensus, pageKey,
  type Census, type CensusCandidate, type CensusPage,
} from './budget-request-toc-header-tokenless-visual-sample';

export { loadCensus, pageKey };
export const SAMPLE_SIZE = 20;
export const ELIGIBLE_EXPECTED = 79;
export const MIN_PER_PARTITION = 5;
export const FEATURE_NAMES = ['distanceToHeaderEnd', 'nearestTrigger', 'offsetFromE', 'leftBlank?0:1', 'rightTextChars', 'candidatesOnPage', 'hasTrigger', 'hasAttachment', 'lineIndex'] as const;

export interface Row { page: CensusPage; cand: CensusCandidate }
export interface RowId { localPdfPath: string; physicalPage: number; lineIndex: number }
export interface ExcludedRow extends RowId { reason: string }
export interface Selected extends Row { rule: string }
export interface ControlManifest { samples: { sampleId: string; role: string; anchorId: string | null; localPdfPath: string; physicalPage: number; lineIndex: number }[] }

export const rowKey = (r: RowId) => `${r.localPdfPath}#${r.physicalPage}#${r.lineIndex}`;
const idOf = (r: Row): RowId => ({ localPdfPath: r.page.localPdfPath, physicalPage: r.page.physicalPage, lineIndex: r.cand.lineIndex });
export const rowOrder = (a: Row, b: Row) =>
  cmp(a.page.localPdfPath, b.page.localPdfPath) || a.page.physicalPage - b.page.physicalPage || a.cand.lineIndex - b.cand.lineIndex;

export const rawFeatures = (r: Row): number[] => {
  const c = r.cand;
  const ds = [c.precedingTriggerDistance, c.followingTriggerDistance].filter((x): x is number => x !== null);
  return [c.distanceToHeaderEnd, ds.length ? Math.min(...ds) : NO_TRIGGER_SENTINEL, c.offsetFromE, c.leftBlank ? 0 : 1, c.rightTextChars,
    r.page.candidates.length, r.page.triggerCount > 0 ? 1 : 0, r.page.currentFragmentsAttached > 0 ? 1 : 0, c.lineIndex];
};

/** 除外行（H2/H7 anchor 行 + #407 manifest の CONTROL 行）。anchor 行は census.anchors の humanLine で同定 */
export function excludedRows(census: Census, ctrl: ControlManifest): ExcludedRow[] {
  const out: ExcludedRow[] = census.anchors.map(a => ({ localPdfPath: a.localPdfPath, physicalPage: a.physicalPage, lineIndex: (a as unknown as { humanLine: number }).humanLine, reason: `census anchor ${a.id}` }));
  for (const s of ctrl.samples.filter(x => x.role === 'CONTROL')) out.push({ localPdfPath: s.localPdfPath, physicalPage: s.physicalPage, lineIndex: s.lineIndex, reason: `#407 control ${s.sampleId}` });
  const keys = new Set(out.map(rowKey));
  if (out.length !== 12 || keys.size !== 12) throw new Error('STOP: excluded rows are not 12 unique rows');
  // #407 manifest の ANCHOR 行が census anchor と一致することの確認
  for (const s of ctrl.samples.filter(x => x.role === 'ANCHOR')) if (!keys.has(rowKey(s))) throw new Error(`STOP: #407 anchor ${s.sampleId} not in census anchors`);
  return out.sort((a, b) => cmp(rowKey(a), rowKey(b)));
}

export function eligibleRows(census: Census, excluded: ExcludedRow[]): Row[] {
  const ex = new Set(excluded.map(rowKey));
  const all = census.pages.flatMap(p => p.candidates.map(cand => ({ page: p, cand })));
  for (const e of excluded) if (!all.some(r => rowKey(idOf(r)) === rowKey(e))) throw new Error(`STOP: excluded row not in census ${rowKey(e)}`);
  const rows = all.filter(r => !ex.has(rowKey(idOf(r)))).sort(rowOrder);
  if (rows.length !== ELIGIBLE_EXPECTED) throw new Error(`STOP: eligible rows ${rows.length} != ${ELIGIBLE_EXPECTED}`);
  return rows;
}

export function makeNorm(rows: Row[]): (r: Row) => number[] {
  const raw = rows.map(rawFeatures);
  const lo = raw[0].map((_, i) => Math.min(...raw.map(v => v[i])));
  const hi = raw[0].map((_, i) => Math.max(...raw.map(v => v[i])));
  return r => rawFeatures(r).map((x, i) => (hi[i] === lo[i] ? 0 : (x - lo[i]) / (hi[i] - lo[i])));
}
const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
// 浮動小数点の微小差で tie が崩れないよう 1e-12 に丸める
const q = (x: number) => Math.round(x * 1e12) / 1e12;
function pickMax(rows: Row[], score: (r: Row) => number): Row {
  if (!rows.length) throw new Error('STOP: no candidate row');
  return [...rows].sort((a, b) => q(score(b)) - q(score(a)) || rowOrder(a, b))[0];
}

export function selectSample(eligible: Row[]): Selected[] {
  const norm = makeNorm(eligible);
  const vecs = eligible.map(norm);
  const centroid = vecs[0].map((_, i) => vecs.reduce((a, v) => a + v[i], 0) / vecs.length);
  const used = new Set<string>();
  const chosen: Selected[] = [];
  const free = (rs: Row[]) => rs.filter(r => !used.has(pageKey(r.page)));
  const add = (r: Row, rule: string) => { used.add(pageKey(r.page)); chosen.push({ ...r, rule }); };
  const minDist = (r: Row) => Math.min(...chosen.map(c => dist(norm(r), norm(c))));
  const partitions = [...new Set(eligible.map(r => r.page.partition))].sort();
  const count = (p: string) => chosen.filter(c => c.page.partition === p).length;

  add(pickMax(eligible, r => dist(norm(r), centroid)), 'seed: farthest from eligible centroid');
  while (partitions.some(p => count(p) < MIN_PER_PARTITION)) {
    const p = [...partitions].sort((a, b) => count(a) - count(b) || cmp(a, b))[0];
    add(pickMax(free(eligible.filter(r => r.page.partition === p)), minDist), `partition guarantee (${p}, ${count(p) + 1}/${MIN_PER_PARTITION}): farthest-first within partition from ${chosen.length} selected`);
  }
  while (chosen.length < SAMPLE_SIZE) add(pickMax(free(eligible), minDist), `remaining slot: global farthest-first from ${chosen.length} selected`);
  if (chosen.length !== SAMPLE_SIZE || new Set(chosen.map(c => pageKey(c.page))).size !== SAMPLE_SIZE) throw new Error('STOP: sample is not 20 rows on 20 unique pages');
  return chosen.sort(rowOrder);
}

export function eligibleSummary(eligible: Row[]) {
  const countBy = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map(k => [k, xs.filter(x => x === k).length]));
  const pages = new Map<string, number>();
  for (const r of eligible) pages.set(pageKey(r.page), (pages.get(pageKey(r.page)) ?? 0) + 1);
  return {
    rows: eligible.length, pages: pages.size,
    rowsPerPageDistribution: countBy([...pages.values()].map(String)),
    rowsByPartition: countBy(eligible.map(r => r.page.partition)),
    pagesByPartition: countBy([...new Set(eligible.map(r => pageKey(r.page)))].map(k => eligible.find(r => pageKey(r.page) === k)!.page.partition)),
  };
}

export function buildManifest(census: Census, censusSha256: string, ctrlSha256: string, excluded: ExcludedRow[], eligible: Row[], selected: Selected[]) {
  const norm = makeNorm(eligible);
  return {
    schema: 'budget-request-toc-header-tokenless-positive-discovery-sample-manifest/v0',
    note: 'independent positive discovery sample（GT ではない・prevalence 推定ではない）。candidate 行は機械条件で選んだ raw line で、continuation / title / column heading のいずれも意味しない。選定は PDF・#407 の visual 結果を一切見ず、census.json の機械特徴の feature-space coverage だけで行った。右 text 本文は保存しない（sha256 のみ）',
    sourceCensus: { path: 'tests/fixtures/budget-request-toc-header-tokenless-failure-isolation/2024/census.json', sha256: censusSha256 },
    excludedManifest: { path: 'tests/fixtures/budget-request-toc-header-tokenless-visual-failure-isolation/2024/review-sample-manifest.json', sha256: ctrlSha256, usedFor: 'row identity のみ' },
    selectionProcedure: 'scripts/pipeline-v2/lib/budget-request-toc-header-tokenless-positive-discovery-sample.ts（ヘッダコメント参照）',
    algorithm: {
      eligible: `census mechanical candidate ${census.pages.reduce((a, p) => a + p.candidates.length, 0)} 行 − 除外 ${excluded.length} 行 = ${eligible.length} 行（行単位の除外）`,
      features: FEATURE_NAMES, normalization: 'eligible 全体 min-max、全成分同等の重み、Euclid 距離', noTriggerSentinel: NO_TRIGGER_SENTINEL,
      steps: ['seed = eligible centroid から最遠', `partition 保証 各 ${MIN_PER_PARTITION} 件以上（最小選択数の partition から farthest-first）`, '残り枠は全体 farthest-first', '1 sample / page', 'tie = (localPdfPath, physicalPage, lineIndex) 辞書順'],
      constants: { sampleSize: SAMPLE_SIZE, minPerPartition: MIN_PER_PARTITION, eligibleExpected: ELIGIBLE_EXPECTED },
    },
    eligibleSummary: eligibleSummary(eligible),
    excludedRows: excluded,
    ordering: '(localPdfPath, physicalPage, lineIndex) 辞書順 → PD-01..PD-20',
    samples: selected.map((s, i) => ({
      sampleId: `PD-${String(i + 1).padStart(2, '0')}`,
      localPdfPath: s.page.localPdfPath, physicalPage: s.page.physicalPage, partition: s.page.partition,
      lineIndex: s.cand.lineIndex, charStart: s.cand.charStart,
      triggerContext: { hasTrigger: s.page.triggerCount > 0, pageTriggerCount: s.page.triggerCount, precedingTriggerDistance: s.cand.precedingTriggerDistance, followingTriggerDistance: s.cand.followingTriggerDistance, primary: s.cand.primary, pageKnownFlag: s.page.knownFlag, knownFlagMatch: s.cand.knownFlagMatch },
      attachmentContext: { hasAttachment: s.page.currentFragmentsAttached > 0, currentFragmentsAttached: s.page.currentFragmentsAttached },
      censusFeatures: { edge: s.page.edge, pageState: s.page.pageState, position: s.cand.position, offsetFromE: s.cand.offsetFromE, rightTextChars: s.cand.rightTextChars, rightTextSha256: s.cand.rightTextSha256, leftBlank: s.cand.leftBlank, distanceToHeaderEnd: s.cand.distanceToHeaderEnd, wholeLineTitleInOutput: s.cand.wholeLineTitleInOutput, pageRefTokenless: s.cand.pageRefTokenless, candidatesOnPage: s.page.candidates.length },
      selectionRationale: { rule: s.rule, normalizedFeatures: norm(s).map(x => q(x)) },
    })),
  };
}

export const loadControlManifest = (file: string): { manifest: ControlManifest; sha256: string } => {
  const buf = fs.readFileSync(file);
  return { manifest: JSON.parse(buf.toString('utf8')) as ControlManifest, sha256: sha256Hex(buf) };
};
