import { describe, expect, it } from 'vitest';
import { buildTableGeometry } from './budget-request-table-geometry';
import { resolveLogicalRows } from './budget-request-logical-row';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';
import type { DocumentHierarchyV2Result } from './budget-request-document-hierarchy-v2';
import { layoutForPage, observeColumnLayout, resolveFields, serializeFieldResolverResult, type FieldResolverPageInput, type FieldResolverResult, type RecordFieldResolution } from './budget-request-field-resolver';

const meta = pageMetaFrom(1, 1, [0, 0, 842, 595], 0);
const styles = { f1: { ascent: 0.859, descent: -0.141 } };
const FS = 6.944;

function tok(text: string, x: number, baselineTop: number, width?: number): SourceToken {
  const item: RawTextItem = { str: text, transform: [FS, 0, 0, FS, x, 595 - baselineTop], width: width ?? text.length * FS, height: FS, fontName: 'f1', hasEOL: false, dir: 'ltr' };
  return toSourceToken(item, 0, meta, styles);
}

/** 列見出し（実PDFと同じ形: 文字ごとのtoken + 「概 算 要 求 額」の1token）。値は合成 */
function header(y = 80): SourceToken[] {
  const g = (chars: string, x0: number, step: number) => [...chars].map((c, i) => tok(c, x0 + i * step, y, 7));
  return [...g('前年度', 207.1, 19), ...g('予算額', 207.1, 19).map(t => ({ ...t, bbox: { ...t.bbox, yMin: t.bbox.yMin + 7, yMax: t.bbox.yMax + 7 } })), tok('概 算 要 求 額', 258.8, y + 7, 45.2), ...g('対前年度', 414.1, 14)];
}
/** 右端揃いの3桁区切り金額を、実PDFと同様に chunk ごとのtoken（content stream は逆順）で置く */
function amount(text: string, rightEdge: number, y: number): SourceToken[] {
  const chunks = text.split(',').map((c, i, a) => (i < a.length - 1 ? `${c},` : c));
  const out: SourceToken[] = [];
  let x = rightEdge;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const w = chunks[i].length * 3.4;
    out.push(tok(chunks[i], x - w, y, w));
    x -= w + 1.5;
  }
  return out;
}
const PREV = 255.4;
const REQ = 307.2;
const DIFF = 462.5;

function pageOf(tokens: SourceToken[], n = 1): FieldResolverPageInput {
  const indexed = tokens.map((t, i) => ({ ...t, index: i, page: n }));
  const geometry = buildTableGeometry(indexed, meta);
  return { meta: { ...meta, number: n }, tokens: indexed, geometry, logical: resolveLogicalRows(indexed, meta, geometry) };
}
const resolve = (tokens: SourceToken[], hierarchy: DocumentHierarchyV2Result | null = null): FieldResolverResult => resolveFields({ pages: [pageOf(tokens)], hierarchy });
const recordByCode = (r: FieldResolverResult, code: string): RecordFieldResolution => {
  const rec = r.records.find(x => x.rowLocal.code.value?.raw === code);
  if (!rec) throw new Error(`record ${code} not found`);
  return rec;
};

/** 見出し + 複数の明細行を持つ合成ページ */
function ledger(rows: SourceToken[][]): SourceToken[] {
  return [...header(), ...rows.flat()];
}
const row = (code: string, name: string, y: number, cells: { prev?: SourceToken[]; req?: SourceToken[]; diff?: SourceToken[] }, extra: SourceToken[] = []): SourceToken[] => [
  tok(code, 128, y, 24),
  tok(name, 160, y, 40),
  ...(cells.prev ?? []),
  ...(cells.req ?? []),
  ...(cells.diff ?? []),
  ...extra,
];

describe('列の観測（見出しtoken。値は借りない）', () => {
  it('見出しtokenから3列とcell領域を観測し、見出しが無ければ観測しない', () => {
    const l = observeColumnLayout(1, header());
    expect(l).not.toBeNull();
    expect(l!.previousBudget[1]).toBeLessThanOrEqual(l!.requestedBudget[0]);
    expect(l!.requestedBudget[1]).toBeLessThanOrEqual(l!.difference[0]);
    expect(observeColumnLayout(1, [tok('x', 10, 10)])).toBeNull();
  });
  it('見出しの無いページは、前方の配置が自ページの右端揃いの帯で裏付けられるときだけ引き継ぐ', () => {
    const own = observeColumnLayout(1, header())!;
    const noBands = pageOf([tok('x', 10, 10)]);
    expect(layoutForPage(2, null, own, noBands.geometry)).toEqual({ layout: null, reason: 'column_layout_not_corroborated_on_page' });
    expect(layoutForPage(2, null, null, noBands.geometry).reason).toBe('column_layout_unobserved');
    const rows = ['100', '200', '300'].flatMap((a, i) => [...amount(a, PREV, 100 + i * 14), ...amount(a, REQ, 100 + i * 14), ...amount(a, DIFF, 100 + i * 14)]);
    const supported = pageOf(rows);
    const carried = layoutForPage(2, null, own, supported.geometry);
    expect(carried.layout?.basis).toBe('carried_forward_header_corroborated_by_page_column_bands');
    expect(carried.layout?.headerPage).toBe(1);
  });
});

describe('row-local の金額・符号（実在するtokenと幾何だけ）', () => {
  it('逆順のchunkをx順に組み立てる。差額は計算しない', () => {
    const r = resolve(ledger([row('02-0200', '例', 120, { prev: amount('218,700', PREV, 120), req: amount('211,955', REQ, 120), diff: amount('6,745', DIFF, 120) })]));
    const rec = recordByCode(r, '02-0200');
    expect(rec.rowLocal.previousBudget.value).toEqual({ magnitudeRaw: '218,700', magnitudeNumeric: 218700, explicitZero: false });
    expect(rec.rowLocal.requestedBudget.value?.magnitudeNumeric).toBe(211955);
    expect(rec.rowLocal.difference.value?.magnitudeRaw).toBe('6,745');
    expect(rec.rowLocal.previousBudgetSign.status).toBe('not_observed');
  });
  it('符号は実在する△tokenが同じ行・同じセルの左にあるときだけ。値の大小からは作らない', () => {
    // 増減額 6,745 は 要求 < 前年 だが、△ tokenが無いので符号は not_observed のまま
    const noSign = recordByCode(resolve(ledger([row('02-0200', '例', 120, { prev: amount('218,700', PREV, 120), req: amount('211,955', REQ, 120), diff: amount('6,745', DIFF, 120) })])), '02-0200');
    expect(noSign.rowLocal.differenceSign).toMatchObject({ status: 'not_observed', value: null });
    const withSign = recordByCode(resolve(ledger([row('02-0200', '例', 120, { prev: amount('218,700', PREV, 120), req: amount('211,955', REQ, 120), diff: [tok('△', 411.5, 120, 4.1), ...amount('6,745', DIFF, 120)] })])), '02-0200');
    expect(withSign.rowLocal.differenceSign).toMatchObject({ status: 'resolved', value: { raw: '△' } });
    expect(withSign.rowLocal.differenceSign.evidence?.sourceTokenRefs).toHaveLength(1);
  });
  it('備考欄の △ は金額の符号にしない（右側は auxiliary として参照だけ）', () => {
    const rec = recordByCode(resolve(ledger([row('003', '例', 120, { prev: amount('10', PREV, 120), req: amount('20', REQ, 120), diff: amount('10', DIFF, 120) }, [tok('定員', 469.3, 120, 14), tok('△27人', 480, 120, 20)])])), '003');
    expect(rec.rowLocal.differenceSign.status).toBe('not_observed');
    expect(rec.rowLocal.requestedBudgetSign.status).toBe('not_observed');
    expect(rec.auxiliaryEvidenceRefs.length).toBeGreaterThan(0);
  });
  it('数字と△が1tokenになっている場合は、文字位置の比例で数字（前年度）と符号（概算要求額）に分ける', () => {
    const rec = recordByCode(resolve(ledger([row('003', '例', 120, { prev: [tok('0 △', 251.9, 120, 8.5)], req: amount('173,380', REQ, 120), diff: [tok('△', 411.5, 120, 4.1), ...amount('173,380', DIFF, 120)] })])), '003');
    expect(rec.rowLocal.previousBudget.value).toMatchObject({ magnitudeRaw: '0', explicitZero: true });
    expect(rec.rowLocal.previousBudgetSign.status).toBe('not_observed');
    expect(rec.rowLocal.requestedBudgetSign).toMatchObject({ status: 'resolved', value: { raw: '△' } });
    expect(rec.rowLocal.requestedBudgetSign.evidence?.geometryNote).toMatch(/split/);
  });
  it('明示的な "0" と空欄を分ける。空欄は 0 にせず、符号は not_applicable', () => {
    const rec = recordByCode(resolve(ledger([row('05-0100', '例', 120, { prev: amount('0', PREV, 120), req: amount('0', REQ, 120) })])), '05-0100');
    expect(rec.rowLocal.previousBudget).toMatchObject({ status: 'resolved', value: { magnitudeNumeric: 0, explicitZero: true } });
    expect(rec.rowLocal.difference).toMatchObject({ status: 'blank', value: null });
    expect(rec.rowLocal.differenceSign.status).toBe('not_applicable');
    expect(rec.rowLocal.difference.evidence?.sourceTokenRefs).toEqual([]);
    expect(rec.rowLocal.difference.evidence?.cellBand?.column).toBe('difference');
  });
  it('右側の数値（備考・補助表）や列の間のtokenは金額の根拠にしない: 前年度が空欄で右側に177', () => {
    const rec = recordByCode(resolve(ledger([row('60062-2123-09-1010', '庁費', 120, { req: amount('177', REQ, 120), diff: amount('177', DIFF, 120) }, amount('177', 482, 120))])), '60062-2123-09-1010');
    expect(rec.rowLocal.previousBudget.status).toBe('blank');
    expect(rec.rowLocal.requestedBudget.value?.magnitudeNumeric).toBe(177);
    expect(rec.auxiliaryEvidenceRefs.some(a => a.class === 'inline_label_number')).toBe(true);
    for (const f of [rec.rowLocal.previousBudget, rec.rowLocal.requestedBudget, rec.rowLocal.difference]) {
      expect(f.evidence?.bboxUnion.xMax ?? 0).toBeLessThanOrEqual(470);
    }
  });
  it('セルに数字以外のtokenがあれば確定しない', () => {
    const rec = recordByCode(resolve(ledger([row('003', '例', 120, { prev: [tok('皆増', 235, 120, 14)], req: amount('20', REQ, 120), diff: amount('20', DIFF, 120) })])), '003');
    expect(rec.rowLocal.previousBudget).toMatchObject({ status: 'unresolved', reasonCode: 'non_numeric_token_in_cell', value: null });
  });
  it('列の観測が無いページでは金額・名前を確定しない', () => {
    const rec = recordByCode(resolve([...row('003', '例', 120, { prev: amount('10', PREV, 120) })]), '003');
    expect(rec.rowLocal.previousBudget).toMatchObject({ status: 'unresolved', reasonCode: 'column_layout_unobserved' });
    expect(rec.rowLocal.name.status).toBe('unresolved');
    expect(rec.rowLocal.code.status).toBe('resolved');
  });
  it('code と name は同じ logical row から。名前の文字間空白は除くが、他の補正（NFKC等）はしない', () => {
    const rec = recordByCode(resolve(ledger([row('02-0200', '扶 養 手 当', 120, { prev: amount('1', PREV, 120), req: amount('1', REQ, 120), diff: amount('0', DIFF, 120) })])), '02-0200');
    expect(rec.rowLocal.name.value?.normalized).toBe('扶養手当');
    expect(rec.rowLocal.name.value?.raw).toBe('扶 養 手 当');
    const full = recordByCode(resolve(ledger([row('03-0200', 'ＳＤＧｓ', 120, { prev: amount('1', PREV, 120), req: amount('1', REQ, 120), diff: amount('0', DIFF, 120) })])), '03-0200');
    expect(full.rowLocal.name.value?.normalized).toBe('ＳＤＧｓ');
  });
  it('単位表記: 台帳の見出し領域にあるときだけ resolved。本体の途中にあれば auxiliary 扱いで not_observed', () => {
    const inHeader = resolve([...header(), tok('(単位:千円)', 752, 69, 38), ...row('02-0200', '例', 120, { prev: amount('1', PREV, 120), req: amount('1', REQ, 120), diff: amount('0', DIFF, 120) })]);
    expect(recordByCode(inHeader, '02-0200').pageUnitLabel).toMatchObject({ status: 'resolved', value: { raw: '(単位:千円)' } });
    const inBody = resolve(ledger([row('02-0200', '例', 120, { prev: amount('1', PREV, 120), req: amount('1', REQ, 120), diff: amount('0', DIFF, 120) }), [tok('（単位：千円）', 684, 300, 48)]]));
    expect(recordByCode(inBody, '02-0200').pageUnitLabel).toMatchObject({ status: 'not_observed', value: null });
    const none = resolve(ledger([row('02-0200', '例', 120, { prev: amount('1', PREV, 120), req: amount('1', REQ, 120), diff: amount('0', DIFF, 120) })]));
    expect(recordByCode(none, '02-0200').pageUnitLabel).toMatchObject({ status: 'not_observed' });
  });
});

describe('provenance / 状態モデル / 決定性', () => {
  const r = resolve(ledger([
    row('02-0200', '例', 120, { prev: amount('218,700', PREV, 120), req: amount('211,955', REQ, 120), diff: [tok('△', 411.5, 120, 4.1), ...amount('6,745', DIFF, 120)] }),
    row('003', '空欄の行', 140, {}),
  ]));
  const fields = (rec: RecordFieldResolution) => Object.values(rec.rowLocal);
  it('resolved / blank は evidence を持ち、それ以外は value が null', () => {
    for (const rec of r.records) {
      for (const f of fields(rec)) {
        if (f.status === 'resolved') {
          expect(f.value).not.toBeNull();
          expect(f.evidence?.sourceTokenRefs.length).toBeGreaterThan(0);
          expect(f.evidence?.rawText).not.toBe('');
          expect(f.evidence?.sourceRowRefs.length).toBeGreaterThan(0);
        } else {
          expect(f.value).toBeNull();
          expect(f.reasonCode).not.toBeNull();
        }
        if (f.status === 'blank') {
          expect(f.evidence?.sourceTokenRefs).toEqual([]);
          expect(f.evidence?.cellBand).toBeDefined();
        }
      }
    }
  });
  it('差額・符号・単位変換を作らない: 出力は表示された文字列だけ', () => {
    const rec = recordByCode(r, '02-0200');
    expect(rec.rowLocal.difference.value?.magnitudeNumeric).toBe(6745);
    // 差額は表示された値のまま（前年度・要求額から計算した値は出力のどこにも現れない）
    expect(JSON.stringify(rec)).not.toContain('6745.0');
    expect(Object.keys(rec.rowLocal.difference.value ?? {}).sort()).toEqual(['explicitZero', 'magnitudeNumeric', 'magnitudeRaw']);
  });
  it('serialize は決定的で、時刻・絶対パスを含まない', () => {
    const a = serializeFieldResolverResult(r);
    const b = serializeFieldResolverResult(resolve(ledger([
      row('02-0200', '例', 120, { prev: amount('218,700', PREV, 120), req: amount('211,955', REQ, 120), diff: [tok('△', 411.5, 120, 4.1), ...amount('6,745', DIFF, 120)] }),
      row('003', '空欄の行', 140, {}),
    ])));
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T|\/Users\//);
    expect(a.endsWith('\n')).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------
// hierarchy 依存 field（Contract §9）。合成の hierarchy 観測結果を消費するだけで、親を推論しない
// ------------------------------------------------------------------------------------------------
type NodeSpec = { id: string; code: string; shape?: 'code3_then_text' | 'request_no_then_code'; row: number; kinds?: string[] };
function hierarchyOf(nodes: NodeSpec[], edges: { child: string; parent: string | null; status: string }[]): DocumentHierarchyV2Result {
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      sourcePage: 1,
      rowShape: n.shape ?? 'code3_then_text',
      sourceRowRefs: { logicalRowIndex: n.row, physicalRowIndexes: [n.row] },
      sourceTokenRefs: { keyTokenIndex: 0, rowTokenIndexes: [0] },
      observedCodeParts: { code: n.code },
      xIndentEvidence: { keyTokenXMin: 0, clusterIndex: 0, level: 1, placed: true },
      hierarchyResolutionContext: { headerCollisionObserved: !!n.kinds?.length, headerCandidateExcluded: false, observedEvidenceKinds: n.kinds ?? [], exclusionEvidence: [] },
    })),
    edges: edges.map(e => ({ childNodeId: e.child, parentNodeId: e.parent, status: e.status, evidence: [], ancestorCandidateNodeIds: [] })),
  } as unknown as DocumentHierarchyV2Result;
}
/** 組織(010) / 項(010) / 事項(01-95) の3行ページ。logical row は上から 0,1,2 になる */
function threeLevelPage(): SourceToken[] {
  const cells = (y: number) => ({ prev: amount('100', PREV, y), req: amount('200', REQ, y), diff: amount('100', DIFF, y) });
  return ledger([
    row('010', '組織', 120, cells(120)),
    row('020', '項', 140, {}),
    [tok('1', 40, 160, 5), tok('01-95', 66, 160, 18), tok('事項', 90, 160, 20), ...amount('100', PREV, 160), ...amount('200', REQ, 160), ...amount('100', DIFF, 160)],
  ]);
}
function logicalIndexOf(code: string): number {
  const p = pageOf(threeLevelPage());
  const idx = p.logical.logicalRowCandidates.findIndex(c => c.rawTokenIndexes.some(i => p.tokens[i].rawText === code));
  if (idx < 0) throw new Error(code);
  return idx;
}
describe('hierarchy 依存 field（Safe な edge だけ。risky / unresolved / level_gap は親を断定しない）', () => {
  const o = logicalIndexOf('010');
  const i = logicalIndexOf('020');
  const q = logicalIndexOf('01-95');
  const nodes: NodeSpec[] = [{ id: 'org', code: '010', row: o }, { id: 'item', code: '020', row: i }, { id: 'req', code: '01-95', shape: 'request_no_then_code', row: q }];
  const edges = (s: Record<string, string> = {}) => [
    { child: 'org', parent: null, status: 'unresolved' },
    { child: 'item', parent: 'org', status: s.item ?? 'resolved_by_indent_sequence' },
    { child: 'req', parent: 'item', status: s.req ?? 'resolved_by_indent_sequence' },
  ];
  it('Safe: request は 2 hop とも Safe のときだけ organization まで確定、organization root は not_applicable', () => {
    const r = resolve(threeLevelPage(), hierarchyOf(nodes, edges()));
    const req = recordByCode(r, '01-95');
    expect(req.hierarchyDependent.parentItemAssociation).toMatchObject({ status: 'resolved', value: { parentNodeRef: 'item' } });
    expect(req.hierarchyDependent.parentOrganizationAssociation).toMatchObject({ status: 'resolved', value: { parentNodeRef: 'org' } });
    expect(recordByCode(r, '010').recordKind).toBe('organization');
    expect(recordByCode(r, '010').hierarchyDependent.parentOrganizationAssociation.status).toBe('not_applicable');
    expect(recordByCode(r, '020').recordKind).toBe('item');
    expect(recordByCode(r, '020').hierarchyDependent.parentOrganizationAssociation).toMatchObject({ status: 'resolved', value: { parentNodeRef: 'org' } });
  });
  it('level_gap / unresolved の edge は親を断定しない（2 hop 目が Safe でも 1 hop 目が不可なら organization も確定しない）', () => {
    const gap = recordByCode(resolve(threeLevelPage(), hierarchyOf(nodes, edges({ req: 'level_gap' }))), '01-95');
    expect(gap.hierarchyDependent.parentItemAssociation).toMatchObject({ status: 'unresolved', reasonCode: 'edge_level_gap', value: null });
    expect(gap.hierarchyDependent.parentOrganizationAssociation.status).toBe('unresolved');
    const midGap = recordByCode(resolve(threeLevelPage(), hierarchyOf(nodes, edges({ item: 'level_gap' }))), '01-95');
    expect(midGap.hierarchyDependent.parentItemAssociation.status).toBe('resolved');
    expect(midGap.hierarchyDependent.parentOrganizationAssociation).toMatchObject({ status: 'unresolved', value: null });
  });
  it('resolved でも強い header-collision evidence（2種以上かつ page_edge_row を含む）があれば abstain。1種や page_edge_row 無しは Safe のまま', () => {
    const strong: NodeSpec[] = nodes.map(n => (n.id === 'item' ? { ...n, kinds: ['page_edge_row', 'vertical_repetition'] } : n));
    const r1 = recordByCode(resolve(threeLevelPage(), hierarchyOf(strong, edges())), '01-95');
    expect(r1.hierarchyDependent.parentItemAssociation).toMatchObject({ status: 'unresolved', reasonCode: 'header_collision_strong_on_parent' });
    expect(r1.hierarchyDependent.parentOrganizationAssociation.status).toBe('unresolved');
    const weak: NodeSpec[] = nodes.map(n => (n.id === 'item' ? { ...n, kinds: ['vertical_repetition', 'page_number_sequence'] } : n));
    expect(recordByCode(resolve(threeLevelPage(), hierarchyOf(weak, edges())), '01-95').hierarchyDependent.parentItemAssociation.status).toBe('resolved');
    const single: NodeSpec[] = nodes.map(n => (n.id === 'item' ? { ...n, kinds: ['page_edge_row'] } : n));
    expect(recordByCode(resolve(threeLevelPage(), hierarchyOf(single, edges())), '01-95').hierarchyDependent.parentItemAssociation.status).toBe('resolved');
  });
  it('request の下の3桁コード行は明細行として扱い、親を主張しない。hierarchy が無ければ not_observed', () => {
    const detail = hierarchyOf([...nodes, { id: 'sub', code: '001', row: 1 }], [...edges(), { child: 'sub', parent: 'req', status: 'resolved_by_indent_sequence' }]);
    const page = pageOf(threeLevelPage());
    const rowIdx = page.logical.logicalRowCandidates.findIndex(c => c.rawTokenIndexes.some(k => page.tokens[k].rawText === '020'));
    const h2 = { ...detail, nodes: detail.nodes.map(n => (n.id === 'sub' ? { ...n, sourceRowRefs: { logicalRowIndex: rowIdx, physicalRowIndexes: [rowIdx] } } : n.id === 'item' ? { ...n, sourceRowRefs: { logicalRowIndex: 99, physicalRowIndexes: [99] } } : n)) } as DocumentHierarchyV2Result;
    const sub = recordByCode(resolve(threeLevelPage(), h2), '020');
    expect(sub.recordKind).toBe('detail_line');
    expect(sub.hierarchyDependent.parentOrganizationAssociation.status).toBe('not_applicable');
    expect(recordByCode(resolve(threeLevelPage(), null), '01-95').hierarchyDependent.parentItemAssociation).toMatchObject({ status: 'not_observed', reasonCode: 'hierarchy_artifact_not_available' });
  });
});
