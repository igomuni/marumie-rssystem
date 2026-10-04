import { describe, expect, it } from 'vitest';
import { countCandidates, decideItemCandidate, type ItemCandidateFacts, detectCandidates, referenceX, type CandidateSourceRecord } from './budget-request-item-candidate';

const rec = (row: number, kind: string, code: string, x: number, name: string | null = 'テスト'): CandidateSourceRecord => ({
  anchor: { page: 1, logicalRowIndex: row }, recordKind: kind,
  rowLocal: { code: { status: 'resolved', value: { raw: code }, evidence: { bboxUnion: { xMin: x } } }, name: name === null ? { status: 'ambiguous', reasonCode: 'continuation_ambiguous', value: null } : { status: 'resolved', reasonCode: null, value: { raw: name, normalized: name } } },
});
const reqs = (n: number, x = 65.57) => Array.from({ length: n }, (_, i) => rec(100 + i, 'request', '01-01', x));

describe('referenceX', () => {
  it('request 行の code x の最頻値。件数が足りなければ null', () => {
    expect(referenceX([...reqs(4)])).toEqual({ refX: null, requests: 4 });
    expect(referenceX([...reqs(5), ...reqs(2, 79.37)]).refX).toBe(65.57);
    expect(referenceX([rec(1, 'unclassified', '001', 58.67), ...reqs(5)]).requests).toBe(5);
  });
});

describe('detectCandidates', () => {
  const ref = 65.57;
  it('3 桁の plain code で x が 基準 - 6.9 の ±1.0 内の unclassified 行だけが候補', () => {
    const cs = detectCandidates([
      rec(1, 'unclassified', '001', 58.67), rec(2, 'unclassified', '002', 59.5), rec(3, 'unclassified', '003', 60.0),
      rec(4, 'unclassified', '0012', 58.67), rec(5, 'detail_line', '001', 58.67), rec(6, 'request', '01-01', 58.67), rec(7, 'unclassified', '004', 72.0),
    ], ref);
    expect(cs.map(c => c.code)).toEqual(['001', '002']);
  });
  it('名称が resolved でない候補は ambiguous、同じ code・名称の再掲は duplicate', () => {
    const cs = detectCandidates([rec(1, 'unclassified', '001', 58.67, '甲'), rec(2, 'unclassified', '001', 58.67, '甲'), rec(3, 'unclassified', '002', 58.67, null), rec(4, 'unclassified', '003', 58.67, '乙')], ref);
    expect(countCandidates(cs)).toEqual({ rows: 4, withKey: 3, ambiguous: 1, withinDocumentUnique: 2, duplicateRows: 1 });
  });
  it('名称の空白差は key で吸収する（NFKC + 空白除去。P1 と同じ機械的規則）', () => {
    const cs = detectCandidates([rec(1, 'unclassified', '001', 58.67, '甲 乙'), rec(2, 'unclassified', '001', 58.67, '甲乙')], ref);
    expect(countCandidates(cs).withinDocumentUnique).toBe(1);
  });
});

describe('decideItemCandidate（事前登録の判定規則）', () => {
  const f: ItemCandidateFacts = { developmentConsistent: true, scannablePdfs: 74, unscannablePdfs: 8, hierarchyLessPdfsWithReference: 40, hierarchyLessRows: 500, hierarchyLessUnique: 450, hierarchyLessDuplicates: 20, hierarchyLessAmbiguous: 30, hierarchyLessPublishersWithCandidates: 20, productionItemRecords: 97 };
  it('規則 1〜4 を上から適用する', () => {
    expect(decideItemCandidate(f)).toEqual({ decision: 'ITEM_POPULATION_HIDDEN_BY_HIERARCHY', rule: 4 });
    expect(decideItemCandidate({ ...f, developmentConsistent: false }).decision).toBe('INCONCLUSIVE');
    expect(decideItemCandidate({ ...f, unscannablePdfs: 74 }).decision).toBe('INCONCLUSIVE');
    expect(decideItemCandidate({ ...f, hierarchyLessAmbiguous: 451 }).decision).toBe('ITEM_CANDIDATES_EXIST_BUT_AMBIGUOUS');
    expect(decideItemCandidate({ ...f, hierarchyLessRows: 97 }).decision).toBe('NO_LARGE_HIDDEN_ITEM_POPULATION');
    expect(decideItemCandidate({ ...f, hierarchyLessPublishersWithCandidates: 1 }).decision).toBe('NO_LARGE_HIDDEN_ITEM_POPULATION');
  });
});
