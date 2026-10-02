import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HIERARCHY_OPTIONS, observeDocumentHierarchy, type HierarchyPageInput } from './budget-request-document-hierarchy';
import { resolveLogicalRows } from './budget-request-logical-row';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';
import { buildTableGeometry } from './budget-request-table-geometry';

const styles = { f1: { ascent: 0.859, descent: -0.141 } };
const FS = 6.944;
const PITCH = 14;
// 合成の階段（実PDFの値ではない）: 見出しの key token x
const X = { l1: 50, l2: 57, l3: 64, l4: 71 };

type Cell = [text: string, x: number];
/** rows[i] = その行のtoken（[text, x]）。y は行番号×PITCH。 */
function pageOf(number: number, rows: Cell[][]): HierarchyPageInput {
  const meta = pageMetaFrom(number, 99, [0, 0, 842, 595], 0);
  const tokensRaw: SourceToken[] = [];
  rows.forEach((cells, r) => {
    for (const [text, x] of cells) {
      const item: RawTextItem = { str: text, transform: [FS, 0, 0, FS, x, 595 - (40 + r * PITCH)], width: Math.max(8, text.length * 4), height: FS, fontName: 'f1', hasEOL: false, dir: 'ltr' };
      tokensRaw.push(toSourceToken(item, 0, meta, styles));
    }
  });
  const tokens = tokensRaw.map((t, i) => ({ ...t, index: i }));
  const geometry = buildTableGeometry(tokens, meta);
  return { meta, tokens, geometry, logical: resolveLogicalRows(tokens, meta, geometry) };
}
const head = (code: string, x: number, name = '見出し'): Cell[] => [[code, x], [name, x + 20], ['12,', 300], ['345', 312]];
const request = (no: string, code: string, x: number): Cell[] => [[no, 30], [code, x], ['要求名', x + 20], ['1,', 300], ['234', 312]];
const nodeOf = (r: ReturnType<typeof observeDocumentHierarchy>, page: number, row: number) => r.nodes.find(n => n.sourcePage === page && n.sourceRowRefs.logicalRowIndex === row)!;
const edgeOf = (r: ReturnType<typeof observeDocumentHierarchy>, id: string) => r.edges.find(e => e.childNodeId === id)!;

/** 2組織×(項→要求) を2ページにまたがって並べた合成文書。page2 の先頭は親見出しの再掲なし */
function syntheticDoc(): HierarchyPageInput[] {
  return [
    pageOf(1, [head('501', X.l1), head('502', X.l2), request('11', '01-95', X.l3), head('503', X.l4), head('504', X.l2), request('12', '02-95', X.l3)]),
    pageOf(2, [request('13', '03-95', X.l3), head('505', X.l4), head('506', X.l1), head('507', X.l2), request('14', '04-95', X.l3)]),
  ];
}

describe('見出し候補と階段（level）', () => {
  it('形A/Bの行だけが見出し候補になり、levelはxインデント階段の順位になる', () => {
    const r = observeDocumentHierarchy('detail', syntheticDoc());
    expect(r.nodes.map(n => n.rowShape).filter(s => s === 'request_no_then_code')).toHaveLength(4);
    const byLevel = (l: number) => r.nodes.filter(n => n.xIndentEvidence.level === l).length;
    expect([byLevel(1), byLevel(2), byLevel(3), byLevel(4)]).toEqual([2, 3, 4, 2]);
    expect(r.indentClusters.map(c => c.level)).toEqual([1, 2, 3, 4]);
    expect(r.parameters.inputLayers).toEqual(['SourceToken', 'TableGeometry', 'LogicalRow']);
  });
  it('文書順のstackで親候補が決まり、ページをまたぐ親も辿る（親見出しが再掲されないpage2先頭）', () => {
    const r = observeDocumentHierarchy('detail', syntheticDoc());
    const req13 = nodeOf(r, 2, 0);
    const e = edgeOf(r, req13.id);
    expect(e.status).toBe('resolved_by_indent_sequence');
    expect(e.parentNodeId).toBe(nodeOf(r, 1, 4).id); // 直前に開いている level2 の 504
    expect(e.ancestorCandidateNodeIds).toEqual([nodeOf(r, 1, 0).id]);
    const t = e.evidence.find(x => x.kind === 'page_transition')!;
    expect(t.detail).toMatchObject({ parentPage: 1, childPage: 2, parentOnSamePage: false, pagesBetween: 1 });
    // 深い見出し(level4)の後に level2 が来ると popされ、新しい level1 の子になる
    expect(edgeOf(r, nodeOf(r, 2, 3).id).parentNodeId).toBe(nodeOf(r, 2, 2).id);
  });
  it('根（親なし）は unresolved で、parentNodeIdはnull', () => {
    const r = observeDocumentHierarchy('detail', syntheticDoc());
    const root = edgeOf(r, nodeOf(r, 1, 0).id);
    expect(root).toMatchObject({ parentNodeId: null, status: 'unresolved' });
  });
  it('levelが飛ぶ場合は level_gap（ambiguous）で、親は確定扱いにしない', () => {
    const doc = [pageOf(1, [head('501', X.l1), head('502', X.l1), request('11', '01-95', X.l3), request('12', '02-95', X.l3), head('503', X.l2), head('504', X.l2)])];
    const r = observeDocumentHierarchy('detail', doc);
    const e = edgeOf(r, nodeOf(r, 1, 2).id); // level1 の直下に level3
    expect(e.status).toBe('level_gap');
    expect(e.parentNodeId).toBe(nodeOf(r, 1, 1).id);
  });
  it('支持が少ないクラスタ（繰り返さないインデント）は unplaced で、stackに載らない', () => {
    const doc = [pageOf(1, [head('501', X.l1), head('502', X.l1), head('503', X.l2), head('504', X.l2), head('505', 90)])];
    const r = observeDocumentHierarchy('detail', doc);
    const lone = nodeOf(r, 1, 4);
    expect(lone.xIndentEvidence).toMatchObject({ placed: false, level: null });
    expect(r.edges.find(e => e.childNodeId === lone.id)).toBeUndefined();
    expect(r.diagnostics.unplacedCount).toBe(1);
  });
});

describe('負のテスト: 見出し形状を持たない行（過年度表など）は親にならない', () => {
  it('項と要求の間に表の行が挟まっても、要求の親は項のまま（直前行・近傍ではない）', () => {
    const history: Cell[][] = [
      [['３０年度', 330], ['元年度', 380]],
      [['予算額', 330], ['14,', 380], ['365,', 395], ['082', 410]],
      [['│', 331], ['02', 340], ['職員基本給', 360], ['│', 400], ['7,495,871', 420]],
      [['184,', 331], ['434', 345]], // コンマ付きの金額断片: 3桁だけのtokenではない
      [['812', 450], ['人件費', 470]], // 先頭が3桁+後続のtokenは形だけなら候補。ただし繰り返さないxなので unplaced
    ];
    const doc = [pageOf(1, [head('501', X.l1), head('502', X.l2), head('503', X.l2), ...history, request('11', '01-95', X.l3), head('504', X.l1), head('505', X.l2), request('12', '02-95', X.l3)])];
    const r = observeDocumentHierarchy('detail', doc);
    const reqRow = 3 + history.length;
    const e = edgeOf(r, nodeOf(r, 1, reqRow).id);
    expect(e.parentNodeId).toBe(nodeOf(r, 1, 2).id);
    // 挟まった行は階段に載らず（placedにならない）、どのedgeでも親にも子にもならない。
    // （先頭が3桁tokenの行は形だけなら候補になるが、繰り返さないxなので unplaced）
    const historyRows = history.map((_, i) => 3 + i);
    const touching = r.nodes.filter(n => historyRows.includes(n.sourceRowRefs.logicalRowIndex));
    expect(touching.every(n => !n.xIndentEvidence.placed)).toBe(true);
    const touchingIds = new Set(touching.map(n => n.id));
    expect(r.edges.some(x => touchingIds.has(x.childNodeId) || (x.parentNodeId !== null && touchingIds.has(x.parentNodeId)))).toBe(false);
    expect(e.evidence.find(x => x.kind === 'document_order')!.detail.logicalRowsBetween).toBeGreaterThan(0);
  });
});

describe('provenance・決定性・raw保持', () => {
  it('全nodeからSourceToken・PhysicalRow・LogicalRowへ戻れる（rawTextは補正なし）', () => {
    const doc = syntheticDoc();
    const r = observeDocumentHierarchy('detail', doc);
    for (const n of r.nodes) {
      const p = doc.find(x => x.meta.number === n.sourcePage)!;
      const row = p.logical.logicalRowCandidates[n.sourceRowRefs.logicalRowIndex];
      expect(n.sourceRowRefs.physicalRowIndexes).toEqual(row.physicalRowIndexes);
      expect(n.sourceTokenRefs.rowTokenIndexes.every(i => row.rawTokenIndexes.includes(i))).toBe(true);
      const key = p.tokens[n.sourceTokenRefs.keyTokenIndex];
      expect(key.rawText.trim()).toBe(n.rowShape === 'request_no_then_code' ? n.observedCodeParts.code : n.observedCodeParts.code);
      expect(key.bbox.xMin).toBe(n.xIndentEvidence.keyTokenXMin);
      expect(p.geometry.physicalRows.some(pr => pr.rowIndex === n.sourceRowRefs.physicalRowIndexes[0])).toBe(true);
    }
  });
  it('同じ入力から同じ結果になる（ページの与え順にも依存しない）', () => {
    const a = JSON.stringify(observeDocumentHierarchy('detail', syntheticDoc()));
    const b = JSON.stringify(observeDocumentHierarchy('detail', syntheticDoc()));
    const c = JSON.stringify(observeDocumentHierarchy('detail', [...syntheticDoc()].reverse()));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
  it('NN-NN の区切りがU+2011でも形Bとして認識し、rawTextはそのまま保持する', () => {
    const doc = [pageOf(1, [head('501', X.l1), head('502', X.l1), head('503', X.l2), head('504', X.l2), request('11', '01‑95', X.l3), request('12', '02‑95', X.l3)])];
    const r = observeDocumentHierarchy('detail', doc);
    const n = nodeOf(r, 1, 4);
    expect(n.rowShape).toBe('request_no_then_code');
    expect(n.observedCodeParts.code).toBe('01‑95');
  });
  it('頁数列の候補は行内でxMaxが最大の4桁だけのtokenで、観測のみ（金額は解釈しない）', () => {
    const doc = [pageOf(1, [[['501', X.l1], ['名称', 70], ['12,', 300], ['345', 312], ['1547', 600]], [['502', X.l1], ['名称', 70], ['1581', 590], ['要な経費', 80]]])];
    const r = observeDocumentHierarchy('summary', doc, { ...DEFAULT_HIERARCHY_OPTIONS, minClusterSupport: 1 });
    expect(r.nodes.map(n => n.structureEvidence.printedPageRefCandidate)).toEqual(['1547', '1581']);
    expect(r.nodes[0].observedTextParts).toContain('12,');
  });
});

describe('実験境界: GT・凍結層に依存しない（静的確認）', () => {
  const dir = __dirname;
  const sources = ['budget-request-document-hierarchy.ts', '../extract-budget-request-document-hierarchy.ts'].map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
  const importsOf = (src: string) => [...src.matchAll(/from '([^']+)'/g)].map(m => m[1]);

  it('推論層（lib・CLI）はGT・評価モジュール・凍結層をimportしない', () => {
    const forbidden = /(eval|ground-truth|gt-extended|spatial-region|region-relation|semantic-record|record-anchor|page-template|human-observations)/;
    for (const src of sources) for (const imp of importsOf(src)) expect(imp, imp).not.toMatch(forbidden);
    // libは下位3層の型のみ
    expect(importsOf(sources[0]).sort()).toEqual(['./budget-request-logical-row', './budget-request-source-token', './budget-request-table-geometry']);
  });
  it('推論層のソースにGT fixtureへのpathや語がない', () => {
    for (const src of sources) expect(src).not.toMatch(/hierarchy-gt|mhlw-toc|GroundTruth|ground-truth|researchGt/);
  });
  it('holdout isolation: GTのコード値・要求番号・名称を推論層のソースに埋め込んでいない', () => {
    const gt = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../tests/fixtures/budget-request-document-hierarchy/2024/mhlw-toc-hierarchy-gt-extended.json'), 'utf8')) as { nodes: { code: string; requestNo?: string; name: string }[] };
    for (const src of sources) {
      for (const n of gt.nodes) {
        for (const v of [n.code, n.requestNo, n.name]) if (v) expect(src.includes(`'${v}'`) || src.includes(`"${v}"`) || src.includes(v) && v.length > 4, `${v}`).toBe(false);
      }
    }
  });
  it('金額・符号の解釈を持たない（△/▲の推定・差額計算・blank→0）', () => {
    const code = sources[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/[△▲]/);
    expect(code).not.toMatch(/parseInt|parseFloat|Number\(/);
  });
});
