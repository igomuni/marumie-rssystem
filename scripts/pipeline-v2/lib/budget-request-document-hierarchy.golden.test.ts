/**
 * DocumentHierarchy PoC の実PDF（MHLW 05-1b-01.pdf）検証。**ローカルの data/download/ の原本PDFに依存する**ため、
 * 原本が無い環境（CI等）では自動的にskipされる。既知の対象をrawText・コードから探すのはtestだけ（推論本体は値を使わない）。
 * 親子の正解（GT）はここでは使わない（評価は evaluate-budget-request-document-hierarchy.ts）。見るのは次の3点:
 *  - p1555: 項と要求の間の過年度表の行が、階層の親にも子にもならない（負のテスト）
 *  - 親見出しが再掲されないページ（p1595・p1600）の要求が、前ページの親へstackで辿り着く
 *  - 同じ入力で同じ結果になる / 全nodeがSourceTokenへ戻れる
 */
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { observeDocumentHierarchy, type DocumentHierarchyResult, type HierarchyPageInput } from './budget-request-document-hierarchy';
import { listExtractionTargets } from './budget-request-extraction';
import { resolveLogicalRows } from './budget-request-logical-row';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { extractPageTokens } from './budget-request-pdf-page';
import { buildTableGeometry } from './budget-request-table-geometry';

const MHLW_URL = 'https://www.mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf';
const target = listExtractionTargets(getBudgetRequestManifest(2024)).find(t => t.canonicalUrl === MHLW_URL);
const available = target !== undefined && fs.existsSync(target.localPath);

let pages: HierarchyPageInput[] | null = null;
async function loadPages(): Promise<HierarchyPageInput[]> {
  if (pages) return pages;
  const out: HierarchyPageInput[] = [];
  // p1603 は次の組織（080）の先頭。範囲に組織が1つだけだと根のインデント段の支持が1行になり unplaced（levelがずれる）ため、2組織以上を含める（v1の既知の制約）
  for (let n = 1555; n <= 1604; n++) {
    const ex = await extractPageTokens((target as NonNullable<typeof target>).localPath, n);
    const geometry = buildTableGeometry(ex.tokens, ex.page);
    out.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
  }
  pages = out;
  return out;
}
const parentOf = (r: DocumentHierarchyResult, id: string) => r.nodes.find(n => n.id === r.edges.find(e => e.childNodeId === id)?.parentNodeId);

describe.skipIf(!available)('MHLW 明細 p1555-p1604（070 の部分木 + 次の組織の先頭）', () => {
  it('p1555: 項と要求の間の過年度表の行は見出し候補にならず、要求の親は項のまま', async () => {
    const ps = await loadPages();
    const p1555 = ps[0];
    const r = observeDocumentHierarchy('detail', ps);
    const onPage = r.nodes.filter(n => n.sourcePage === 1555);
    expect(onPage.map(n => n.xIndentEvidence.level)).toEqual([1, 2, 3]);
    const [org, item, req] = onPage;
    expect(parentOf(r, req.id)?.id).toBe(item.id);
    expect(parentOf(r, item.id)?.id).toBe(org.id);
    // 項と要求の間にある論理行（過年度表・罫線表）はどのedgeにも現れない
    const between = p1555.logical.logicalRowCandidates.filter(c => c.logicalRowIndex > item.sourceRowRefs.logicalRowIndex && c.logicalRowIndex < req.sourceRowRefs.logicalRowIndex);
    expect(between.length).toBeGreaterThan(20);
    const betweenIdx = new Set(between.map(c => c.logicalRowIndex));
    const nodesBetween = r.nodes.filter(n => n.sourcePage === 1555 && betweenIdx.has(n.sourceRowRefs.logicalRowIndex));
    expect(nodesBetween).toHaveLength(0);
    // 罫線表の行（先頭が罫線文字）はそもそも見出し形状にならない
    const boxRows = between.filter(c => c.visualTokenIndexes.some(i => /[─-╿]/.test(p1555.tokens[i].rawText)));
    expect(boxRows.length).toBeGreaterThan(10);
    expect(boxRows.every(c => !onPage.some(n => n.sourceRowRefs.logicalRowIndex === c.logicalRowIndex))).toBe(true);
  });

  it('親見出しが再掲されないページ（p1595・p1600）の要求は、前ページの親へstackで辿り着く', async () => {
    const r = observeDocumentHierarchy('detail', await loadPages());
    for (const [page, no] of [[1595, '189'], [1600, '193']] as const) {
      const req = r.nodes.find(n => n.sourcePage === page && n.observedCodeParts.requestNo === no)!;
      expect(req, `${no}`).toBeDefined();
      const e = r.edges.find(x => x.childNodeId === req.id)!;
      expect(e.status).toBe('resolved_by_indent_sequence');
      expect(e.evidence.find(x => x.kind === 'page_transition')!.detail).toMatchObject({ childPage: page, parentOnSamePage: false });
      const parent = parentOf(r, req.id)!;
      expect(parent.sourcePage).toBeLessThan(page);
      expect(parent.xIndentEvidence.level).toBe(2);
      expect(parentOf(r, parent.id)?.sourcePage).toBe(1555);
      expect(e.evidence.find(x => x.kind === 'document_order')!.detail.logicalRowsBetween).toBeGreaterThan(100);
    }
  });

  it('全nodeがSourceToken・LogicalRowへ戻れ、同じ入力で同じ結果になる', async () => {
    const ps = await loadPages();
    const a = observeDocumentHierarchy('detail', ps);
    expect(JSON.stringify(observeDocumentHierarchy('detail', ps))).toBe(JSON.stringify(a));
    for (const n of a.nodes) {
      const p = ps.find(x => x.meta.number === n.sourcePage)!;
      const key = p.tokens[n.sourceTokenRefs.keyTokenIndex];
      expect(key.bbox.xMin).toBe(n.xIndentEvidence.keyTokenXMin);
      expect(p.logical.logicalRowCandidates[n.sourceRowRefs.logicalRowIndex].physicalRowIndexes).toEqual(n.sourceRowRefs.physicalRowIndexes);
    }
  });
});
