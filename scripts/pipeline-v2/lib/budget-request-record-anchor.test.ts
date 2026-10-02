import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveLogicalRows } from './budget-request-logical-row';
import { assessRecordAnchors, classifyFromEvidence, DEFAULT_RECORD_ANCHOR_OPTIONS } from './budget-request-record-anchor';
import { resolveRegionRelations } from './budget-request-region-relation';
import { detectSemanticRecords, type AmountGroupObservation, type SemanticRecordCandidate, type SemanticRecordResult } from './budget-request-semantic-record';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';
import { detectSpatialRegions } from './budget-request-spatial-region';
import { buildTableGeometry } from './budget-request-table-geometry';

const REF = 6.944;
const page = pageMetaFrom(1, 1, [0, 0, 842, 595], 0); // topBand = 0.15 × 595 = 89.25

const bbox = (x: number, y: number, w = 20) => ({ xMin: x, yMin: y, xMax: x + w, yMax: y + REF });
const obs = (x: number, y: number, w = 20) => ({ tokenIndexes: [0], visualTokenIndexes: [0], rawTexts: [''], bbox: bbox(x, y, w), interpretation: 'x' });
const group = (xMax: number, y: number, sign = false): AmountGroupObservation => ({ ...obs(xMax - 20, y), signObservation: sign ? { tokenIndex: 0, rawText: '△', gapToGroup: 1 } : null });

interface Spec {
  codeX?: number;
  matterX?: number;
  y: number;
  edges?: number[]; // 金額groupの右端
  groups?: number;
  sign?: boolean;
  status?: 'candidate' | 'ambiguous';
}
function cand(i: number, s: Spec): SemanticRecordCandidate {
  const edges = s.edges ?? (s.groups === 3 ? [255, 307, 462] : s.groups ? Array.from({ length: s.groups }, (_, k) => 255 + k * 50) : []);
  return {
    candidateIndex: i,
    anchorLogicalRowIndexes: [i],
    observations: { code: obs(s.codeX ?? 60, s.y), matter: obs(s.matterX ?? 90, s.y, 60) },
    amountGroups: edges.map((e, k) => group(e, s.y, !!s.sign && k === edges.length - 1)),
    relatedStructures: [],
    status: s.status ?? 'candidate',
    evidence: [],
    ambiguities: [],
  } as SemanticRecordCandidate;
}
const semantic = (specs: Spec[]): SemanticRecordResult => ({ semanticRecordCandidates: specs.map((s, i) => cand(i, s)) }) as unknown as SemanticRecordResult;
const assess = (specs: Spec[]) => assessRecordAnchors(page, REF, semantic(specs));
const kinds = (es: { kind: string }[]) => es.map(e => e.kind);

describe('detail evidence', () => {
  it('amount groups: 3つのgroupは detail を支持するevidenceになる（単独では確定しない）', () => {
    const { anchorAssessments: a } = assess([{ y: 200, groups: 3 }]);
    expect(kinds(a[0].detailEvidence)).toContain('three_amount_groups');
    expect(a[0].classification).toBe('ambiguous'); // 3 groupsだけでは detail 確定にしない（種別が1つ）
  });

  it('repeated code alignment: code左端・matter開始が揃う候補はfamilyになり、minFamilySize以上で family_membership がdetailを支持する', () => {
    const { anchorAssessments: a, layoutFamilies } = assess([{ y: 200 }, { y: 214 }, { y: 228 }]);
    expect(layoutFamilies).toHaveLength(1);
    expect(layoutFamilies[0].semanticCandidateIndexes).toEqual([0, 1, 2]);
    expect(kinds(a[0].detailEvidence)).toContain('family_membership');
    expect(a[0].detailEvidence.find(e => e.kind === 'family_membership')?.measurement).toMatchObject({ familySize: 3 });
  });

  it('repeated amount alignment: 金額列の右端が揃う別候補がいると repeated_amount_columns。揃わなければ付かない', () => {
    const yes = assess([{ y: 200, groups: 3 }, { y: 214, groups: 3 }]).anchorAssessments;
    expect(yes[0].detailEvidence.find(e => e.kind === 'repeated_amount_columns')?.measurement).toMatchObject({ alignedOtherCandidates: 1 });
    expect(yes[0].classification).toBe('detail_candidate'); // 3 groups + repeated columns の2種別
    const no = assess([{ y: 200, groups: 3 }, { y: 214, edges: [255, 307, 500] }]).anchorAssessments;
    expect(kinds(no[0].detailEvidence)).not.toContain('repeated_amount_columns');
  });

  it('sign tokenのある金額groupは detail を支持するevidence（sign_token_in_amount_region）', () => {
    const { anchorAssessments: a } = assess([{ y: 200, groups: 3, sign: true }, { y: 214, groups: 3 }]);
    expect(kinds(a[0].detailEvidence)).toContain('sign_token_in_amount_region');
  });

  it('1ページに複数のdetail candidate、複数のlayout family（family数は固定しない）', () => {
    const r = assess([
      { y: 200, codeX: 60, matterX: 90, groups: 3 },
      { y: 214, codeX: 60, matterX: 90, groups: 3 },
      { y: 228, codeX: 130, matterX: 160, groups: 3 },
      { y: 242, codeX: 130, matterX: 160, groups: 3 },
    ]);
    expect(r.anchorAssessments.filter(a => a.classification === 'detail_candidate')).toHaveLength(4);
    expect(r.layoutFamilies).toHaveLength(2);
    expect(r.layoutFamilies.map(f => f.semanticCandidateIndexes)).toEqual([[0, 1], [2, 3]]);
    expect(r.layoutFamilies[0].observations.amountColumnPattern).toMatchObject({ candidatesWithThreeGroups: 2, aligned: true });
  });
});

describe('heading evidence', () => {
  it('page-relative top: ページ高さに対する比でtop帯を判定（yMinFractionとthresholdを記録）', () => {
    const { anchorAssessments: a } = assess([{ y: 20 }, { y: 300 }]);
    const top = a[0].headingEvidence.find(e => e.kind === 'page_relative_top')!;
    expect(top.measurement.yMinFraction).toBeCloseTo(20 / 595, 3);
    expect(top.threshold).toMatchObject({ topFraction: 0.15 });
    expect(kinds(a[1].headingEvidence)).not.toContain('page_relative_top');
  });

  it('isolated layout: 反復するfamilyに属さず金額列も共有しない候補に付く', () => {
    const { anchorAssessments: a } = assess([{ y: 200, codeX: 40 }, { y: 214, codeX: 100 }, { y: 228, codeX: 100 }, { y: 242, codeX: 100 }]);
    expect(kinds(a[0].headingEvidence)).toContain('isolated_layout');
    expect(kinds(a[1].headingEvidence)).not.toContain('isolated_layout');
  });

  it('top + isolated + 金額構造なし が揃うとき heading_candidate（3種類のevidence。候補は除外されない）', () => {
    const r = assess([{ y: 20, codeX: 40 }, { y: 200, groups: 3 }, { y: 214, groups: 3 }]);
    expect(r.anchorAssessments[0].classification).toBe('heading_candidate');
    expect(kinds(r.anchorAssessments[0].headingEvidence)).toEqual(['page_relative_top', 'isolated_layout', 'lacks_field_structure']);
    expect(r.anchorAssessments).toHaveLength(3); // 全候補にassessmentがある（heading候補も残る）
  });

  it('金額が無いだけではheading確定にしない（ページ上端でなければ ambiguous）', () => {
    const { anchorAssessments: a } = assess([{ y: 300 }]);
    expect(kinds(a[0].headingEvidence)).toEqual(expect.arrayContaining(['isolated_layout', 'lacks_field_structure']));
    expect(a[0].classification).toBe('ambiguous');
  });

  it('ページ上端だけでもheading確定にしない（金額構造があり、反復する列に属する）', () => {
    const { anchorAssessments: a } = assess([{ y: 20, groups: 3 }, { y: 34, groups: 3 }]);
    expect(kinds(a[0].headingEvidence)).toContain('page_relative_top');
    expect(a[0].classification).toBe('detail_candidate');
    expect(a[0].conflictingEvidence.map(c => c.severity)).toEqual(['noted']); // 反対側のevidenceはnotedとして記録
  });
});

describe('classifyFromEvidence（evidenceの種類から再計算できる純粋関数）', () => {
  it('detailとheadingの両方がsatisfiedなら blocking conflict で ambiguous', () => {
    const r = classifyFromEvidence(['three_amount_groups', 'family_membership'], ['page_relative_top', 'isolated_layout', 'lacks_field_structure']);
    expect(r.classification).toBe('ambiguous');
    expect(r.conflicts[0].severity).toBe('blocking');
  });
  it('evidenceが何も無ければ insufficient_evidence、片側の一部だけなら ambiguous、揃えばそれぞれ detail / heading', () => {
    expect(classifyFromEvidence([], []).classification).toBe('insufficient_evidence');
    expect(classifyFromEvidence([], ['isolated_layout']).classification).toBe('ambiguous');
    expect(classifyFromEvidence(['three_amount_groups'], []).classification).toBe('ambiguous');
    expect(classifyFromEvidence(['three_amount_groups', 'repeated_amount_columns'], []).classification).toBe('detail_candidate');
    expect(classifyFromEvidence([], ['page_relative_top', 'isolated_layout', 'lacks_field_structure']).classification).toBe('heading_candidate');
  });
  it('scoreを使わない（同じ種別の重複では満たされない）', () => {
    expect(classifyFromEvidence(['three_amount_groups', 'three_amount_groups'], []).classification).toBe('ambiguous');
  });
});

describe('threshold sensitivity と classification stability', () => {
  it('thresholdを0.8×/1.25×に振ってclassificationが変わる候補はstableにしない（SemanticRecordCandidateのstatusとは別）', () => {
    // 上端帯 = 89.25。yMin=100 は 1.25× の帯(111.6)では中に入るので heading evidence が揃い classification が変わる
    const r = assess([{ y: 100, codeX: 40, status: 'candidate' }, { y: 200, groups: 3 }, { y: 214, groups: 3 }]);
    const a = r.anchorAssessments[0];
    expect(a.classification).toBe('ambiguous');
    expect(a.stability).toEqual({ stable: false, reasons: ['classification_changes_at_x1.25'] });
    expect(a.semanticCandidateStatus).toBe('candidate'); // semantic側のstatusはcandidateのまま（別の観測）
    expect(r.diagnostics.sensitivity.find(s => s.scale === 1.25)).toMatchObject({ classificationChanged: 1 });
    expect(r.diagnostics.sensitivity.find(s => s.scale === 0.8)).toMatchObject({ classificationChanged: 0 });
    expect(r.anchorAssessments[1].stability.stable).toBe(true);
  });

  it('familyの変化も数える（位置の揃いtoleranceを振る）', () => {
    // codeXの差 = 2.0pt: tolerance(0.25×6.944=1.736)では別family、1.25×(2.17)では同じfamily
    const r = assess([{ y: 200, codeX: 60 }, { y: 214, codeX: 62 }]);
    expect(r.layoutFamilies).toHaveLength(2);
    expect(r.diagnostics.sensitivity.find(s => s.scale === 1.25)).toMatchObject({ familyChanged: 2, layoutFamilyCount: 1 });
  });

  it('パラメータをparametersに記録し、score・textを使わないことを明示する', () => {
    const { parameters } = assess([{ y: 200 }]);
    expect(parameters).toMatchObject({ ...DEFAULT_RECORD_ANCHOR_OPTIONS, referenceFontSize: REF, pageHeight: 595, scoreUsed: false, textUsed: false });
    expect(parameters.alignmentTolerance).toBe(1.736);
    expect(parameters.topBand).toBe(89.25);
  });
});

describe('非破壊・決定性・literal非依存', () => {
  it('SemanticRecordResultを変更しない（headingでも候補・field observationは残る）', () => {
    const s = semantic([{ y: 20, codeX: 40 }, { y: 200, groups: 3 }, { y: 214, groups: 3 }]);
    const before = JSON.stringify(s);
    const r = assessRecordAnchors(page, REF, s);
    expect(JSON.stringify(s)).toBe(before);
    expect(r.anchorAssessments[0].classification).toBe('heading_candidate');
    expect(s.semanticRecordCandidates).toHaveLength(3);
  });

  it('決定的', () => {
    const s = semantic([{ y: 20 }, { y: 200, groups: 3 }, { y: 214, groups: 3 }, { y: 228, groups: 3 }]);
    expect(JSON.stringify(assessRecordAnchors(page, REF, s))).toBe(JSON.stringify(assessRecordAnchors(page, REF, s)));
  });

  it('resolver本体は文字内容もリテラル（既知の見出し語・ページ番号）も使わない', () => {
    const src = fs.readFileSync(path.join(__dirname, 'budget-request-record-anchor.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
    for (const literal of ['所管', '文（本）', '厚（ハ）', '"27"', "'27'", '884', '1260']) expect(code).not.toContain(literal);
    expect(code).not.toContain('rawText');
  });
});

// ---- 上流のpipeline全体を通したsynthetic test ----
const meta = pageMetaFrom(1, 1, [0, 0, 842, 595], 0);
const styles = { f1: { ascent: 0.859, descent: -0.141 } };
function tok(text: string, x: number, baselineTop: number, width = 10): SourceToken {
  const item: RawTextItem = { str: text, transform: [REF, 0, 0, REF, x, 595 - baselineTop], width, height: REF, fontName: 'f1', hasEOL: false, dir: 'ltr' };
  return toSourceToken(item, 0, meta, styles);
}
function pipeline(headingMatter: string) {
  const ts: SourceToken[] = [tok('27', 40, 60, 14), tok(headingMatter, 70, 60, 60)];
  const amounts = (y: number) => [255.4, 307.2, 462.5].flatMap((xr, k) => [tok(k === 0 ? '12,' : k === 1 ? '34,' : '56,', xr - 22, y, 12), tok('000', xr - 10, y, 10)]);
  [150, 164, 178].forEach((y, k) => ts.push(tok(`0${k}-95`, 52, y, 24), tok('経費項目', 90, y, 50), ...amounts(y)));
  const tokens = ts.map((t, i) => ({ ...t, index: i }));
  const geometry = buildTableGeometry(tokens, meta);
  const logical = resolveLogicalRows(tokens, meta, geometry);
  const spatial = detectSpatialRegions(tokens, geometry, logical);
  const rel = resolveRegionRelations(meta, logical, spatial);
  const sem = detectSemanticRecords(tokens, geometry, logical, spatial, rel);
  return { tokens, geometry, logical, spatial, rel, sem, anchor: assessRecordAnchors(meta, geometry.parameters.rowClustering.referenceFontSize, sem) };
}

describe('上流pipeline全体を通したsynthetic test', () => {
  it('SourceToken〜SemanticRecordの全上流を変更しない', () => {
    const p = pipeline('経済産業省所管');
    const before = JSON.stringify([p.tokens, p.geometry, p.logical, p.spatial, p.rel, p.sem]);
    assessRecordAnchors(meta, p.geometry.parameters.rowClustering.referenceFontSize, p.sem);
    expect(JSON.stringify([p.tokens, p.geometry, p.logical, p.spatial, p.rel, p.sem])).toBe(before);
  });

  it('見出しの語を別の日本語に置換しても、layout由来のevidence・classificationは同じ（literalに依存しない）', () => {
    const a = pipeline('経済産業省所管').anchor;
    const b = pipeline('全く別の見出し語').anchor;
    expect(JSON.stringify(b.anchorAssessments)).toBe(JSON.stringify(a.anchorAssessments));
    expect(JSON.stringify(b.layoutFamilies)).toBe(JSON.stringify(a.layoutFamilies));
    expect(a.anchorAssessments[0].classification).toBe('heading_candidate');
    expect(a.anchorAssessments.slice(1).every(x => x.classification === 'detail_candidate')).toBe(true);
  });
});
