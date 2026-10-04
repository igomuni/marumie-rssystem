import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import type { MofXmlItemRecord } from './mof-budget-xml-items';
import { JIKOU_CONTEXT_FY2024_GENERAL_INITIAL as CTX, mapParserRecordToJikou, ministryFromMenuChain, sortJikou, validateJikouRecords } from './mof-jikou';
import { sectionNaturalKey } from './mof-keys';
import { sectionKeyOf } from './mof-sections';
import { stableId } from './stable-id';

const base = (over: Partial<MofXmlItemRecord> = {}): MofXmlItemRecord => ({
  file: '202411001000265b.xml', row: 'p265-4.1', page: 265, rowNo: 4, organization: '皇室費',
  itemCode: '001', itemName: '内廷費', itemNameLines: ['内廷費'], itemQtCount: 0, itemGaiji: [], itemStartsInThisRow: true,
  requestName: '内廷に必要な経費', requestNameLines: ['内廷に必要な経費'], requestQtCount: 0, requestGaiji: [],
  col4Raw: '95', amountsRaw: { col6: '324,000', col8: '324,000', col10: '0' }, amountsThousandYen: { col6: 324000, col8: 324000, col10: 0 }, ...over,
});
const map = (r: MofXmlItemRecord, ministry = '皇室費') => mapParserRecordToJikou(r, CTX, ministry, 'a'.repeat(64));

describe('ministryFromMenuChain', () => {
  it('「甲号予定経費要求書」の直前の要素から末尾の「所管」を除く（皇室費は所管の語なし）', () => {
    expect(ministryFromMenuChain(['令和6年度一般会計予算参照書', '令和6年度一般会計各省各庁予定経費要求書等', '内閣府所管', '甲号予定経費要求書', '内閣本府'])).toBe('内閣府');
    expect(ministryFromMenuChain(['x', 'y', '皇室費', '甲号予定経費要求書', '〔組織別事項別内訳〕'])).toBe('皇室費');
  });
  it('marker が無ければ throw（推測しない）', () => {
    expect(() => ministryFromMenuChain(['a', 'b'])).toThrow();
    expect(() => ministryFromMenuChain(['甲号予定経費要求書'])).toThrow();
  });
});

describe('mapParserRecordToJikou', () => {
  it('parser の値を変質させない（金額は整数 ×1000・raw 保持・col4Raw は semantic-neutral のまま・blank→0 なし）', () => {
    const r = map(base({ amountsRaw: { col6: '5,847,144', col8: '5,854,454', col10: '△ 7,310' }, amountsThousandYen: { col6: 5847144, col8: 5854454, col10: -7310 } }));
    expect(r).toMatchObject({ amountYen: 5847144000, previousAmountYen: 5854454000, differenceYen: -7310000, col4Raw: '95', amountsRawThousand: { current: '5,847,144', previous: '5,854,454', difference: '△ 7,310' } });
    expect(map(base({ amountsThousandYen: { col6: 0, col8: 0, col10: 0 }, amountsRaw: { col6: '0', col8: '0', col10: '0' } }))).toMatchObject({ amountYen: 0, previousAmountYen: 0, differenceYen: 0 });
    expect(Object.keys(r)).not.toContain('majorExpenseCode');
  });
  it('親の項は既存 V2 の key / id と同じ関数で決まる', () => {
    const r = map(base());
    const scope = { ministry: '皇室費', organization: '皇室費', specialAccount: '', subAccount: '', agency: '' };
    expect(r.sectionNaturalKey).toBe(sectionNaturalKey('general', scope, '001', '内廷費'));
    expect(r.parentSectionId).toBe(stableId([sectionKeyOf({ accountType: 'general', ...scope, sectionCode: '001', sectionName: '内廷費' })], 'mofsec_'));
  });
  it('recordId は決定的で、事項名単独ではなく親の項を含む（同名事項が別の項にあっても衝突せず、頁・行には依存しない）', () => {
    const a = map(base({ requestName: '同名の経費' }));
    const b = map(base({ itemCode: '002', itemName: '宮廷費', requestName: '同名の経費' }));
    expect(a.recordId).not.toBe(b.recordId);
    expect(map(base({ requestName: '同名の経費', row: 'p999-9.1', page: 999, rowNo: 9 })).recordId).toBe(a.recordId);
    expect(a.recordId).toMatch(/^mofjik_[0-9a-f]{20}$/);
  });
  it('provenance（source・locator・file の SHA-256）と source-faithful な名称表現を保持する', () => {
    const r = map(base({ requestNameLines: ['国際観光旅客税財', '源宮廷に必要な経', '費'], requestName: '国際観光旅客税財源宮廷に必要な経費', requestQtCount: 2, requestGaiji: [{ code: '1508', text: '填' }] }));
    expect(r.source).toMatchObject({ domain: 'mof.go.jp', file: '202411001000265b.xml', path: 'mof.go.jp/archive/2024/2024/xml/202411001000265b.xml', sourceUrl: 'https://www.bb.mof.go.jp/server/2024/xml/202411001000265b.xml' });
    expect(r.sourceLocator).toEqual({ documentId: '202411001', row: 'p265-4.1', page: 265, rowNo: 4, sourceSha256: 'a'.repeat(64) });
    expect(r).toMatchObject({ jikouNameLines: ['国際観光旅客税財', '源宮廷に必要な経', '費'], nameQtCount: 2, nameGaiji: [{ code: '1508', text: '填' }] });
  });
});

describe('frozen hand-checked fixture の期待値を写像しても金額・名称が変質しない', () => {
  const hand = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024', '202411001-hand-checked-fixture.json'), 'utf8')) as { rows: { expected: MofXmlItemRecord }[] };
  it.each(hand.rows.map(h => [`${h.expected.file} ${h.expected.row}`, h.expected] as const))('%s', (_n, e) => {
    const r = map(e, e.organization);
    expect(r.amountYen).toBe(e.amountsThousandYen.col6 * 1000);
    expect(r.previousAmountYen).toBe(e.amountsThousandYen.col8 * 1000);
    expect(r.differenceYen).toBe(e.amountsThousandYen.col10 * 1000);
    expect([r.jikouName, r.col4Raw, r.sectionCode, r.sectionName, r.organization]).toEqual([e.requestName, e.col4Raw, e.itemCode, e.itemName, e.organization]);
  });
});

describe('validateJikouRecords', () => {
  const a = map(base());
  const b = map(base({ row: 'p265-5.1', rowNo: 5, requestName: '別の事項' }));
  const keys = new Set([a.sectionNaturalKey]);
  const ids = new Set([a.parentSectionId]);
  it('健全な record 群は問題なし', () => {
    expect(validateJikouRecords([a, b], keys, ids)).toMatchObject({ recordCount: 2, duplicateRecordIds: [], missingRequiredFields: [], missingProvenance: [], orphanParent: [], ambiguousParent: [], notInDocumentOrder: 0, parentResolved: { both: 2 } });
  });
  it('recordId の重複・親の未解決・片方だけ解決（不整合）・順序違反・provenance 欠落を検出する', () => {
    expect(validateJikouRecords([a, { ...b, recordId: a.recordId }], keys, ids).duplicateRecordIds).toEqual([a.recordId]);
    expect(validateJikouRecords([a, b], new Set(), new Set()).orphanParent).toHaveLength(2);
    expect(validateJikouRecords([a, b], keys, new Set()).ambiguousParent).toHaveLength(2);
    expect(validateJikouRecords([b, a], keys, ids).notInDocumentOrder).toBe(1);
    expect(validateJikouRecords([{ ...a, source: { ...a.source, sourceUrl: '' } }], keys, ids).missingProvenance).toHaveLength(1);
    expect(validateJikouRecords([{ ...a, jikouName: '' }], keys, ids).missingRequiredFields).toEqual([{ recordId: a.recordId, field: 'jikouName' }]);
  });
  it('sortJikou は file → 頁 → 行の決定的な順序', () => {
    expect(sortJikou([b, a]).map(r => r.sourceLocator.rowNo)).toEqual([4, 5]);
  });
});
