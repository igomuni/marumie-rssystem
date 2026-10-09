import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import type { PageOut, RowOut } from './budget-request-toc-row-assembly';
import type { GtPage, GtRow } from './budget-request-toc-row-assembly-evaluator';
import { censusPage, tally, type PageMeta } from './budget-request-toc-evaluator-ambiguity';

// synthetic のみ（data/work・PDF・raw-text は不要）
const P = 'x/a.pdf';
const META: PageMeta = { localPdfPath: P, physicalPage: 3, partition: 'SYNTH', classifierSource: 'DIRECT' };
const prov = (lineIndex: number, slice: string) => ({ localPdfPath: P, pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: 'b'.repeat(64), lineIndex, charStart: 0, charEnd: slice.length, sourceRawSlice: slice });
let so = 0;
const unit = (column: 'LEFT' | 'RIGHT' | 'UNSPLIT', kind: 'REQUEST_NUMBER_ROW' | 'MARKER_ROW', token: string, code: string | null, frag = 0, o: Partial<RowOut> = {}): RowOut => {
  const line = so++;
  return { column, sourceOrder: line, rowKind: kind, rowStartTokenRaw: token, codeRaw: code, titleRaw: null, pageRefRaw: null, fragments: Array.from({ length: frag }, () => ({ textRaw: 'f', provenance: prov(line, 'f') })), provenance: prov(line, `${token} ${code ?? ''}`), state: 'RESOLVED', abstentionReason: null, ...o };
};
const mk = (...rows: RowOut[]): PageOut => { so = 0; return { localPdfPath: P, pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: 'b'.repeat(64), classifierSource: 'DIRECT', pageState: 'ASSEMBLED_SPLIT', pageAbstentionReason: null, rightBandEdge: 40, rows }; };
const gRow = (column: 'LEFT' | 'RIGHT', order: number, kind: 'REQUEST_NUMBER_ROW' | 'MARKER_ROW', code: string, o: Partial<GtRow> = {}): GtRow => ({ rowId: `${P}#3:${column}:${order}`, column, orderInColumn: order, rowKindVisual: kind, requestNumberVisualToken: kind === 'REQUEST_NUMBER_ROW' ? code : null, codeVisual: kind === 'REQUEST_NUMBER_ROW' ? '01-95' : code, markerVisual: kind === 'MARKER_ROW' ? '（項）' : null, pageRefVisual: '1', wrappedFragmentCount: 0, ...o });
const gM = (column: 'LEFT' | 'RIGHT', order: number, code: string, o: Partial<GtRow> = {}) => gRow(column, order, 'MARKER_ROW', code, o);
const gt = (rows: GtRow[], fragments: GtPage['fragments'] = [], right: 'ROWS' | 'BLANK_NO_ROWS' = 'ROWS'): GtPage => ({ localPdfPath: P, pdfSha256: 'a'.repeat(64), physicalPage: 3, textSha256: '', classifierSource: 'DIRECT', rightColumnVisual: right, gtPageComplete: true, rows, fragments });
const pm = (column: 'LEFT' | 'RIGHT' | 'UNSPLIT', code: string, frag = 0) => unit(column, 'MARKER_ROW', '（項）', code, frag);
const pr = (column: 'LEFT' | 'RIGHT' | 'UNSPLIT', n: string, frag = 0) => unit(column, 'REQUEST_NUMBER_ROW', `${n}    01-95`, '01-95', frag);

describe('evaluator ambiguity census（synthetic）', () => {
  it('衝突なし: collision 0・key 数のみ集計', () => {
    const c = censusPage(META, mk(pm('LEFT', '010'), pr('LEFT', '1')), gt([gM('LEFT', 1, '010'), gRow('LEFT', 2, 'REQUEST_NUMBER_ROW', '1')]));
    expect(c.collisions).toEqual([]); expect(c.parser).toMatchObject({ markerUnits: 1, markerUnique: 1, requestUnits: 1, requestUnique: 1 });
    expect(c.gt).toMatchObject({ markerRows: 1, requestRows: 1, plainRows: 0 });
  });
  it('n=m=2 で全 matched・fragment 関係なし: DUPLICATE_ONLY_NO_EVAL_EFFECT + latent limitation', () => {
    const c = censusPage(META, mk(pm('LEFT', '010'), pm('LEFT', '010')), gt([gM('LEFT', 1, '010'), gM('LEFT', 2, '010')]));
    expect(c.collisions).toHaveLength(1);
    expect(c.collisions[0]).toMatchObject({ key: 'M|（項）|010', kind: 'MARKER', n: 2, m: 2, side: 'BOTH', classification: 'DUPLICATE_ONLY_NO_EVAL_EFFECT' });
    expect(c.collisions[0].latentLimitations).toEqual(['ORDER_INVERSION_NOT_EVALUATED', 'SAME_KEY_MERGE_NOT_DETECTABLE']);
  });
  it('GT occurrence が LEFT/RIGHT に跨ると COLUMN_MULTISET_ONLY を latent に追加', () => {
    const c = censusPage(META, mk(pm('LEFT', '010'), pm('RIGHT', '010')), gt([gM('LEFT', 1, '010'), gM('RIGHT', 1, '010')]));
    expect(c.collisions[0].classification).toBe('DUPLICATE_ONLY_NO_EVAL_EFFECT');
    expect(c.collisions[0].latentLimitations).toContain('COLUMN_MULTISET_ONLY');
  });
  it('fragment が collision group の owner: FRAGMENT_OWNER_AMBIGUITY（GT 側・parser 側の件数を示す）', () => {
    const rows = [gM('LEFT', 1, '010', { wrappedFragmentCount: 1 }), gM('LEFT', 2, '010')];
    const c = censusPage(META, mk(pm('LEFT', '010', 1), pm('LEFT', '010')), gt(rows, [{ fragmentId: `${P}#3:LEFT:1+f1`, ownerRowId: rows[0].rowId, column: 'LEFT', orderInOwner: 1 }]));
    expect(c.collisions[0]).toMatchObject({ classification: 'FRAGMENT_OWNER_AMBIGUITY', gtFragmentsOnKey: 1, parserFragmentsOnKey: 1, evaluatorOwnerUnresolved: 2 });
    expect(c.evaluator?.ownerGroupInstances).toBe(2);
  });
  it('n≠m の collision: ROW_MATCHING_AMBIGUITY。fragment も絡めば MULTIPLE_EFFECTS', () => {
    const a = censusPage(META, mk(pm('LEFT', '010')), gt([gM('LEFT', 1, '010'), gM('LEFT', 2, '010')]));
    expect(a.collisions[0]).toMatchObject({ n: 2, m: 1, classification: 'ROW_MATCHING_AMBIGUITY' });
    const rows = [gM('LEFT', 1, '010', { wrappedFragmentCount: 1 }), gM('LEFT', 2, '010')];
    const b = censusPage(META, mk(pm('LEFT', '010', 1)), gt(rows, [{ fragmentId: 'f', ownerRowId: rows[0].rowId, column: 'LEFT', orderInOwner: 1 }]));
    expect(b.collisions[0].classification).toBe('MULTIPLE_EFFECTS');
  });
  it('parser 側のみ 2 件（GT は 1 件）: 余剰 unit で ROW_MATCHING_AMBIGUITY・side=PARSER', () => {
    const c = censusPage(META, mk(pm('LEFT', '010'), pm('LEFT', '010')), gt([gM('LEFT', 1, '010')]));
    expect(c.collisions[0]).toMatchObject({ n: 1, m: 2, side: 'PARSER', classification: 'ROW_MATCHING_AMBIGUITY' });
  });
  it('non-duplicate の non-1:1 group（n=1, m=0）は collision ではなく otherNonOneToOne', () => {
    const c = censusPage(META, mk(pm('LEFT', '010')), gt([gM('LEFT', 1, '010'), gM('LEFT', 2, '020')]));
    expect(c.collisions).toEqual([]);
    expect(c.otherNonOneToOne).toMatchObject([{ key: 'M|（項）|020', n: 1, m: 0 }]);
  });
  it('GT なしページ: NOT_EVALUABLE_NO_GT。parser 側の fragment 関係のみ示す', () => {
    const c = censusPage(META, mk(pm('LEFT', '010', 1), pm('LEFT', '010')), null);
    expect(c.gtAvailable).toBe(false); expect(c.gt).toBeNull(); expect(c.evaluator).toBeNull();
    expect(c.collisions[0]).toMatchObject({ n: null, m: 2, side: 'PARSER_ONLY_NO_GT', classification: 'NOT_EVALUABLE_NO_GT', gtFragmentsOnKey: null, parserFragmentsOnKey: 1 });
  });
  it('PAGE_ABSTAINED の GT ありページ: NOT_EVALUATED_PAGE_ABSTAINED（evaluator は group を作らない）', () => {
    const p = mk(); p.pageState = 'PAGE_ABSTAINED'; p.pageAbstentionReason = 'RIGHT_EVIDENCE_INSUFFICIENT';
    const c = censusPage(META, p, gt([gM('LEFT', 1, '010'), gM('LEFT', 2, '010')]));
    expect(c.collisions[0]).toMatchObject({ n: 2, m: 0, classification: 'NOT_EVALUATED_PAGE_ABSTAINED' });
  });
  it('dummy raw でも例外なし・provenance 由来の instance は含まれない', () => {
    const c = censusPage(META, mk(pm('LEFT', '010')), gt([gM('LEFT', 1, '010')]));
    expect(c.evaluator?.pageOutcome).toBeDefined();
  });
  it('直前の（組織）code を occurrence の事実として記録する（identity には使わない）', () => {
    const org = (code: string) => unit('LEFT', 'MARKER_ROW', '（組織）', code);
    const c = censusPage(META, mk(org('040'), pm('LEFT', '010'), org('060'), pm('LEFT', '010')), null);
    expect(c.collisions[0].occurrences.map(o => o.precedingOrgCode)).toEqual(['040', '060']);
  });
  it('tally: 件数集計', () => {
    const a = censusPage(META, mk(pm('LEFT', '010'), pm('LEFT', '010')), gt([gM('LEFT', 1, '010'), gM('LEFT', 2, '010')]));
    const b = censusPage(META, mk(pm('LEFT', '020')), gt([gM('LEFT', 1, '020')]));
    expect(tally([a, b])).toMatchObject({ pages: 2, markerUnits: 3, markerUnique: 2, duplicateKeys: 1, duplicateKeysMarker: 1, pagesWithDuplicate: 1, classification: { DUPLICATE_ONLY_NO_EVAL_EFFECT: 1 } });
  });
});

// ---- census fixture の integrity（commit 済み artifact のみ）----
const read = (...p: string[]) => JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', ...p), 'utf8'));
const census = read('budget-request-toc-evaluator-ambiguity-failure-isolation', '2024', 'census.json');
const status = read('budget-request-toc-full-corpus-status', '2024', 'full-corpus-status.json');

describe('census fixture の integrity', () => {
  it('82 page・partition 34/23/25・GT 48 page、status と page 順が一致', () => {
    expect(census.pages).toHaveLength(82);
    expect(census.populations.partitions).toEqual({ DEVELOPMENT_EXPLORED: 34, FIRST_HELDOUT_POSTHOC: 23, NEW_HELDOUT_POSTHOC: 25 });
    expect(census.populations.gtAvailable).toBe(48);
    expect(census.pages.map((p: PageMeta) => `${p.localPdfPath}#${p.physicalPage}:${p.partition}`)).toEqual(status.pages.map((p: PageMeta) => `${p.localPdfPath}#${p.physicalPage}:${p.partition}`));
  });
  it('GT 母集団の key 件数が committed GT counts と一致', () => {
    expect(census.gtAccounting.first23).toMatchObject({ rows: 834, request: 492, marker: 310, plain: 32, fragments: 17 });
    expect(census.gtAccounting.new25).toMatchObject({ rows: 614, request: 303, marker: 257, plain: 54, fragments: 3 });
    for (const k of ['first23', 'new25'] as const) { const a = census.gtAccounting[k]; expect(a.committedCounts.byRowKind).toEqual({ REQUEST_NUMBER_ROW: a.request, MARKER_ROW: a.marker, PLAIN_ROW: a.plain }); }
  });
  it('H3 は committed observations（#404）と一致して再現される', () => {
    expect(census.validation.h3.reproducesObservations404).toBe(true);
    const c = census.validation.h3.collisions.find((x: { key: string }) => x.key === 'M|（項）|030');
    expect(c).toMatchObject({ n: 2, m: 2, classification: 'FRAGMENT_OWNER_AMBIGUITY', gtFragmentsOnKey: 1, parserFragmentsOnKey: 1, evaluatorOwnerUnresolved: 2 });
  });
  it('committed 評価結果（#396 記録 / #402 / #403）と整合', () => {
    const v = census.validation;
    expect(v.committed396_oldParser_recordedFacts).toMatchObject({ nonOneToOneGroups: 26, pages: 7, n1m0MergeGroups: 9, unresolvedByFamily: { AMBIGUOUS_OWNER_GROUP: 3 } });
    expect(v.committed402).toMatchObject({ allGroupsFragmentsInstancesEqual: true, nonOneToOneGroups: 22, allNEqM: true, blockingUnresolved: 0, recomputedNew25DuplicateGroups: 22 });
    expect(v.committed403_first23_posthoc).toMatchObject({ equal: true, recomputedFragmentsUnresolved: 2, recomputedFirst23DuplicateGroups: 17 });
  });
  it('分類は fixture 内で閉じている（集計 = collision 一覧）', () => {
    const all = census.pages.flatMap((p: { collisions: { classification: string }[] }) => p.collisions);
    expect(census.tallies.all82.duplicateKeys).toBe(all.length);
    const byClass: Record<string, number> = {}; for (const c of all) byClass[c.classification] = (byClass[c.classification] ?? 0) + 1;
    expect(census.tallies.all82.classification).toEqual(byClass);
    expect(census.tallies.dev34_noGt.classification).toEqual({ NOT_EVALUABLE_NO_GT: census.dev34ParserOnly.duplicateGroups });
  });
  it('fixture に絶対パスを含まない', () => {
    expect(JSON.stringify(census)).not.toMatch(/\/Users\/|[A-Z]:\\/);
  });
});
