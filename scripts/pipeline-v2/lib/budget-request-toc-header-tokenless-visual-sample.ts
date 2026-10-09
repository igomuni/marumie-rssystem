/**
 * Family B header-zone tokenless の visual failure-isolation review sample（12 candidate 行）を決定的に選ぶ analysis-only helper。
 * production path から呼ばない。入力は #406 の committed census.json のみ（PDF・raw-text 本文は選定に使わない）。
 * 12 件は failure-isolation sample であり GT ではない。candidate 行は continuation の母集団を意味しない（機械条件だけでは
 * continuation と header / title / column heading を区別できない）。
 *
 * ---- 選定手順（census を実行・出力を見る前に固定。結果を見て変更しない）----
 * anchors(2)  = census.anchors の H2 / H7。candidate は page 内で lineIndex === anchor.humanLine の行（一意でなければ STOP）
 * eligible    = anchor ページ以外の、candidates が 1 件以上あるページの candidate 行（anchor ページの行は 1 件も controls にしない）
 * stratum     = ページ単位。trig = triggerCount>0 / att = currentFragmentsAttached>0 として
 *               A: trig&&att / B: trig&&!att / C: !trig&&att / D: !trig&&!att
 * 特徴ベクトル = [distanceToHeaderEnd, nearestTrigger, offsetFromE, leftBlank?0:1]
 *               nearestTrigger = min(precedingTriggerDistance, followingTriggerDistance)（null は除外、両方 null なら NO_TRIGGER_SENTINEL）
 *               各成分は eligible 全体の min-max で [0,1] に正規化（range 0 の成分は 0）。距離は Euclid
 * 順序キー     = (localPdfPath, physicalPage, lineIndex) の辞書順。同値 tie は常にこの順で先のものを選ぶ
 * 規則 1（各 stratum A,B,C,D の順に 2 件）:
 *   1 件目 = その stratum の未使用ページの eligible 行のうち、stratum 内 eligible 行の centroid に最も近い行（medoid 的）
 *   2 件目 = 1 件目から最も遠い行（別ページのみ）
 *   stratum の eligible ページが 2 未満なら STOP
 * 規則 2（残り 2 枠）: 未使用ページの eligible 行から、既選択（anchors + 規則 1 の 8 件）への最小距離が最大の行（farthest-first）を 1 件ずつ 2 回。
 *   ただしその時点で controls に含まれない partition があれば、その partition の行だけを候補にする（欠けた partition のうち辞書順で先のもの）
 * 原則 1 control / page（規則 1・2 とも使用済みページの行は除外）。
 * 出力順・sample ID = 順序キー昇順に FB-01..FB-12（ID は stratum・anchor を示唆しない）
 */
import * as fs from 'fs';
import { sha256Hex } from './budget-request-raw-text';

export const NO_TRIGGER_SENTINEL = 20;
export const STRATA = ['A', 'B', 'C', 'D'] as const;
export type Stratum = (typeof STRATA)[number];
export const CONTROLS_PER_STRATUM = 2;
export const EXTRA_CONTROL_SLOTS = 2;

export interface CensusCandidate {
  lineIndex: number; position: number; charStart: number; offsetFromE: number; rightTextChars: number; rightTextSha256: string;
  leftBlank: boolean; distanceToHeaderEnd: number; precedingTriggerDistance: number | null; followingTriggerDistance: number | null;
  wholeLineTitleInOutput: boolean; primary: string; knownFlagMatch: boolean; pageRefTokenless: boolean; otherHeaderTokenless: boolean;
}
export interface CensusPage {
  localPdfPath: string; physicalPage: number; partition: string; pageState: string; edge: number | null;
  triggerCount: number; negativeControlCount: number; knownFlag: boolean; currentFragmentsAttached: number; candidates: CensusCandidate[];
}
export interface CensusAnchor { id: string; localPdfPath: string; physicalPage: number; humanLine: number }
export interface Census { anchors: CensusAnchor[]; pages: CensusPage[] }

export interface Row { page: CensusPage; cand: CensusCandidate; stratum: Stratum }
export interface Selected extends Row { role: 'ANCHOR' | 'CONTROL'; anchorId: string | null; rule: string }

export const pageKey = (p: { localPdfPath: string; physicalPage: number }) => `${p.localPdfPath}#${p.physicalPage}`;
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const rowCmp = (a: Row, b: Row) =>
  cmp(a.page.localPdfPath, b.page.localPdfPath) || a.page.physicalPage - b.page.physicalPage || a.cand.lineIndex - b.cand.lineIndex;

export function strataOf(p: CensusPage): Stratum {
  const trig = p.triggerCount > 0; const att = p.currentFragmentsAttached > 0;
  return trig ? (att ? 'A' : 'B') : (att ? 'C' : 'D');
}
export const rawFeatures = (c: CensusCandidate): number[] => {
  const ds = [c.precedingTriggerDistance, c.followingTriggerDistance].filter((x): x is number => x !== null);
  return [c.distanceToHeaderEnd, ds.length ? Math.min(...ds) : NO_TRIGGER_SENTINEL, c.offsetFromE, c.leftBlank ? 0 : 1];
};

export function eligibleRows(census: Census): Row[] {
  const anchorPages = new Set(census.anchors.map(pageKey));
  return census.pages.filter(p => !anchorPages.has(pageKey(p)) && p.candidates.length > 0)
    .flatMap(p => p.candidates.map(cand => ({ page: p, cand, stratum: strataOf(p) })));
}

/** 特徴ベクトルの正規化器（eligible 全体の min-max） */
export function makeNorm(rows: Row[]): (r: Row) => number[] {
  const raw = rows.map(r => rawFeatures(r.cand));
  const lo = raw[0].map((_, i) => Math.min(...raw.map(v => v[i])));
  const hi = raw[0].map((_, i) => Math.max(...raw.map(v => v[i])));
  return r => rawFeatures(r.cand).map((x, i) => (hi[i] === lo[i] ? 0 : (x - lo[i]) / (hi[i] - lo[i])));
}
const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));

/** 最小の評価値を持つ行（tie は順序キーで先）。maximize 時は評価値を符号反転して使う */
function pick(rows: Row[], score: (r: Row) => number): Row {
  if (!rows.length) throw new Error('STOP: no eligible row');
  return [...rows].sort((a, b) => score(a) - score(b) || rowCmp(a, b))[0];
}
// 浮動小数点の微小差で tie が崩れないよう 1e-12 に丸める
const q = (x: number) => Math.round(x * 1e12) / 1e12;

export function selectSample(census: Census): Selected[] {
  const norm = makeNorm(eligibleRows(census));
  const eligible = eligibleRows(census);
  const anchors: Selected[] = census.anchors.map(a => {
    const page = census.pages.find(p => pageKey(p) === pageKey(a));
    if (!page) throw new Error(`STOP: anchor page missing ${a.id}`);
    const cs = page.candidates.filter(c => c.lineIndex === a.humanLine);
    if (cs.length !== 1) throw new Error(`STOP: anchor ${a.id} candidate not unique`);
    return { page, cand: cs[0], stratum: strataOf(page), role: 'ANCHOR', anchorId: a.id, rule: `census.anchors ${a.id} humanLine=${a.humanLine}` };
  });
  const used = new Set<string>(anchors.map(a => pageKey(a.page)));
  const controls: Selected[] = [];
  const add = (r: Row, rule: string) => { used.add(pageKey(r.page)); controls.push({ ...r, role: 'CONTROL', anchorId: null, rule }); };
  const free = (rs: Row[]) => rs.filter(r => !used.has(pageKey(r.page)));

  for (const s of STRATA) {
    const inS = eligible.filter(r => r.stratum === s);
    if (new Set(inS.map(r => pageKey(r.page))).size < CONTROLS_PER_STRATUM) throw new Error(`STOP: stratum ${s} has < ${CONTROLS_PER_STRATUM} eligible pages`);
    const vecs = inS.map(norm);
    const centroid = vecs[0].map((_, i) => vecs.reduce((a, v) => a + v[i], 0) / vecs.length);
    const first = pick(free(inS), r => q(dist(norm(r), centroid)));
    add(first, `stratum ${s} #1: nearest to stratum centroid (eligible rows=${inS.length})`);
    const second = pick(free(inS), r => -q(dist(norm(r), norm(first))));
    add(second, `stratum ${s} #2: farthest from stratum #1`);
  }
  for (let k = 1; k <= EXTRA_CONTROL_SLOTS; k++) {
    const have = new Set(controls.map(c => c.page.partition));
    const missing = [...new Set(eligible.map(r => r.page.partition))].sort().filter(p => !have.has(p));
    const pool = free(eligible).filter(r => (missing.length ? r.page.partition === missing[0] : true));
    const chosen = [...anchors, ...controls];
    const rule = `extra #${k}: farthest-first from ${chosen.length} selected` + (missing.length ? ` restricted to missing partition ${missing[0]}` : '');
    add(pick(pool, r => -q(Math.min(...chosen.map(c => dist(norm(r), norm(c)))))), rule);
  }
  const out = [...anchors, ...controls].sort(rowCmp);
  if (out.length !== 12 || anchors.length !== 2 || controls.length !== 10) throw new Error('STOP: sample is not 2 anchors + 10 controls');
  return out;
}

export function buildManifest(census: Census, censusSha256: string, selected: Selected[]) {
  const norm = makeNorm(eligibleRows(census));
  const hasNorm = (s: Selected) => (s.role === 'CONTROL' ? norm(s) : null);
  return {
    schema: 'budget-request-toc-header-tokenless-visual-review-sample-manifest/v0',
    note: 'failure-isolation sample（GT ではない）。candidate 行は機械条件で選んだ raw line で、continuation / title / column heading のいずれも意味しない。選定は PDF を一切見ずに census.json の機械特徴だけで行った。右 text 本文は保存しない（sha256 のみ）',
    sourceCensus: { path: 'tests/fixtures/budget-request-toc-header-tokenless-failure-isolation/2024/census.json', sha256: censusSha256 },
    selectionProcedure: 'scripts/pipeline-v2/lib/budget-request-toc-header-tokenless-visual-sample.ts（ヘッダコメント参照）',
    constants: { noTriggerSentinel: NO_TRIGGER_SENTINEL, controlsPerStratum: CONTROLS_PER_STRATUM, extraControlSlots: EXTRA_CONTROL_SLOTS },
    strata: { A: 'trigger あり + current attachment あり', B: 'trigger あり + attachment なし', C: 'trigger なし + attachment あり', D: 'trigger なし + attachment なし' },
    ordering: '(localPdfPath, physicalPage, lineIndex) 辞書順 → FB-01..FB-12',
    samples: selected.map((s, i) => ({
      sampleId: `FB-${String(i + 1).padStart(2, '0')}`,
      localPdfPath: s.page.localPdfPath, physicalPage: s.page.physicalPage, partition: s.page.partition,
      lineIndex: s.cand.lineIndex, charStart: s.cand.charStart,
      stratum: s.stratum, role: s.role, anchorId: s.anchorId,
      triggerContext: { pageTriggerCount: s.page.triggerCount, precedingTriggerDistance: s.cand.precedingTriggerDistance, followingTriggerDistance: s.cand.followingTriggerDistance, primary: s.cand.primary, pageKnownFlag: s.page.knownFlag, knownFlagMatch: s.cand.knownFlagMatch },
      attachmentContext: { currentFragmentsAttached: s.page.currentFragmentsAttached },
      censusFeatures: { edge: s.page.edge, pageState: s.page.pageState, position: s.cand.position, offsetFromE: s.cand.offsetFromE, rightTextChars: s.cand.rightTextChars, rightTextSha256: s.cand.rightTextSha256, leftBlank: s.cand.leftBlank, distanceToHeaderEnd: s.cand.distanceToHeaderEnd, wholeLineTitleInOutput: s.cand.wholeLineTitleInOutput, pageRefTokenless: s.cand.pageRefTokenless, candidatesOnPage: s.page.candidates.length },
      selectionRationale: { rule: s.rule, normalizedFeatures: hasNorm(s) },
    })),
  };
}

export const loadCensus = (file: string): { census: Census; sha256: string } => {
  const buf = fs.readFileSync(file);
  return { census: JSON.parse(buf.toString('utf8')) as Census, sha256: sha256Hex(buf) };
};
