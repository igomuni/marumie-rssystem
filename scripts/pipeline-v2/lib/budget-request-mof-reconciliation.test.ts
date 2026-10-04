import { describe, expect, it } from 'vitest';
import { decide, normalizeKey, reconcile, tally, type MofJikou, type MofSection, type PdfPopulationRecord } from './budget-request-mof-reconciliation';

const nm = (raw: string) => ({ raw, normalized: raw });
const org = (name: string | null) => ({ status: name ? 'resolved' : 'unresolved', reasonCode: null, ref: 'detail-p1-r1', recordKind: 'organization', name: name ? nm(name) : null, rawCode: '010' });
const item = (o: { row: number; name: string | null; org?: string | null; accountType?: string }): PdfPopulationRecord => ({
  runId: 'r', canonicalUrl: 'u', sourceAuthority: '経済産業省', accountType: o.accountType ?? 'general', page: 1, logicalRowIndex: o.row, recordKind: 'item', rawCode: '010',
  nameStatus: o.name ? 'resolved' : 'unresolved', name: o.name ? nm(o.name) : null, parentOrganization: org(o.org === undefined ? '経済産業本省' : o.org), parentItem: null,
});
const request = (over: { row: number; name: string | null; parentRow?: number; parent?: { status?: string; recordKind?: string } | null; account?: string }): PdfPopulationRecord => ({
  runId: 'r', canonicalUrl: 'u', sourceAuthority: '経済産業省', accountType: over.account ?? 'general', page: 1, logicalRowIndex: over.row, recordKind: 'request', rawCode: '01-95',
  nameStatus: over.name ? 'resolved' : 'ambiguous', name: over.name ? nm(over.name) : null, parentOrganization: org('経済産業本省'),
  parentItem: over.parent === null ? null : { status: 'resolved', reasonCode: null, ref: `detail-p1-r${over.parentRow ?? 2}`, recordKind: 'item', name: nm('経済産業本省共通費'), rawCode: '010', ...over.parent },
});
const sections: MofSection[] = [
  { id: 's1', organization: '経済産業本省', sectionName: '経済産業本省共通費' },
  { id: 's2', organization: '資源エネルギー庁', sectionName: '経済産業本省共通費' },
  { id: 's3', organization: '経済産業本省', sectionName: '経済構造改革推進費' },
  { id: 's4', organization: '経済産業本省', sectionName: '経済構造改革推進費' },
];
const jikou: MofJikou[] = [
  { parentSectionId: 's1', jikouName: '経済産業本省一般行政に必要な経費', recordId: 'j1' },
  { parentSectionId: 's1', jikouName: '審議会等に必要な経費', recordId: 'j2' },
  { parentSectionId: 's1', jikouName: '同名の経費', recordId: 'j3' },
  { parentSectionId: 's1', jikouName: '同名の経費', recordId: 'j4' },
  { parentSectionId: 's2', jikouName: '別の組織の経費', recordId: 'j5' },
];
const byRow = (res: ReturnType<typeof reconcile>, row: number, kind: string) => res.find(r => r.logicalRowIndex === row && r.recordKind === kind)!;

describe('normalizeKey', () => {
  it('NFKC と全空白の除去だけ（字間スペース・折返し改行・全角英数を同一視。語順変更・略称展開はしない）', () => {
    expect(normalizeKey('経 済 産 業 本 省 共 通 費')).toBe('経済産業本省共通費');
    expect(normalizeKey('経済産業本省一般行政に\n必要な経費')).toBe('経済産業本省一般行政に必要な経費');
    expect(normalizeKey('（ＮＰ）　A')).toBe('(NP)A');
    expect(normalizeKey('共通費経済産業本省')).not.toBe(normalizeKey('経済産業本省共通費'));
  });
});

describe('Stage 1: 項', () => {
  it('組織＋項名の完全一致で exact_unique / no_exact_match（コードや別組織の同名では救済しない）/ exact_ambiguous', () => {
    const pop = [
      item({ row: 2, name: '経 済 産 業 本 省 共 通 費' }),
      item({ row: 3, name: '存在しない項' }),
      item({ row: 4, name: '経済構造改革推進費' }),
      item({ row: 5, name: '経済産業本省共通費', org: '未知の組織' }),
      item({ row: 6, name: '経済構造改革推進費', org: '資源エネルギー庁' }),
    ];
    const r = reconcile(pop, sections, jikou);
    expect(byRow(r, 2, 'item')).toMatchObject({ classification: 'exact_unique', matchedId: 's1' });
    expect(byRow(r, 3, 'item')).toMatchObject({ classification: 'no_exact_match', diagnostic: 'item_name_differs_in_organization' });
    expect(byRow(r, 4, 'item')).toMatchObject({ classification: 'exact_ambiguous', candidateIds: ['s3', 's4'], matchedId: null });
    expect(byRow(r, 5, 'item')).toMatchObject({ classification: 'no_exact_match', diagnostic: 'mof_organization_absent' });
    expect(byRow(r, 6, 'item')).toMatchObject({ classification: 'no_exact_match', diagnostic: 'item_in_other_organization' });
  });
  it('優先順: 一般会計でない→out_of_scope、名称なし→name_unavailable、組織名なし→parent_unresolved', () => {
    const r = reconcile([item({ row: 2, name: '経済産業本省共通費', accountType: 'special' }), item({ row: 3, name: null }), item({ row: 4, name: '経済産業本省共通費', org: null })], sections, jikou);
    expect(r.map(x => x.classification)).toEqual(['out_of_scope', 'name_unavailable', 'parent_unresolved']);
    expect(r[2].reason).toBe('organization_unresolved');
  });
});

describe('Stage 2: 事項（親の項が exact_unique のときだけ。global な救済なし）', () => {
  const pop = [
    item({ row: 2, name: '経済産業本省共通費' }),
    request({ row: 3, name: '経済産業本省一般行政に\n必要な経費' }),
    request({ row: 4, name: '別の組織の経費' }),
    request({ row: 5, name: '同名の経費' }),
    request({ row: 6, name: '審議会等に必要な' }),
    request({ row: 7, name: '審議会等に必要な経費です' }),
    request({ row: 8, name: '全く別の経費' }),
    request({ row: 9, name: null }),
    request({ row: 10, name: '審議会等に必要な経費', parent: null }),
    request({ row: 11, name: '審議会等に必要な経費', parent: { status: 'unresolved' } }),
    request({ row: 12, name: '審議会等に必要な経費', parent: { recordKind: 'unclassified' } }),
    request({ row: 13, name: '審議会等に必要な経費', account: 'special' }),
  ];
  const r = reconcile(pop, sections, jikou);
  it('親が一意なら section 配下の完全一致だけで exact_unique、他の組織の事項は救済しない', () => {
    expect(byRow(r, 3, 'request')).toMatchObject({ classification: 'exact_unique', matchedId: 'j1' });
    expect(byRow(r, 4, 'request')).toMatchObject({ classification: 'no_exact_match', diagnostic: 'request_name_differs_under_parent' });
    expect(byRow(r, 5, 'request')).toMatchObject({ classification: 'exact_ambiguous', candidateIds: ['j3', 'j4'] });
  });
  it('名称の途中切れ（PDF が MOF の真の接頭辞）などを診断し、正式な match には昇格させない', () => {
    expect(byRow(r, 6, 'request')).toMatchObject({ classification: 'no_exact_match', diagnostic: 'request_name_is_prefix_of_mof' });
    expect(byRow(r, 7, 'request')).toMatchObject({ classification: 'no_exact_match', diagnostic: 'mof_name_is_prefix_of_pdf' });
    expect(byRow(r, 8, 'request').classification).toBe('no_exact_match');
  });
  it('名称なし・親なし/未解決/item 種別でない・一般会計外は理由付きで分類される', () => {
    expect(byRow(r, 9, 'request').classification).toBe('name_unavailable');
    expect(byRow(r, 10, 'request')).toMatchObject({ classification: 'parent_unresolved', reason: 'parent_item_not_observed' });
    expect(byRow(r, 11, 'request')).toMatchObject({ classification: 'parent_unresolved', reason: 'parent_item_unresolved' });
    expect(byRow(r, 12, 'request')).toMatchObject({ classification: 'parent_unresolved', reason: 'parent_item_not_item_kind' });
    expect(byRow(r, 13, 'request').classification).toBe('out_of_scope');
  });
  it('親の項が no_exact_match / exact_ambiguous の request は parent_unresolved（事項だけの検索で救済しない）', () => {
    const p2 = [item({ row: 2, name: '存在しない項' }), request({ row: 3, name: '審議会等に必要な経費' }), item({ row: 4, name: '経済構造改革推進費' }), request({ row: 5, name: '審議会等に必要な経費', parentRow: 4 })];
    const rr = reconcile(p2, sections, jikou);
    expect(byRow(rr, 3, 'request')).toMatchObject({ classification: 'parent_unresolved', reason: 'parent_item_no_match' });
    expect(byRow(rr, 5, 'request')).toMatchObject({ classification: 'parent_unresolved', reason: 'parent_item_ambiguous' });
  });
});

describe('tally / decide（preregistration §9）', () => {
  const mk = (cls: string, diag: string | null) => ({ classification: cls, diagnostic: diag }) as never;
  it('tally は分類別の件数と exact unique rate', () => {
    const rows = reconcile([item({ row: 2, name: '経済産業本省共通費' }), item({ row: 3, name: '存在しない項' })], sections, jikou);
    expect(tally(rows)).toMatchObject({ total: 2, exactUniqueRate: 0.5, byClass: { exact_unique: 1, no_exact_match: 1 } });
  });
  it('比較可能な record が 0 なら STOP。分類率 90% 以上かつ最多カテゴリ 30% 以上なら GO_TO_NEXT_DESIGN、それ以外は NEEDS_MORE_ISOLATION', () => {
    expect(decide([], 0).decision).toBe('STOP');
    const go = [...Array(6).fill(0).map(() => mk('no_exact_match', 'request_name_is_prefix_of_mof')), ...Array(3).fill(0).map(() => mk('no_exact_match', 'item_name_differs_in_organization')), mk('exact_unique', null)];
    expect(decide(go, 10).decision).toBe('GO_TO_NEXT_DESIGN');
    const unknownHeavy = [...Array(5).fill(0).map(() => mk('exact_ambiguous', null)), ...Array(5).fill(0).map(() => mk('no_exact_match', 'request_name_is_prefix_of_mof'))];
    expect(decide(unknownHeavy, 10).decision).toBe('NEEDS_MORE_ISOLATION');
    const flat = Array.from({ length: 10 }, (_, i) => mk('no_exact_match', `cat${i}`));
    expect(decide(flat, 10).decision).toBe('NEEDS_MORE_ISOLATION');
  });
});
