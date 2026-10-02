import { describe, expect, it } from 'vitest';
import { resolveLogicalRows } from './budget-request-logical-row';
import { resolveRegionRelations } from './budget-request-region-relation';
import { codeShapeOf, detectSemanticRecords, type SemanticRecordResult } from './budget-request-semantic-record';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';
import { detectSpatialRegions } from './budget-request-spatial-region';
import { buildTableGeometry } from './budget-request-table-geometry';

const meta = pageMetaFrom(1, 1, [0, 0, 1200, 900], 0);
const styles = { f1: { ascent: 0.859, descent: -0.141 } };
const FS = 6.944;
const PITCH = 14;

function tok(text: string, x: number, baselineTop: number, width = 10): SourceToken {
  const item: RawTextItem = { str: text, transform: [FS, 0, 0, FS, x, 900 - baselineTop], width, height: FS, fontName: 'f1', hasEOL: false, dir: 'ltr' };
  return toSourceToken(item, 0, meta, styles);
}
const index = (ts: SourceToken[]): SourceToken[] => ts.map((t, i) => ({ ...t, index: i }));

/** 金額chunk（右から左のitem順: 末尾chunk → 先頭chunk）を3つのcolumn位置に置く。x順では先頭chunkが左 */
function amountChunks(y: number, colX: number, chunks: string[]): SourceToken[] {
  // chunks はvisual順（左→右）。rawはその逆順で出す（pdf.jsの金額chunk逆順）
  const w = 12;
  return [...chunks].reverse().map((c, k) => tok(c, colX + (chunks.length - 1 - k) * w, y, w));
}
function detailRow(y: number, code: string, matter: string, amounts: string[][], extra: SourceToken[] = []): SourceToken[] {
  const out = [tok(code, 50, y, 24), tok(matter, 90, y, 70)];
  amounts.forEach((chunks, i) => out.push(...amountChunks(y, 250 + i * 80, chunks)));
  return [...out, ...extra];
}

function run(tokensIn: SourceToken[]) {
  const tokens = index(tokensIn);
  const geometry = buildTableGeometry(tokens, meta);
  const logical = resolveLogicalRows(tokens, meta, geometry);
  const spatial = detectSpatialRegions(tokens, geometry, logical);
  const rel = resolveRegionRelations(meta, logical, spatial);
  const sem = detectSemanticRecords(tokens, geometry, logical, spatial, rel);
  return { tokens, geometry, logical, spatial, rel, sem };
}
const rows3 = () => [['42,', '331,', '005'], ['46,', '887,', '829'], ['4,', '556,', '824']];

describe('anchor（detail code候補）: text pattern + geometry evidence', () => {
  it('行頭のコードらしいtoken + 同じsegmentで後続するmatter文字 → detail_record_candidate。evidence/interpretationを分離して保持', () => {
    const { tokens, sem } = run(detailRow(100, '01-95', '経済産業', rows3()));
    expect(sem.semanticRecordCandidates).toHaveLength(1);
    const c = sem.semanticRecordCandidates[0];
    expect(c.observations.code).toMatchObject({ interpretation: 'detail_code_candidate', rawTexts: ['01-95'] });
    expect(tokens[c.observations.code.tokenIndexes[0]].rawText).toBe('01-95');
    expect(c.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'code_pattern', codeShape: 'DD-DD' }), expect.objectContaining({ kind: 'row_position', value: 'first_token_of_row' })]));
    expect(codeShapeOf('95016-2111-02-0000')).toBe('DDDDD-DDDD-DD-DDDD');
  });

  it('text patternだけではanchorにしない: matter文字が続かない行頭コードは候補にならず、regexOnlyとして残る', () => {
    const { sem } = run([tok('01-95', 50, 100, 24), tok('123', 90, 100, 20)]);
    expect(sem.semanticRecordCandidates).toHaveLength(0);
    expect(sem.diagnostics.regexOnlyCodeMatches.map(r => r.rawText)).toContain('01-95');
  });

  it('geometry evidenceが無い（行頭でない）コードらしいtokenは、金額chunkと同形でもanchorにならない', () => {
    const { sem } = run(detailRow(100, '01-95', '経済産業', rows3()));
    const regexOnly = sem.diagnostics.regexOnlyCodeMatches.map(r => r.rawText);
    expect(regexOnly).toEqual(expect.arrayContaining(['005', '829', '824'])); // 金額の末尾chunk（桁だけ見ればコードに見える）
    expect(sem.semanticRecordCandidates).toHaveLength(1);
  });

  it('先頭に単独の数字segmentがあっても、2つ目のsegment先頭のコードをanchorにできる（leading tokenは別evidence）', () => {
    const { sem } = run([tok('186', 20, 100, 10), ...detailRow(100, '01-95', '地方厚生局', rows3())]);
    const c = sem.semanticRecordCandidates[0];
    expect(c.observations.code.rawTexts).toEqual(['01-95']);
    expect(c.evidence).toContainEqual({ kind: 'row_position', value: 'first_token_of_second_segment_after_single_numeric_leading_token' });
  });

  it('1ページに複数のcandidate（1 page = 1 record ではない）', () => {
    const { sem } = run([...detailRow(100, '01-95', '経済産業', rows3()), ...detailRow(100 + 3 * PITCH, '02-0100', '職員俸給', rows3())]);
    expect(sem.semanticRecordCandidates.map(c => c.observations.code.rawTexts[0])).toEqual(['01-95', '02-0100']);
    expect(sem.semanticRecordCandidates.map(c => c.candidateIndex)).toEqual([0, 1]);
  });
});

describe('matter / amount group の観測（canonical valueを作らない）', () => {
  it('matterはtoken参照（tokenIndexes・rawTexts）で保持し、previewTextはnon-authoritative', () => {
    const { tokens, sem } = run(detailRow(100, '01-95', '経済産業', rows3()));
    const m = sem.semanticRecordCandidates[0].observations.matter;
    expect(m.rawTexts).toEqual(['経済産業']);
    expect(m.tokenIndexes.map(i => tokens[i].rawText)).toEqual(m.rawTexts);
    expect(m.previewText).toBe('経済産業');
    expect(sem.parameters.previewTextIsAuthoritative).toBe(false);
  });

  it('複数physical rowにまたがるmatter: 開始位置が揃う継続行のtokenを参照として追加する（文字列joinはpreviewのみ）', () => {
    const { sem } = run([...detailRow(100, '01-95', '経済産業', rows3()), tok('必要な経費', 90, 100 + FS, 50)]);
    const m = sem.semanticRecordCandidates[0].observations.matter;
    expect(m.rawTexts).toEqual(['経済産業', '必要な経費']);
    expect(m.physicalRowIndexes).toEqual([0, 1]);
    expect(m.logicalRowIndexes).toEqual([0]);
  });

  it('金額群: raw order（content stream順）とvisual-x orderを別に保持し、数値へparseしない', () => {
    const { sem } = run(detailRow(100, '01-95', '経済産業', rows3()));
    const g = sem.semanticRecordCandidates[0].amountGroups[0];
    expect(g.rawTexts).toEqual(['005', '331,', '42,']);
    expect(g.tokenIndexes).toEqual([...g.tokenIndexes].sort((a, b) => a - b));
    expect(g.visualTokenIndexes).toEqual([...g.tokenIndexes].reverse()); // x順では 42, → 331, → 005
    expect(g.visualTokenIndexes).not.toEqual(g.tokenIndexes);
    expect(g.previewText).toBe('42,331,005'); // 非authoritativeな表示確認用
    expect(JSON.stringify(g)).not.toMatch(/"(value|amount|number)"/);
  });

  it('金額groupがちょうど3つのときだけ、previous/request/difference を列順の「候補」として付ける', () => {
    const { sem } = run(detailRow(100, '01-95', '経済産業', rows3()));
    const o = sem.semanticRecordCandidates[0].observations;
    expect(o.previousBudget?.interpretation).toBe('previous_budget_candidate_by_column_order');
    expect(o.requestBudget?.interpretation).toBe('request_budget_candidate_by_column_order');
    expect(o.difference?.interpretation).toBe('difference_candidate_by_column_order');
    expect(o.previousBudget!.bbox.xMax).toBeLessThan(o.requestBudget!.bbox.xMin);
  });

  it('差額を計算しない: differenceはtoken参照だけで、request - previous の値を持たない', () => {
    const { sem } = run(detailRow(100, '01-95', '経済産業', rows3()));
    const d = sem.semanticRecordCandidates[0].observations.difference!;
    expect(d.rawTexts).toEqual(['824', '556,', '4,']);
    expect(Object.keys(d).sort()).toEqual(['bbox', 'interpretation', 'previewText', 'rawTexts', 'signObservation', 'tokenIndexes', 'visualTokenIndexes']);
  });

  it('空欄を0にしない: 金額groupが2つしか見えない行は、3つの候補を割り当てず ambiguity にする', () => {
    const { sem } = run(detailRow(100, '01-95', '経済産業', rows3().slice(0, 2)));
    const c = sem.semanticRecordCandidates[0];
    expect(c.amountGroups).toHaveLength(2);
    expect(c.observations.previousBudget).toBeUndefined();
    expect(c.observations.requestBudget).toBeUndefined();
    expect(c.observations.difference).toBeUndefined();
    expect(c.status).toBe('ambiguous');
    expect(c.ambiguities).toContainEqual(expect.objectContaining({ kind: 'amount_group_count_not_3', detail: expect.objectContaining({ groupCount: 2 }) }));
    expect(JSON.stringify(c)).not.toContain('"0"');
  });
});

describe('符号は独立した視覚証拠（推測しない）', () => {
  it('実際の △ tokenが金額groupの直前にあるときだけ signObservation を持つ', () => {
    const withSign = detailRow(100, '02-0200', '扶養手当', rows3(), [tok('△', 399, 100, 5)]); // 3列目(x=410)の直前
    const { sem } = run(withSign);
    const g = sem.semanticRecordCandidates[0].amountGroups;
    expect(g.map(x => x.signObservation?.rawText ?? null)).toEqual([null, null, '△']);
    expect(g[2].signObservation).toMatchObject({ rawText: '△' });
    expect(sem.diagnostics.counts.signObservations).toBe(1);
  });

  it('sign tokenが無ければ signObservation は null。値の大小（request < previous）から符号を推測しない', () => {
    const { sem } = run(detailRow(100, '02-0200', '扶養手当', [['9,', '000'], ['1,', '000'], ['8,', '000']])); // requestがpreviousより小さく見えても
    expect(sem.semanticRecordCandidates[0].amountGroups.every(g => g.signObservation === null)).toBe(true);
    expect(sem.diagnostics.counts.signObservations).toBe(0);
  });

  it('sign tokenが金額groupから離れている場合は距離を gapToGroup として残し、ambiguityにする', () => {
    const { sem } = run(detailRow(100, '02-0200', '扶養手当', rows3(), [tok('△', 372, 100, 5)])); // 2列目の右・3列目(x=410)の手前に離れて置く
    const c = sem.semanticRecordCandidates[0];
    const g = c.amountGroups[2];
    expect(g.signObservation).toMatchObject({ rawText: '△' });
    expect(g.signObservation!.gapToGroup).toBeGreaterThan(sem.parameters.amountChunkGapFactor * 6.944);
    expect(c.ambiguities).toContainEqual(expect.objectContaining({ kind: 'sign_attachment_distance_large' }));
  });
});

describe('membership / proximity の分離・unstable relationを捨てない', () => {
  const build = () => run([...detailRow(100, '01-95', '経済産業', rows3(), [tok('（要求要旨）', 600, 100, 60)]), ...detailRow(100 + PITCH, '02-0100', '職員俸給', rows3())]);

  it('relatedStructuresは membership / proximity / mixed のevidenceKindを別に持ち、relation refsはindexで戻れる', () => {
    const { rel, sem } = build();
    for (const c of sem.semanticRecordCandidates) {
      for (const r of c.relatedStructures) {
        expect(['membership', 'proximity', 'mixed']).toContain(r.evidenceKind);
        for (const i of r.relationIndexes) expect(rel.relations[i]).toBeDefined();
      }
    }
    const d = sem.diagnostics.counts;
    expect(d.membershipEvidence + d.proximityEvidence).toBeGreaterThanOrEqual(sem.semanticRecordCandidates.flatMap(c => c.relatedStructures).length);
  });

  it('stable / unstable relation のrefを別々に保持し、unstableでも捨てずにcandidateをambiguousにする', () => {
    const { sem } = build();
    const all = sem.semanticRecordCandidates.flatMap(c => c.relatedStructures);
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect([...r.stableRelationIndexes, ...r.unstableRelationIndexes].sort((a, b) => a - b)).toEqual([...r.relationIndexes].sort((a, b) => a - b));
      expect(r.status).toBe(r.unstableRelationIndexes.length > 0 ? 'ambiguous' : 'candidate');
    }
    expect(sem.diagnostics.counts.stableRelationRefs + sem.diagnostics.counts.unstableRelationRefs).toBe(all.reduce((n, r) => n + r.relationIndexes.length, 0));
    for (const c of sem.semanticRecordCandidates) {
      if (c.relatedStructures.some(r => r.unstableRelationIndexes.length > 0)) {
        expect(c.status).toBe('ambiguous');
        expect(c.ambiguities.some(a => a.kind === 'related_structure_relation_unstable')).toBe(true);
      }
    }
  });

  it('semantic typeを付けず、nearest winnerも作らない（複数のregionを全て保持）', () => {
    const { sem } = build();
    const json = JSON.stringify(sem.semanticRecordCandidates);
    for (const k of ['request_summary', 'historical_table', 'breakdown_table', 'staffing_table', '"remark"', 'regionType', 'nearest']) expect(json).not.toContain(k);
    expect(Math.max(...sem.semanticRecordCandidates.map(c => c.relatedStructures.length))).toBeGreaterThanOrEqual(1);
  });
});

describe('unassigned・provenance・非破壊・決定性', () => {
  it('anchorに属さない金額らしいtoken群は捨てず、unassignedSemanticObservationsに残す', () => {
    const { sem } = run([...detailRow(100, '01-95', '経済産業', rows3()), ...amountChunks(100 + 4 * PITCH, 250, ['1,', '234'])]);
    expect(sem.unassignedSemanticObservations.some(u => u.kind === 'amount_group_candidate' && u.rawTexts.includes('234'))).toBe(true);
    expect(sem.unassignedSemanticObservations[0]).toHaveProperty('reason');
  });

  it('provenance: すべての観測tokenがSourceToken(rawText/bbox)へ戻れ、rawTextを改変しない', () => {
    const { tokens, sem } = run(detailRow(100, '01-95', '経済産業', rows3(), [tok('△', 399, 100, 5)]));
    const c = sem.semanticRecordCandidates[0];
    for (const o of [c.observations.code, c.observations.matter, ...c.amountGroups]) {
      expect(o.rawTexts).toEqual(o.tokenIndexes.map(i => tokens[i].rawText));
      for (const i of o.tokenIndexes) expect(tokens[i]).toBeDefined();
      expect(o.bbox.xMin).toBe(Math.min(...o.tokenIndexes.map(i => tokens[i].bbox.xMin)));
    }
    expect(tokens.find(t => t.rawText === '△')).toBeDefined();
  });

  it('前段の結果（SourceToken / TableGeometry / LogicalRow / SpatialRegion / RegionRelation）を変更しない', () => {
    const { tokens, geometry, logical, spatial, rel } = run(detailRow(100, '01-95', '経済産業', rows3()));
    const before = JSON.stringify([tokens, geometry, logical, spatial, rel]);
    detectSemanticRecords(tokens, geometry, logical, spatial, rel);
    expect(JSON.stringify([tokens, geometry, logical, spatial, rel])).toBe(before);
  });

  it('rawTextを変えるとsemantic candidateは変わるが、geometry層の結果は変わらない', () => {
    const a = run(detailRow(100, '01-95', '経済産業', rows3()));
    const b = run(detailRow(100, 'あいう', 'zzz', rows3())); // コードも文字も別（幅・位置は同一）
    expect(a.sem.semanticRecordCandidates).toHaveLength(1);
    expect(b.sem.semanticRecordCandidates).toHaveLength(0);
    expect(JSON.stringify([b.geometry, b.logical, b.spatial, b.rel])).toBe(JSON.stringify([a.geometry, a.logical, a.spatial, a.rel]));
  });

  it('決定的', () => {
    const t = detailRow(100, '01-95', '経済産業', rows3());
    const s1: SemanticRecordResult = run(t).sem;
    const s2: SemanticRecordResult = run(t).sem;
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });
});
