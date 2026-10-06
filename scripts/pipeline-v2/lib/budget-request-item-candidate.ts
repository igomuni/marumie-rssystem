/**
 * item-shaped row candidate detector（PDF 項候補数の population diagnostic）。semantic な項の検出器ではない。
 * 入力は hierarchy=null で得られる FieldResolver の row-local 出力（SourceToken → TableGeometry → LogicalRow → 行頭 token の code 観測）だけ。DocumentHierarchy・MOF・金額は使わない。
 * 規則（事前登録）: 同一 PDF の request 行（行頭の request 番号 + code。hierarchy 非依存の row-local 観測）の code token の x の最頻値を基準 refX とし、
 * 3 桁の plain code（recordKind=unclassified かつ /^\d{3}$/）で code token の x が refX - ITEM_INDENT_STEP の ±ITEM_X_TOLERANCE 内にある行を候補とする。
 */
import { normalizeKey } from './budget-request-mof-reconciliation';

/** 項の code は request の code より 1 インデント（6.9pt）左にある。development の 8 PDF（一般会計 65.57 vs 58.67、特別会計 79.37 vs 72.47）から固定した定数 */
export const ITEM_INDENT_STEP = 6.9;
export const ITEM_X_TOLERANCE = 1.0;
/** 基準 x を決めるのに必要な request 行の最小件数 */
export const MIN_REFERENCE_REQUESTS = 5;
const RE_ITEM_CODE = /^\d{3}$/;

export interface CandidateSourceRecord {
  anchor: { page: number; logicalRowIndex: number };
  recordKind: string;
  rowLocal: {
    code: { status: string; value: { raw: string } | null; evidence: { bboxUnion: { xMin: number } } | null };
    name: { status: string; reasonCode: string | null; value: { raw: string; normalized: string } | null };
  };
}

const codeX = (r: CandidateSourceRecord) => (r.rowLocal.code.status === 'resolved' ? r.rowLocal.code.evidence?.bboxUnion.xMin ?? null : null);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** request 行（recordKind=request）の code x（0.01pt に丸めた値）の最頻値。同数なら小さい x。request が MIN_REFERENCE_REQUESTS 未満なら null */
export function referenceX(records: CandidateSourceRecord[]): { refX: number | null; requests: number } {
  const counts = new Map<number, number>();
  let requests = 0;
  for (const r of records) {
    if (r.recordKind !== 'request') continue;
    const x = codeX(r);
    if (x === null) continue;
    requests++;
    counts.set(round2(x), (counts.get(round2(x)) ?? 0) + 1);
  }
  if (requests < MIN_REFERENCE_REQUESTS) return { refX: null, requests };
  let best: [number, number] | null = null;
  for (const [x, n] of counts) if (!best || n > best[1] || (n === best[1] && x < best[0])) best = [x, n];
  return { refX: best![0], requests };
}

export interface ItemCandidate {
  anchor: { page: number; logicalRowIndex: number };
  code: string;
  codeX: number;
  nameStatus: string;
  nameReason: string | null;
  nameRaw: string | null;
  nameNormalized: string | null;
  /** 名称が resolved のときだけ key を持つ。無い候補は ambiguous（unique 集計に入れない） */
  key: string | null;
}

export function detectCandidates(records: CandidateSourceRecord[], refX: number): ItemCandidate[] {
  const out: ItemCandidate[] = [];
  const target = refX - ITEM_INDENT_STEP;
  for (const r of records) {
    if (r.recordKind !== 'unclassified') continue;
    const code = r.rowLocal.code.value?.raw;
    const x = codeX(r);
    if (!code || x === null || !RE_ITEM_CODE.test(code) || Math.abs(x - target) > ITEM_X_TOLERANCE) continue;
    const name = r.rowLocal.name.status === 'resolved' ? r.rowLocal.name.value : null;
    const normalized = name ? normalizeKey(name.raw) : null;
    out.push({
      anchor: r.anchor, code, codeX: round2(x), nameStatus: r.rowLocal.name.status, nameReason: r.rowLocal.name.reasonCode,
      nameRaw: name?.raw ?? null, nameNormalized: normalized, key: normalized ? `${code}|${normalized}` : null,
    });
  }
  return out;
}

export interface CandidateCounts { rows: number; withKey: number; ambiguous: number; withinDocumentUnique: number; duplicateRows: number }

/** 1 PDF 内の集計。duplicate = key を持つ行のうち、同一 key の 2 件目以降。ambiguous = 名称が resolved でない行（key なし） */
export function countCandidates(cs: ItemCandidate[]): CandidateCounts {
  const keys = new Set(cs.filter(c => c.key).map(c => c.key as string));
  const withKey = cs.filter(c => c.key).length;
  return { rows: cs.length, withKey, ambiguous: cs.length - withKey, withinDocumentUnique: keys.size, duplicateRows: withKey - keys.size };
}

export type ItemCandidateDecision = 'ITEM_POPULATION_HIDDEN_BY_HIERARCHY' | 'ITEM_CANDIDATES_EXIST_BUT_AMBIGUOUS' | 'NO_LARGE_HIDDEN_ITEM_POPULATION' | 'INCONCLUSIVE';
export interface ItemCandidateFacts {
  developmentConsistent: boolean; scannablePdfs: number; unscannablePdfs: number; hierarchyLessPdfsWithReference: number;
  hierarchyLessRows: number; hierarchyLessUnique: number; hierarchyLessDuplicates: number; hierarchyLessAmbiguous: number; hierarchyLessPublishersWithCandidates: number; productionItemRecords: number;
}

/** 事前登録の判定規則（上から順）。件数同士の比較のみで、割合の閾値は置かない。結果を見た後に条件を足さない */
export function decideItemCandidate(f: ItemCandidateFacts): { decision: ItemCandidateDecision; rule: number } {
  if (!f.developmentConsistent || f.hierarchyLessPdfsWithReference === 0 || f.unscannablePdfs >= f.scannablePdfs) return { decision: 'INCONCLUSIVE', rule: 1 };
  if (f.hierarchyLessAmbiguous > f.hierarchyLessUnique || f.hierarchyLessDuplicates > f.hierarchyLessUnique) return { decision: 'ITEM_CANDIDATES_EXIST_BUT_AMBIGUOUS', rule: 2 };
  if (f.hierarchyLessRows <= f.productionItemRecords || f.hierarchyLessPublishersWithCandidates < 2) return { decision: 'NO_LARGE_HIDDEN_ITEM_POPULATION', rule: 3 };
  return { decision: 'ITEM_POPULATION_HIDDEN_BY_HIERARCHY', rule: 4 };
}
