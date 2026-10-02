import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { observeDocumentHierarchy, type HierarchyPageInput } from './budget-request-document-hierarchy';
import { observeDocumentHierarchyV2, V1_EQUIVALENT_OPTIONS, type DocumentHierarchyV2Result, type HierarchyV2ExperimentalOptions } from './budget-request-document-hierarchy-v2';
import { listExtractionTargets } from './budget-request-extraction';
import { resolveLogicalRows } from './budget-request-logical-row';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { extractPageTokens } from './budget-request-pdf-page';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';
import { buildTableGeometry } from './budget-request-table-geometry';

const styles = { f1: { ascent: 0.859, descent: -0.141 } };
const FS = 6.944;
const PITCH = 14;
const X = { hdr: 37.98, l1: 50, l2: 57, l3: 64, l4: 71 }; // 合成の階段（実PDFの値ではない）

type Cell = [text: string, x: number];
function pageOf(number: number, rows: Cell[][]): HierarchyPageInput {
  const meta = pageMetaFrom(number, 999, [0, 0, 842, 595], 0);
  const raw: SourceToken[] = [];
  rows.forEach((cells, r) => {
    for (const [text, x] of cells) {
      const item: RawTextItem = { str: text, transform: [FS, 0, 0, FS, x, 595 - (20 + r * PITCH)], width: Math.max(8, text.length * 4), height: FS, fontName: 'f1', hasEOL: false, dir: 'ltr' };
      raw.push(toSourceToken(item, 0, meta, styles));
    }
  });
  const tokens = raw.map((t, i) => ({ ...t, index: i }));
  const geometry = buildTableGeometry(tokens, meta);
  return { meta, tokens, geometry, logical: resolveLogicalRows(tokens, meta, geometry) };
}
const amt: Cell[] = [['12,', 300], ['345', 312]];
const head = (code: string, x: number, name = '見出し'): Cell[] => [[code, x], [name, x + 20], ...amt];
const request = (no: string, code: string, x: number): Cell[] => [[no, 30], [code, x], ['要求名', x + 20], ...amt];
/** ページ番号ヘッダ: 偶数頁は左に「頁番号（3桁）+略称」、奇数頁は右に「略称+頁番号」。印字頁=物理+1。 */
const headerRow = (page: number): Cell[] => (page % 2 === 0 ? [[String(page + 1), X.hdr], ['略称', 55]] : [['略称', 700], [String(page + 1), 740]]);
const footerRow: Cell[] = [['2023/09/07 11:05:57', 700]];
const withFrame = (page: number, body: Cell[][]): Cell[][] => [headerRow(page), ...body, footerRow];

/** 4頁・2組織の合成文書（偶数頁ヘッダが3桁の頁番号で見出し形状に一致する） */
function headerDoc(): HierarchyPageInput[] {
  return [
    pageOf(100, withFrame(100, [head('501', X.l1), head('502', X.l2), request('11', '01-95', X.l3), head('503', X.l4)])),
    pageOf(101, withFrame(101, [head('504', X.l2), request('12', '02-95', X.l3), head('505', X.l4)])),
    pageOf(102, withFrame(102, [head('506', X.l1), head('507', X.l2), request('13', '03-95', X.l3), head('508', X.l4)])),
    pageOf(103, withFrame(103, [request('14', '04-95', X.l3), head('509', X.l4)])),
  ];
}
/** 組織が1つだけ（根のクラスタの支持が1）。ヘッダなし */
function singleRootDoc(withHeader = false): HierarchyPageInput[] {
  const fr = (n: number, b: Cell[][]) => (withHeader ? withFrame(n, b) : b);
  return [
    pageOf(100, fr(100, [head('501', X.l1), head('502', X.l2), request('11', '01-95', X.l3), head('503', X.l4), head('504', X.l4)])),
    pageOf(101, fr(101, [head('505', X.l2), request('12', '02-95', X.l3), head('506', X.l4), head('507', X.l4)])),
    pageOf(102, fr(102, [request('13', '03-95', X.l3), head('508', X.l4), head('509', X.l4)])),
    pageOf(103, fr(103, [head('510', X.l2), request('14', '04-95', X.l3), head('511', X.l4)])),
  ];
}
const O = (a: 'off' | 'observational-filter', b: 'off' | 'lattice-supported'): HierarchyV2ExperimentalOptions => ({ headerCollisionHandling: a, singletonRootPlacement: b });
const run = (doc: HierarchyPageInput[], a: 'off' | 'observational-filter', b: 'off' | 'lattice-supported'): DocumentHierarchyV2Result => observeDocumentHierarchyV2('detail', doc, O(a, b));
const nodeAt = (r: DocumentHierarchyV2Result, page: number, code: string) => r.nodes.find(n => n.sourcePage === page && n.observedCodeParts.code === code)!;
const levelOf = (r: DocumentHierarchyV2Result, page: number, code: string) => nodeAt(r, page, code).xIndentEvidence.level;

describe('off/off は v1 と同値', () => {
  it('合成文書で、nodes・edges・indentClusters（level/xMin/memberCount）が v1 と一致する', () => {
    for (const doc of [headerDoc(), singleRootDoc(), singleRootDoc(true)]) {
      const v1 = observeDocumentHierarchy('detail', doc);
      const v2 = observeDocumentHierarchyV2('detail', doc, V1_EQUIVALENT_OPTIONS);
      const proj = (n: { id: string; xIndentEvidence: unknown; rowShape: string; observedCodeParts: unknown }) => [n.id, n.rowShape, n.observedCodeParts, n.xIndentEvidence];
      expect(v2.nodes.map(proj)).toEqual(v1.nodes.map(proj));
      expect(v2.edges).toEqual(v1.edges);
      expect(v2.indentClusters.map(c => [c.xMin, c.xMax, c.memberCount, c.level])).toEqual(v1.indentClusters.map(c => [c.xMin, c.xMax, c.memberCount, c.level]));
      expect(v2.diagnostics.excludedCount).toBe(0);
    }
  });
});

describe('A: header collision（observational-filter）', () => {
  it('v1 では3桁の頁番号ヘッダが偽の根レベルを作る（再現）', () => {
    const v1 = observeDocumentHierarchy('detail', headerDoc());
    const lvl1 = v1.nodes.filter(n => n.xIndentEvidence.level === 1);
    expect(lvl1.map(n => n.observedCodeParts.code).sort()).toEqual(['101', '103']);
    expect(v1.nodes.find(n => n.observedCodeParts.code === '501')!.xIndentEvidence.level).toBe(2);
  });
  it('v2-A: ヘッダ行は hierarchy placement から外れ、理由（2種以上のevidence）が残り、主階段が本来のlevelに戻る', () => {
    const r = run(headerDoc(), 'observational-filter', 'off');
    const hdr = r.nodes.filter(n => n.hierarchyEligibility === 'excluded');
    expect(hdr.map(n => n.observedCodeParts.code).sort()).toEqual(['101', '103']);
    for (const n of hdr) {
      expect(n.exclusionEvidence.length).toBeGreaterThanOrEqual(2);
      expect(n.exclusionEvidence.map(e => e.kind)).toEqual(expect.arrayContaining(['page_edge_row', 'page_number_sequence']));
      expect(n.xIndentEvidence).toMatchObject({ placed: false, level: null });
    }
    expect(levelOf(r, 100, '501')).toBe(1);
    expect(levelOf(r, 100, '502')).toBe(2);
    expect(r.diagnostics.excludedCount).toBe(2);
    expect(r.parameters.pageNumberOffset).toBe(1);
  });
  it('除外した行も消えない: SourceToken / LogicalRow / PhysicalRow / x へ戻れる（silent dropなし）', () => {
    const doc = headerDoc();
    const r = observeDocumentHierarchyV2('detail', doc, O('observational-filter', 'off'));
    for (const n of r.nodes.filter(x => x.hierarchyEligibility === 'excluded')) {
      const p = doc.find(x => x.meta.number === n.sourcePage)!;
      const row = p.logical.logicalRowCandidates[n.sourceRowRefs.logicalRowIndex];
      expect(n.sourceRowRefs.physicalRowIndexes).toEqual(row.physicalRowIndexes);
      expect(p.tokens[n.sourceTokenRefs.keyTokenIndex].bbox.xMin).toBe(n.xIndentEvidence.keyTokenXMin);
    }
    expect(r.nodes.length).toBe(observeDocumentHierarchy('detail', doc).nodes.length);
  });
  it('ページ先頭付近の正規の見出し（ヘッダの直下）は除外されない', () => {
    const doc = [100, 101, 102, 103].map(n => pageOf(n, withFrame(n, [head('501', X.l1), head('502', X.l2), request('11', '01-95', X.l3)])));
    const r = run(doc, 'observational-filter', 'off');
    expect(r.diagnostics.excludedCount).toBe(2); // ヘッダの2行（偶数頁）だけ
    expect(r.nodes.filter(n => ['501', '502'].includes(n.observedCodeParts.code)).every(n => n.hierarchyEligibility === 'candidate')).toBe(true);
  });
  it('単一のevidenceだけでは除外しない（最上行でも頁番号・反復の証拠が無ければ候補のまま）', () => {
    // ヘッダに頁番号が無く、先頭行がページごとに違う位置・内容
    const doc = [100, 101, 102].map((n, i) => pageOf(n, [head(`60${i}`, X.l1), head('502', X.l2), request('11', '01-95', X.l3), ...Array.from({ length: i * 3 }, () => head('503', X.l4))]));
    const r = run(doc, 'observational-filter', 'off');
    const top = r.nodes.filter(n => n.sourceRowRefs.logicalRowIndex === 0);
    expect(top.length).toBe(3);
    expect(top.every(n => n.headerEvidenceObserved.some(e => e.kind === 'page_edge_row'))).toBe(true);
    expect(top.every(n => n.hierarchyEligibility === 'candidate' || n.exclusionEvidence.length >= 2)).toBe(true);
  });
  it('ページ数が3未満では反復・頁番号の証拠を評価せず、除外しない', () => {
    const r = run(headerDoc().slice(0, 2), 'observational-filter', 'off');
    expect(r.diagnostics.excludedCount).toBe(0);
    expect(r.parameters.pageNumberOffset).toBeNull();
  });
  it('v2-B 単独ではヘッダ衝突は直らない（levelはv1と同じ）', () => {
    const v1 = observeDocumentHierarchy('detail', headerDoc());
    const r = run(headerDoc(), 'off', 'lattice-supported');
    expect(r.nodes.map(n => n.xIndentEvidence.level)).toEqual(v1.nodes.map(n => n.xIndentEvidence.level));
  });
});

describe('B: single-organization（lattice-supported）', () => {
  it('v1 では支持1の根が unplaced になり level がずれる（再現）', () => {
    const v1 = observeDocumentHierarchy('detail', singleRootDoc());
    expect(v1.nodes.find(n => n.observedCodeParts.code === '501')!.xIndentEvidence).toMatchObject({ placed: false, level: null });
    expect(v1.nodes.find(n => n.observedCodeParts.code === '502')!.xIndentEvidence.level).toBe(1);
  });
  it('v2-B: 規則的な階段（run 3つ以上）の1段左にある支持1のクラスタを根として置く。根拠が残る', () => {
    const r = run(singleRootDoc(), 'off', 'lattice-supported');
    expect(levelOf(r, 100, '501')).toBe(1);
    expect(levelOf(r, 100, '502')).toBe(2);
    const c = r.indentClusters.find(x => x.placementBasis === 'lattice_supported')!;
    expect(c.memberCount).toBe(1);
    expect(c.latticeEvidence!.runClusterIndexes.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(c.latticeEvidence!.gapToRun - c.latticeEvidence!.step)).toBeLessThanOrEqual(c.latticeEvidence!.tolerance);
    expect(r.parameters.minClusterSupport).toBe(2); // minClusterSupport を下げていない
    expect(r.edges.find(e => e.childNodeId === nodeAt(r, 100, '502').id)!.status).toBe('resolved_by_indent_sequence');
  });
  it('階段が規則的でない（隣接差が揃わない）なら置かない', () => {
    const body = (first: Cell[][]): Cell[][] => [...first, head('502', 57), request('11', '01-95', 70), head('503', 90), head('504', 57), request('12', '02-95', 70), head('505', 90)];
    const doc = [pageOf(100, body([head('501', 50)])), pageOf(101, body([])), pageOf(102, body([])), pageOf(103, body([]))];
    const r = run(doc, 'off', 'lattice-supported');
    expect(r.nodes.find(n => n.observedCodeParts.code === '501')!.xIndentEvidence.placed).toBe(false);
  });
  it('支持1のクラスタが placed クラスタより右（根側でない）なら置かない', () => {
    const doc = [100, 101, 102].map(n => pageOf(n, [head('502', X.l2), request('11', '01-95', X.l3), head('503', X.l4), ...(n === 100 ? [head('504', 200)] : [])]));
    const r = run(doc, 'off', 'lattice-supported');
    expect(r.nodes.find(n => n.observedCodeParts.code === '504')!.xIndentEvidence.placed).toBe(false);
  });
  it('階段が2クラスタ（run 3未満）しかなければ置かない', () => {
    const doc = [100, 101].map(n => pageOf(n, [...(n === 100 ? [head('501', X.l1)] : []), head('502', X.l2), head('503', X.l2), head('504', X.l3), head('505', X.l3)]));
    const r = run(doc, 'off', 'lattice-supported');
    expect(r.nodes.find(n => n.observedCodeParts.code === '501')!.xIndentEvidence.placed).toBe(false);
  });
  it('複数組織の通常範囲は v1 と同じ（root は support で placed）', () => {
    const v1 = observeDocumentHierarchy('detail', headerDoc().map(p => p));
    const r = observeDocumentHierarchyV2('detail', headerDoc(), O('off', 'lattice-supported'));
    expect(r.nodes.map(n => n.xIndentEvidence.level)).toEqual(v1.nodes.map(n => n.xIndentEvidence.level));
    expect(r.diagnostics.latticePlacedClusterCount).toBe(0);
  });
  it('v2-A 単独では single-organization は直らない', () => {
    const r = run(singleRootDoc(), 'observational-filter', 'off');
    expect(r.nodes.find(n => n.observedCodeParts.code === '501')!.xIndentEvidence.placed).toBe(false);
  });
});

describe('A と B は独立に効き、組み合わせても各単独の効果になる', () => {
  it('ヘッダ + 単一組織: A だけ・B だけでは直らず、AB で両方直る', () => {
    const doc = singleRootDoc(true);
    const root = (r: DocumentHierarchyV2Result) => levelOf(r, 100, '501');
    expect(root(run(doc, 'off', 'off'))).toBeNull();
    expect(root(run(doc, 'observational-filter', 'off'))).toBeNull(); // 根は unplaced のまま
    expect(root(run(doc, 'off', 'lattice-supported'))).toBeNull(); // ヘッダの根レベルが左にあり、根側のクラスタではない
    const ab = run(doc, 'observational-filter', 'lattice-supported');
    expect(root(ab)).toBe(1);
    expect(levelOf(ab, 100, '502')).toBe(2);
    expect(ab.diagnostics.excludedCount).toBeGreaterThan(0);
    expect(ab.diagnostics.latticePlacedClusterCount).toBe(1);
  });
  it('決定的（同じ入力で同じ結果、ページの与え順に依存しない）', () => {
    for (const [a, b] of [['off', 'off'], ['observational-filter', 'off'], ['off', 'lattice-supported'], ['observational-filter', 'lattice-supported']] as const) {
      const x = JSON.stringify(run(singleRootDoc(true), a, b));
      expect(JSON.stringify(run(singleRootDoc(true), a, b))).toBe(x);
      expect(JSON.stringify(run([...singleRootDoc(true)].reverse(), a, b))).toBe(x);
    }
  });
});

describe('実験境界（静的確認）: GT・凍結層・コード値に依存しない', () => {
  const src = fs.readFileSync(path.join(__dirname, 'budget-request-document-hierarchy-v2.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it('importは v1（型とDEFAULT_HIERARCHY_OPTIONS）だけで、GT・評価・凍結層を読まない', () => {
    const imports = [...src.matchAll(/from '([^']+)'/g)].map(m => m[1]);
    expect(imports.every(i => i === './budget-request-document-hierarchy')).toBe(true);
    expect(code).not.toMatch(/(ground-truth|toc-hierarchy|hierarchy-gt|spatial-region|region-relation|semantic-record|record-anchor|page-template)/);
  });
  it('省庁名・組織名・コード値・固定pt・固定割合の閾値を埋め込まない', () => {
    expect(code).not.toMatch(/METI|MEXT|MHLW|経済産業|文部科学|厚生労働|経（中）/);
    expect(code).not.toMatch(/\b(0\.08|0\.94|37\.98|51\.7|58\.6|65\.5)\b/);
    for (const gtFile of ['meti-toc-hierarchy-gt.json', 'mext-toc-hierarchy-gt.json', 'mhlw-toc-hierarchy-gt-extended.json', 'env-toc-hierarchy-gt.json', 'maff-fukko-toc-hierarchy-gt.json']) {
      const gt = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../tests/fixtures/budget-request-document-hierarchy/2024', gtFile), 'utf8')) as { nodes: { name: string }[] };
      for (const n of gt.nodes) expect(src.includes(n.name), n.name).toBe(false);
    }
  });
});

const targets = listExtractionTargets(getBudgetRequestManifest(2024));
const METI = targets.find(t => t.canonicalUrl === 'https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf');
const MHLW = targets.find(t => t.canonicalUrl === 'https://www.mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf');
const metiOk = METI !== undefined && fs.existsSync(METI.localPath);
const mhlwOk = MHLW !== undefined && fs.existsSync(MHLW.localPath);
async function load(t: NonNullable<typeof METI>, a: number, b: number): Promise<HierarchyPageInput[]> {
  const out: HierarchyPageInput[] = [];
  for (let n = a; n <= b; n++) {
    const ex = await extractPageTokens(t.localPath, n);
    const geometry = buildTableGeometry(ex.tokens, ex.page);
    out.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
  }
  return out;
}

describe.skipIf(!metiOk)('METI 実PDF（development）', () => {
  it('A: `100 経（中）` / `102 経（中）` は v2-A で除外され、組織が level 1 に戻り、063 の level_gap が解消する。v2-B 単独では直らない', async () => {
    const doc = await load(METI as NonNullable<typeof METI>, 82, 106);
    const a = observeDocumentHierarchyV2('detail', doc, O('observational-filter', 'off'));
    const excluded = a.nodes.filter(n => n.hierarchyEligibility === 'excluded');
    expect(excluded.map(n => [n.sourcePage, n.observedCodeParts.code])).toEqual([[104, '100'], [106, '102']]);
    expect(excluded.every(n => n.exclusionEvidence.length >= 2)).toBe(true);
    const org = a.nodes.find(n => n.sourcePage === 94 && n.observedCodeParts.code === '060')!;
    expect(org.xIndentEvidence.level).toBe(1);
    const item = a.nodes.find(n => n.sourcePage === 105 && n.observedCodeParts.code === '063')!;
    expect(a.edges.find(e => e.childNodeId === item.id)!.status).toBe('resolved_by_indent_sequence');
    const b = observeDocumentHierarchyV2('detail', doc, O('off', 'lattice-supported'));
    expect(b.nodes.find(n => n.id === org.id)!.xIndentEvidence.level).toBe(2);
    expect(b.edges.find(e => e.childNodeId === item.id)!.status).toBe('level_gap');
  });
  it('B: 組織035のみの範囲で根が lattice-supported として placed になる。v2-A 単独では直らない', async () => {
    const doc = await load(METI as NonNullable<typeof METI>, 66, 81);
    const b = observeDocumentHierarchyV2('detail', doc, O('off', 'lattice-supported'));
    const org = b.nodes.find(n => n.sourcePage === 66 && n.observedCodeParts.code === '035')!;
    expect(org.xIndentEvidence).toMatchObject({ placed: true, level: 1 });
    expect(b.indentClusters.filter(c => c.placementBasis === 'lattice_supported')).toHaveLength(1);
    const a = observeDocumentHierarchyV2('detail', doc, O('observational-filter', 'off'));
    expect(a.nodes.find(n => n.id === org.id)!.xIndentEvidence.placed).toBe(false);
  });
  it('regression: ヘッダ衝突より前の正常部分（p9–103）では v2 は何も除外・変更しない', async () => {
    const doc = await load(METI as NonNullable<typeof METI>, 9, 103);
    const v1 = observeDocumentHierarchy('detail', doc);
    for (const [x, y] of [['observational-filter', 'off'], ['off', 'lattice-supported'], ['observational-filter', 'lattice-supported']] as const) {
      const r = observeDocumentHierarchyV2('detail', doc, O(x, y));
      expect(r.diagnostics.excludedCount).toBe(0);
      expect(r.edges).toEqual(v1.edges);
      expect(r.nodes.map(n => n.xIndentEvidence.level)).toEqual(v1.nodes.map(n => n.xIndentEvidence.level));
    }
  });
});

describe.skipIf(!mhlwOk)('MHLW 実PDF（regression・negative）', () => {
  it('組織080（p1603。ページ先頭付近の正規の見出し）は除外されず、v2-AB でも v1 と同じ階層になる', async () => {
    const doc = await load(MHLW as NonNullable<typeof MHLW>, 1555, 1604);
    const v1 = observeDocumentHierarchy('detail', doc);
    const ab = observeDocumentHierarchyV2('detail', doc, O('observational-filter', 'lattice-supported'));
    expect(ab.diagnostics.excludedCount).toBe(0);
    const org = ab.nodes.find(n => n.sourcePage === 1603 && n.observedCodeParts.code === '080')!;
    expect(org.hierarchyEligibility).toBe('candidate');
    expect(ab.edges).toEqual(v1.edges);
  });
});
