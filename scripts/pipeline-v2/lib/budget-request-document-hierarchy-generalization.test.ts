/**
 * DocumentHierarchy v1（frozen）の他省庁 generalization 実験の再現性テスト。
 * 推論（v1）は変更しないので、ここで見るのは「実験の境界」「評価側の純粋関数」「実PDFで観測した既知の失敗の記録」。
 * 実PDFのテストは **ローカルの data/download/ の原本PDFに依存**するため、原本が無い環境では自動的にskipされる。
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HIERARCHY_OPTIONS, observeDocumentHierarchy, type DocumentHierarchyResult, type HierarchyPageInput } from './budget-request-document-hierarchy';
import { matchGtNodes, verdictOf, type Counts, type GtNode } from './budget-request-document-hierarchy-eval';
import { listExtractionTargets } from './budget-request-extraction';
import { resolveLogicalRows } from './budget-request-logical-row';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { extractPageTokens } from './budget-request-pdf-page';
import { buildTableGeometry } from './budget-request-table-geometry';

const dir = __dirname;
const runnerSrc = fs.readFileSync(path.join(dir, '../extract-budget-request-document-hierarchy-generalization.ts'), 'utf8');
const importsOf = (src: string) => [...src.matchAll(/from '([^']+)'/g)].map(m => m[1]);

describe('v1 freeze と実験境界', () => {
  it('v1の係数が固定されている（0.25 / 2）', () => {
    expect(DEFAULT_HIERARCHY_OPTIONS).toEqual({ indentClusterGapFactor: 0.25, minClusterSupport: 2 });
  });
  it('実験ランナー（推論側）はGT・評価・凍結層をimportせず、GT fixtureを参照しない', () => {
    for (const imp of importsOf(runnerSrc)) expect(imp, imp).not.toMatch(/(eval|ground-truth|gt-extended|toc-hierarchy-gt|spatial-region|region-relation|semantic-record|record-anchor|page-template)/);
    expect(runnerSrc).not.toMatch(/hierarchy-gt|toc-hierarchy|GroundTruth|ground-truth/);
    expect(runnerSrc).toMatch(/observeDocumentHierarchy\(e\.view, pages, DEFAULT_HIERARCHY_OPTIONS\)/); // v1をそのまま呼ぶ
  });
  it('ランナーに正解のコード値・名称・組織の部分木を埋め込んでいない（走査範囲とURLだけ）', () => {
    for (const gtFile of ['meti-toc-hierarchy-gt.json', 'mext-toc-hierarchy-gt.json']) {
      const gt = JSON.parse(fs.readFileSync(path.join(dir, '../../../tests/fixtures/budget-request-document-hierarchy/2024', gtFile), 'utf8')) as { nodes: { name: string }[] };
      for (const n of gt.nodes) expect(runnerSrc.includes(n.name), n.name).toBe(false);
    }
  });
});

describe('評価側: 判定基準（事前固定）', () => {
  const c = (o: Partial<Counts> & { exact: number; gtEdges: number }): Counts => ({
    falseParent: 0, unresolved: 0, childNotFound: 0, precision: null, recall: null, f1: null,
    ancestorExact: { x: 0, n: 0 }, depthExact: { x: o.gtEdges, matched: o.gtEdges, n: o.gtEdges }, nodesMatched: { x: o.gtEdges, n: o.gtEdges }, ...o,
  });
  it('SUCCESS: exact>=90% & false<=5% & depth>=90%', () => {
    expect(verdictOf(c({ exact: 90, gtEdges: 100, falseParent: 5 }))).toBe('SUCCESS');
  });
  it('depthが90%未満（levelが体系的にずれる）なら、edgeが全て正しくても SUCCESS にならない', () => {
    expect(verdictOf(c({ exact: 100, gtEdges: 100, depthExact: { x: 0, matched: 100, n: 100 } }))).toBe('PARTIAL');
  });
  it('PARTIAL / FAIL / EVALUATION BLOCKED', () => {
    expect(verdictOf(c({ exact: 50, gtEdges: 100, falseParent: 10 }))).toBe('PARTIAL');
    expect(verdictOf(c({ exact: 49, gtEdges: 100 }))).toBe('FAIL');
    expect(verdictOf(c({ exact: 80, gtEdges: 100, falseParent: 11 }))).toBe('FAIL');
    expect(verdictOf(c({ exact: 10, gtEdges: 100, nodesMatched: { x: 49, n: 100 } }))).toBe('EVALUATION BLOCKED');
  });
});

describe('評価側: 事後診断の照合オプション（既定は無効で、MHLW・事前固定の挙動は変わらない）', () => {
  const node = (id: string, text: string[], code = '010', pageRef: string | null = null) => ({
    id, view: 'summary', sourcePage: 1, rowShape: 'code3_then_text', sourceRowRefs: { logicalRowIndex: 0, physicalRowIndexes: [0] },
    sourceTokenRefs: { keyTokenIndex: 0, rowTokenIndexes: [0] }, observedCodeParts: { code }, observedTextParts: text,
    xIndentEvidence: { keyTokenXMin: 0, clusterIndex: 0, level: 1, placed: true }, structureEvidence: { printedPageRefCandidate: pageRef, rowTokenCount: 1 },
  });
  const result = (nodes: ReturnType<typeof node>[], view: 'summary' | 'detail' = 'summary') => ({ view, nodes, edges: [] }) as unknown as DocumentHierarchyResult;
  const g = (key: string, code: string, name: string): GtNode => ({ key, depth: 2, code, name, printedStartPage: 1, set: 'test' });

  it('nameOnly: 組織名で始まる項名は、組織の名称と曖昧にならない（完全一致を優先）', () => {
    const r = result([node('org', ['経', '済', '産', '業', '本', '省', '42,654,151']), node('item', ['経済産業本省共通費', '45,924,345'])]);
    const org = g('o', '010', '経済産業本省');
    expect(matchGtNodes(r, [org], 0, true, 'codeName').status.get('o')).toBe('ambiguous_match'); // 事前固定の前方一致
    expect(matchGtNodes(r, [org], 0, true, 'codeName', { nameOnly: true }).matched.get('o')?.id).toBe('org');
  });
  it('nameOnly: 折返しで途中までしか印字されない名称（GT名称の前方部分）に対応づけられる', () => {
    const r = result([node('a', ['経済産業に関する政策の調査等に必要な経', '0', '1,020,175'])]);
    const gt = g('r', '010', '経済産業に関する政策の調査等に必要な経費');
    expect(matchGtNodes(r, [gt], 0, true, 'codeName').status.get('r')).toBe('not_found');
    expect(matchGtNodes(r, [gt], 0, true, 'codeName', { nameOnly: true }).matched.get('r')?.id).toBe('a');
  });
  it('ordinalTiebreak: 同じ形・コード・名称のGTが複数あり、候補数が同じなら文書順の序数で対応づける（summaryのみ）', () => {
    const r = result([node('a', ['初等中等教育振興費', '1'], '060'), node('b', ['初等中等教育振興費', '2'], '060')]);
    const gts = [g('first', '060', '初等中等教育振興費'), g('second', '060', '初等中等教育振興費')];
    expect(matchGtNodes(r, gts, 0, true, 'codeName', { nameOnly: true }).status.get('first')).toBe('ambiguous_match');
    const m = matchGtNodes(r, gts, 0, true, 'codeName', { nameOnly: true, ordinalTiebreak: true });
    expect([m.matched.get('first')?.id, m.matched.get('second')?.id]).toEqual(['a', 'b']);
  });
  it('既定（オプションなし）の挙動は変わらない', () => {
    const r = result([node('x', ['項乙', '1'], '010', '10')]);
    expect(matchGtNodes(r, [g('i', '010', '項乙')], 0).status.get('i')).toBe('not_found'); // pageRef モードで頁数列の候補が一致しない
  });
});

const targets = listExtractionTargets(getBudgetRequestManifest(2024));
const METI = targets.find(t => t.canonicalUrl === 'https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf');
const available = METI !== undefined && fs.existsSync(METI.localPath);

async function loadRange(a: number, b: number): Promise<HierarchyPageInput[]> {
  const out: HierarchyPageInput[] = [];
  for (let n = a; n <= b; n++) {
    const ex = await extractPageTokens((METI as NonNullable<typeof METI>).localPath, n);
    const geometry = buildTableGeometry(ex.tokens, ex.page);
    out.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
  }
  return out;
}

describe.skipIf(!available)('METI 実PDFで観測した v1 の既知の失敗（修正せず記録する。v2 candidate の根拠）', () => {
  it('ページヘッダ（印字頁が3桁の「100 経（中）」）が見出し形状に一致し、余分な根レベルを作る（level が1段ずれ、親の見出しを押し出す）', async () => {
    const r: DocumentHierarchyResult = observeDocumentHierarchy('detail', await loadRange(82, 106));
    const level1 = r.nodes.filter(n => n.xIndentEvidence.level === 1);
    expect(level1.map(n => [n.sourcePage, n.observedCodeParts.code, n.observedTextParts[0]])).toEqual([[104, '100', '経（中）'], [106, '102', '経（中）']]);
    // 組織（x≈51.8）は level 2 に押し下げられる
    const org = r.nodes.find(n => n.sourcePage === 94 && n.observedCodeParts.code === '060')!;
    expect(org.xIndentEvidence.level).toBe(2);
    // ヘッダ（level 1）が org（level 2）を押し出し、その後の項（level 3）は level_gap になる（false parent ではなく ambiguous）
    const item = r.nodes.find(n => n.sourcePage === 105 && n.observedCodeParts.code === '063')!;
    const edge = r.edges.find(e => e.childNodeId === item.id)!;
    expect(edge.status).toBe('level_gap');
  });
  it('root見出しが1件だけの範囲（組織035のみ）では root cluster が unplaced になり、levelがずれる（single-organization感度。MHLWと同じ failure）', async () => {
    const r = observeDocumentHierarchy('detail', await loadRange(66, 81));
    const org = r.nodes.find(n => n.sourcePage === 66 && n.observedCodeParts.code === '035')!;
    expect(org.xIndentEvidence).toMatchObject({ placed: false, level: null });
    expect(r.nodes.filter(n => n.xIndentEvidence.level === 1).every(n => n.rowShape === 'code3_then_text')).toBe(true);
  });
  it('同じ入力で同じ結果になる', async () => {
    const pages = await loadRange(82, 90);
    expect(JSON.stringify(observeDocumentHierarchy('detail', pages))).toBe(JSON.stringify(observeDocumentHierarchy('detail', pages)));
  });
});
