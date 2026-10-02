/**
 * A2（headerCollisionHandling='page-edge-domain'。事前登録した primary rule）の単体・development・independence・static テスト。
 * 実PDFのテストは **ローカルの data/download/ の原本PDFに依存**するため、原本が無い環境では自動的にskipされる。
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { observeDocumentHierarchy, type HierarchyPageInput } from './budget-request-document-hierarchy';
import { observeDocumentHierarchyV2, type DocumentHierarchyV2Result, type HierarchyV2ExperimentalOptions } from './budget-request-document-hierarchy-v2';
import { A2_EXPERIMENTS, A2_VARIANTS } from './budget-request-document-hierarchy-a2-experiments';
import { listExtractionTargets } from './budget-request-extraction';
import { resolveLogicalRows } from './budget-request-logical-row';
import { getBudgetRequestManifest } from './budget-request-manifest';
import { extractPageTokens } from './budget-request-pdf-page';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';
import { buildTableGeometry } from './budget-request-table-geometry';

const styles = { f1: { ascent: 0.859, descent: -0.141 } };
const FS = 6.944;
const PITCH = 14;
const X = { hdr: 37.98, l1: 50, l2: 57, l3: 64, l4: 71 };
type Cell = [text: string, x: number];

/** y0: 先頭行のy。ページごとに変えると、ヘッダ行の y 帯が反復しない文書を作れる */
function pageOf(number: number, rows: Cell[][], y0 = 20): HierarchyPageInput {
  const meta = pageMetaFrom(number, 999, [0, 0, 842, 595], 0);
  const raw: SourceToken[] = [];
  rows.forEach((cells, r) => {
    for (const [text, x] of cells) {
      const item: RawTextItem = { str: text, transform: [FS, 0, 0, FS, x, 595 - (y0 + r * PITCH)], width: Math.max(8, text.length * 4), height: FS, fontName: 'f1', hasEOL: false, dir: 'ltr' };
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
/** 偶数頁は左に「頁番号（3桁。印字頁=物理+1）+略称」、奇数頁は右に「略称+頁番号」 */
const headerRow = (page: number, printed: (p: number) => string = p => String(p + 1)): Cell[] => (page % 2 === 0 ? [[printed(page), X.hdr], ['略称', 55]] : [['略称', 700], [printed(page), 740]]);
const footerRow: Cell[] = [['2023/09/07 11:05:57', 700]];
const frame = (page: number, body: Cell[][], printed?: (p: number) => string): Cell[][] => [headerRow(page, printed), ...body, footerRow];

function headerDoc(printed?: (p: number) => string): HierarchyPageInput[] {
  return [
    pageOf(100, frame(100, [head('501', X.l1), head('502', X.l2), request('11', '01-95', X.l3), head('503', X.l4)], printed)),
    pageOf(101, frame(101, [head('504', X.l2), request('12', '02-95', X.l3), head('505', X.l4)], printed)),
    pageOf(102, frame(102, [head('506', X.l1), head('507', X.l2), request('13', '03-95', X.l3), head('508', X.l4)], printed)),
    pageOf(103, frame(103, [request('14', '04-95', X.l3), head('509', X.l4)], printed)),
  ];
}
function singleRootHeaderDoc(): HierarchyPageInput[] {
  return [
    pageOf(100, frame(100, [head('501', X.l1), head('502', X.l2), request('11', '01-95', X.l3), head('503', X.l4), head('504', X.l4)])),
    pageOf(101, frame(101, [head('505', X.l2), request('12', '02-95', X.l3), head('506', X.l4), head('507', X.l4)])),
    pageOf(102, frame(102, [request('13', '03-95', X.l3), head('508', X.l4), head('509', X.l4)])),
    pageOf(103, frame(103, [head('510', X.l2), request('14', '04-95', X.l3), head('511', X.l4)])),
  ];
}
const O = (a: HierarchyV2ExperimentalOptions['headerCollisionHandling'], b: 'off' | 'lattice-supported'): HierarchyV2ExperimentalOptions => ({ headerCollisionHandling: a, singletonRootPlacement: b });
const run = (doc: HierarchyPageInput[], a: HierarchyV2ExperimentalOptions['headerCollisionHandling'], b: 'off' | 'lattice-supported' = 'off'): DocumentHierarchyV2Result => observeDocumentHierarchyV2('detail', doc, O(a, b));
const node = (r: DocumentHierarchyV2Result, page: number, code: string) => r.nodes.find(n => n.sourcePage === page && n.observedCodeParts.code === code)!;

describe('A2 の規則: 3条件（ページ端・頁番号の正準な10進表記・y帯の反復）が全て成立したときだけ除外', () => {
  it('3条件が全て成立 → 除外。理由が D・N・Y の3種で残る', () => {
    const r = run(headerDoc(), 'page-edge-domain');
    const ex = r.nodes.filter(n => n.hierarchyEligibility === 'excluded');
    expect(ex.map(n => n.observedCodeParts.code).sort()).toEqual(['101', '103']);
    for (const n of ex) expect(n.exclusionEvidence.map(e => e.kind).sort()).toEqual(['page_edge_row', 'page_number_sequence', 'vertical_repetition']);
    expect(node(r, 100, '501').xIndentEvidence.level).toBe(1); // 偽の根レベルが消える
  });
  it('ページ端でない行は、頁番号と一致するtokenとy帯の反復があっても除外しない（農水省の要求 `9` 型の誤除外の防止）', () => {
    // 先頭行（頁番号ヘッダ）の下の本文行に、頁番号と同じ値のtokenを持つ要求を置く（物理p+オフセット=印字頁）
    const doc = [100, 101, 102, 103].map(n => pageOf(n, frame(n, [head('501', X.l1), head('502', X.l2), request(String(n + 1), '01-95', X.l3)])));
    const a2 = run(doc, 'page-edge-domain');
    const reqs = a2.nodes.filter(n => n.rowShape === 'request_no_then_code');
    expect(reqs.length).toBe(4);
    expect(a2.diagnostics.excludedCount).toBe(2); // ヘッダ（偶数頁）の2行だけ
    expect(reqs.every(n => n.hierarchyEligibility === 'candidate')).toBe(true);
    // 比較: v2-A（STOP）は同じ文書でページ端でない要求を誤除外する
    const a = run(doc, 'observational-filter');
    expect(a.nodes.filter(n => n.rowShape === 'request_no_then_code' && n.hierarchyEligibility === 'excluded').length).toBeGreaterThan(0);
  });
  it('頁番号が正準な10進表記でない（先頭0つき）なら除外しない（`005` 型）', () => {
    const doc = headerDoc(p => `0${p + 1}`); // 0101, 0103（先頭0つきの頁番号）
    const r = run(doc, 'page-edge-domain');
    expect(r.diagnostics.excludedCount).toBe(0);
    expect(r.parameters.pageNumberOffset).toBeNull();
  });
  it('先頭0つきの本文行 `005` は、値が物理頁−オフセットと一致しても頁番号の証拠にならない', () => {
    const doc = headerDoc();
    const target = [pageOf(104, frame(104, [head('501', X.l1), head('502', X.l2), head('005', X.l4)]))];
    const r = run([...doc, ...target], 'page-edge-domain');
    const zero = r.nodes.find(n => n.sourcePage === 104 && n.observedCodeParts.code === '005')!;
    expect(zero.hierarchyEligibility).toBe('candidate');
    expect(zero.headerEvidenceObserved.some(e => e.kind === 'page_number_sequence')).toBe(false);
  });
  it('y帯が過半数のページで反復しない（ヘッダ行のyがページごとに違う）なら除外しない', () => {
    const doc = [100, 101, 102, 103].map((n, i) => pageOf(n, frame(n, [head(`50${i}`, X.l1), head(`51${i}`, X.l2)]), 20 + i * 37));
    const r = run(doc, 'page-edge-domain');
    expect(r.diagnostics.excludedCount).toBe(0);
    const edge = r.nodes.filter(n => n.headerEvidenceObserved.some(e => e.kind === 'page_edge_row'));
    expect(edge.every(n => !n.headerEvidenceObserved.some(e => e.kind === 'vertical_repetition'))).toBe(true);
  });
  it('ページ数が3未満では評価不能（除外しない）', () => {
    const r = run(headerDoc().slice(0, 2), 'page-edge-domain');
    expect(r.diagnostics.excludedCount).toBe(0);
  });
});

describe('observe-only: 観測と decision の分離', () => {
  it('A2 と同じ evidence を観測として残すが除外しない。hierarchy の判断は off と同じ', () => {
    const doc = headerDoc();
    const off = run(doc, 'off');
    const obs = run(doc, 'observe-only');
    const proj = (r: DocumentHierarchyV2Result) => [r.nodes.map(n => [n.id, n.xIndentEvidence, n.hierarchyEligibility]), r.edges];
    expect(proj(obs)).toEqual(proj(off));
    expect(obs.headerCollisionObservation.excludedNodeIds).toEqual([]);
    expect(obs.headerCollisionObservation.nodesWithHeaderEvidence.length).toBeGreaterThanOrEqual(2);
    expect(obs.nodes.filter(n => n.hierarchyResolutionContext.headerCollisionObserved).map(n => n.observedCodeParts.code)).toEqual(expect.arrayContaining(['101', '103']));
    expect(obs.nodes.every(n => n.hierarchyResolutionContext.headerCandidateExcluded === false)).toBe(true);
  });
  it('通常の level_gap と header collision 関連の level_gap を区別できる（edgeContexts）', () => {
    const obs = run(headerDoc(), 'observe-only');
    const related = obs.headerCollisionObservation.edgeContexts.filter(e => e.parentHasHeaderEvidence || e.childHasHeaderEvidence || e.ancestorHasHeaderEvidence);
    expect(related.length).toBeGreaterThan(0);
    const off = run(headerDoc(), 'off');
    expect(off.headerCollisionObservation.nodesWithHeaderEvidence).toEqual([]); // off は観測しない（mode で区別）
    expect(off.headerCollisionObservation.mode).toBe('off');
  });
});

describe('provenance', () => {
  it('除外した行も node として残り、SourceToken・LogicalRow・x へ戻れ、理由が残る', () => {
    const doc = headerDoc();
    const r = run(doc, 'page-edge-domain');
    expect(r.nodes.length).toBe(observeDocumentHierarchy('detail', doc).nodes.length);
    for (const n of r.nodes.filter(x => x.hierarchyEligibility === 'excluded')) {
      const p = doc.find(x => x.meta.number === n.sourcePage)!;
      expect(n.sourceRowRefs.physicalRowIndexes).toEqual(p.logical.logicalRowCandidates[n.sourceRowRefs.logicalRowIndex].physicalRowIndexes);
      expect(p.tokens[n.sourceTokenRefs.keyTokenIndex].bbox.xMin).toBe(n.xIndentEvidence.keyTokenXMin);
      expect(n.hierarchyResolutionContext).toMatchObject({ headerCollisionObserved: true, headerCandidateExcluded: true });
      expect(n.hierarchyResolutionContext.exclusionEvidence.length).toBe(3);
    }
  });
});

describe('independence: A2 と B は独立に動く', () => {
  it('A2 off は v1 と同値', () => {
    const doc = headerDoc();
    const v1 = observeDocumentHierarchy('detail', doc);
    const off = run(doc, 'off');
    expect(off.edges).toEqual(v1.edges);
  });
  it('B off / A2 on: ヘッダ衝突だけを直し、single-organization は直さない', () => {
    const r = run(singleRootHeaderDoc(), 'page-edge-domain', 'off');
    expect(r.diagnostics.excludedCount).toBeGreaterThan(0);
    expect(node(r, 100, '501').xIndentEvidence.placed).toBe(false);
  });
  it('B on / A2 off: B の挙動はそのまま（ヘッダの根レベルが左にあると効かない）', () => {
    const r = run(singleRootHeaderDoc(), 'off', 'lattice-supported');
    expect(r.diagnostics.latticePlacedClusterCount).toBe(0);
    expect(node(r, 100, '501').xIndentEvidence.placed).toBe(false);
  });
  it('B+A2: どちらの成分も壊さず、両方の効果が出る。false parent の増加なし', () => {
    const doc = singleRootHeaderDoc();
    const ab = run(doc, 'page-edge-domain', 'lattice-supported');
    expect(node(ab, 100, '501').xIndentEvidence.level).toBe(1);
    expect(ab.diagnostics.excludedCount).toBeGreaterThan(0);
    expect(ab.diagnostics.latticePlacedClusterCount).toBe(1);
    // 通常（ヘッダなし・複数組織）では B+A2 は v1 と同じ
    const plain = [100, 101, 102].map(n => pageOf(n, [head('501', X.l1), head('502', X.l2), request('11', '01-95', X.l3), ...(n === 101 ? [head('506', X.l1)] : [])]));
    const v1 = observeDocumentHierarchy('detail', plain);
    expect(run(plain, 'page-edge-domain', 'lattice-supported').edges).toEqual(v1.edges);
  });
});

describe('決定性・variant 定義', () => {
  it('同じ入力で同じ結果（ページの与え順にも依存しない）', () => {
    for (const a of ['off', 'page-edge-domain', 'observe-only'] as const) {
      const x = JSON.stringify(run(singleRootHeaderDoc(), a, 'lattice-supported'));
      expect(JSON.stringify(run(singleRootHeaderDoc(), a, 'lattice-supported'))).toBe(x);
      expect(JSON.stringify(run([...singleRootHeaderDoc()].reverse(), a, 'lattice-supported'))).toBe(x);
    }
  });
  it('実験定義: A2 variant は事前登録どおり（page-edge-domain）で、B の option は lattice-supported', () => {
    const v = Object.fromEntries(A2_VARIANTS.map(x => [x.name, x.options]));
    expect(v['v2-A2']).toEqual({ headerCollisionHandling: 'page-edge-domain', singletonRootPlacement: 'off' });
    expect(v['v2-B']).toEqual({ headerCollisionHandling: 'off', singletonRootPlacement: 'lattice-supported' });
    expect(v['v2-B-A2']).toEqual({ headerCollisionHandling: 'page-edge-domain', singletonRootPlacement: 'lattice-supported' });
    expect(v['v2-B-obs']).toEqual({ headerCollisionHandling: 'observe-only', singletonRootPlacement: 'lattice-supported' });
    expect(A2_EXPERIMENTS.filter(e => e.set === 'a2-holdout')).toEqual([]); // holdout の範囲は規則固定とGT固定の後でだけ定義する
  });
});

describe('static: GT・凍結層・コード値に依存しない', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it('v2モジュールとA2ランナー・実験定義はGT・評価・凍結層をimportしない', () => {
    for (const f of ['budget-request-document-hierarchy-v2.ts', '../extract-budget-request-document-hierarchy-a2.ts', 'budget-request-document-hierarchy-a2-experiments.ts']) {
      const src = read(f);
      for (const m of src.matchAll(/from '([^']+)'/g)) expect(m[1], `${f}: ${m[1]}`).not.toMatch(/(eval|ground-truth|toc-hierarchy|spatial-region|region-relation|semantic-record|record-anchor|page-template)/);
      expect(strip(src)).not.toMatch(/ground-truth|toc-hierarchy-gt|hierarchy-gt|GroundTruth/);
    }
  });
  it('A2 の規則に省庁名・文書固有の値・固定割合の閾値を埋め込まない', () => {
    const code = strip(read('budget-request-document-hierarchy-v2.ts'));
    expect(code).not.toMatch(/METI|MEXT|MHLW|経済産業|文部科学|厚生労働|防衛|こども|経（中）|\b(0\.08|0\.94|37\.98)\b/);
  });
});

const targets = listExtractionTargets(getBudgetRequestManifest(2024));
const find = (u: string) => targets.find(t => t.canonicalUrl === u);
const METI = find('https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf');
const MAFF = find('https://www.maff.go.jp/j/budget/attach/pdf/230901-4.pdf');
const MLIT = find('https://www.mlit.go.jp/page/content/001630395.pdf');
const have = (t: typeof METI) => t !== undefined && fs.existsSync(t.localPath);
async function load(t: NonNullable<typeof METI>, a: number, b: number): Promise<HierarchyPageInput[]> {
  const out: HierarchyPageInput[] = [];
  for (let n = a; n <= b; n++) {
    const ex = await extractPageTokens(t.localPath, n);
    const geometry = buildTableGeometry(ex.tokens, ex.page);
    out.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
  }
  return out;
}

describe.skipIf(!have(METI))('development 実PDF: METI（positive）', () => {
  it('p104・p106 のヘッダ2行だけを3種のevidenceで除外し、組織が level 1 に戻り、063 の level_gap が解消する', async () => {
    const doc = await load(METI as NonNullable<typeof METI>, 82, 106);
    const r = run(doc, 'page-edge-domain');
    expect(r.nodes.filter(n => n.hierarchyEligibility === 'excluded').map(n => [n.sourcePage, n.observedCodeParts.code])).toEqual([[104, '100'], [106, '102']]);
    expect(node(r, 94, '060').xIndentEvidence.level).toBe(1);
    const item = node(r, 105, '063');
    expect(r.edges.find(e => e.childNodeId === item.id)!.status).toBe('resolved_by_indent_sequence');
  });
  it('ヘッダ衝突より前（p9–103）では何も除外せず v1 と同じ', async () => {
    const doc = await load(METI as NonNullable<typeof METI>, 9, 103);
    const r = run(doc, 'page-edge-domain');
    expect(r.diagnostics.excludedCount).toBe(0);
    expect(r.edges).toEqual(observeDocumentHierarchy('detail', doc).edges);
  });
});

describe.skipIf(!have(MAFF))('development 実PDF: 農水省復興特会（negative）', () => {
  it('v2-A が誤除外した要求 `56-65`（p13）を A2 は除外しない', async () => {
    const doc = await load(MAFF as NonNullable<typeof MAFF>, 7, 20);
    const a2 = run(doc, 'page-edge-domain');
    expect(a2.diagnostics.excludedCount).toBe(0);
    const req = a2.nodes.find(n => n.sourcePage === 13 && n.observedCodeParts.requestNo === '9')!;
    expect(req.hierarchyEligibility).toBe('candidate');
    expect(req.headerEvidenceObserved.some(e => e.kind === 'page_edge_row')).toBe(false);
    // v2-A（STOP）は同じ行を除外する（比較）
    expect(run(doc, 'observational-filter').nodes.find(n => n.id === req.id)!.hierarchyEligibility).toBe('excluded');
  });
});

describe.skipIf(!have(MLIT))('development 実PDF: MLIT復興特会（negative）', () => {
  it('v2-A が誤除外した本文行 `005`（p9）を A2 は除外しない（先頭0つきは頁番号の証拠にならない）', async () => {
    const doc = await load(MLIT as NonNullable<typeof MLIT>, 7, 10);
    const a2 = run(doc, 'page-edge-domain');
    expect(a2.diagnostics.excludedCount).toBe(0);
    const row = a2.nodes.find(n => n.sourcePage === 9 && n.observedCodeParts.code === '005')!;
    expect(row.hierarchyEligibility).toBe('candidate');
    expect(row.headerEvidenceObserved.some(e => e.kind === 'page_number_sequence')).toBe(false);
    expect(run(doc, 'observational-filter').nodes.find(n => n.id === row.id)!.hierarchyEligibility).toBe('excluded');
  });
});
