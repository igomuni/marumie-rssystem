import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { assignLevels, deriveProfile, findOrgSubtotalMarkers, isItemRow, rowNameFromTokens, type OrgSubtotalMarker, type ProfileRow, type TokenLite } from './budget-request-item-layout-profile';

const row = (page: number, y: number, kind: 'plain3' | 'request', deltaX: number | null, ruleX: number | null = 50.04): ProfileRow => ({ page, y, kind, deltaX, ruleX });
const doc: ProfileRow[] = [
  row(1, 125, 'plain3', 12.078), row(1, 139, 'plain3', 15.529), row(1, 153, 'request', 18.98),
  row(2, 125, 'plain3', 15.53), row(2, 139, 'request', 18.981), // 継続 page（組織は前 page から続く）
  row(3, 125, 'plain3', 12.078), row(3, 139, 'plain3', 15.531), row(3, 153, 'plain3', 15.527), row(3, 167, 'request', 18.979),
];
const markers: OrgSubtotalMarker[] = [{ page: 2, y: 200 }];
describe('assignLevels（marker の後の最初の plain3 を組織、以降を項、request を事項）', () => {
  it('継続 page の先頭 plain3 は項。marker 後の page 3 の先頭は組織', () => {
    const lv = assignLevels(doc, markers).map(l => l.level);
    expect(lv).toEqual(['organization', 'item', 'event', 'item', 'event', 'organization', 'item', 'item', 'event']);
  });
});
describe('deriveProfile', () => {
  it('level cluster・ruleX・tolerance（隣接 level 間隔の半分）を source から導出', () => {
    const p = deriveProfile(doc, markers);
    expect(p.valid).toBe(true);
    expect(p.ruleX).toBe(50.04);
    expect(p.organization!.deltaX).toBe(12.078); expect(p.item!.deltaX).toBe(15.527); // 同数なら最小値 expect(p.event!.deltaX).toBe(18.98);
    expect(p.tolerance).toBe(1.725);
    expect(p.item!.count).toBe(4); expect(p.evidence.levelCounts).toEqual({ organization: 2, item: 4, event: 3 });
  });
  it('level の順序が崩れる・spread が大きい・rule が一意でないと無効', () => {
    expect(deriveProfile([...doc, row(4, 1, 'plain3', 15.9)], markers).invalidReason).toBe('cluster_spread_exceeds_sanity');
    expect(deriveProfile(doc.map(r => ({ ...r, ruleX: r.page === 3 ? 60 : 50.04 })), markers).invalidReason).toBe('linked_rule_not_unique');
    expect(deriveProfile(doc.filter(r => r.kind === 'plain3'), markers).invalidReason).toBe('level_cluster_empty');
    expect(deriveProfile([row(1, 1, 'plain3', 20), row(1, 2, 'plain3', 15), row(1, 3, 'request', 10)], []).invalidReason).toBe('level_order_not_organization_item_event');
  });
});
describe('isItemRow', () => {
  const p = deriveProfile(doc, markers);
  it('項 cluster の plain3 だけ（組織・事項・別 rule は除外）', () => {
    expect(isItemRow(row(9, 1, 'plain3', 15.53), p)).toBe(true);
    expect(isItemRow(row(9, 1, 'plain3', 12.078), p)).toBe(false);
    expect(isItemRow(row(9, 1, 'plain3', 18.98), p)).toBe(false);
    expect(isItemRow(row(9, 1, 'request', 15.53), p)).toBe(false);
    expect(isItemRow(row(9, 1, 'plain3', 15.53, 60), p)).toBe(false);
    expect(isItemRow(row(9, 1, 'plain3', null), p)).toBe(false);
    expect(isItemRow(row(9, 1, 'plain3', 15.53), { ...p, valid: false })).toBe(false);
  });
});
describe('marker / name', () => {
  const t = (i: number, s: string, x: number, y: number): TokenLite => ({ index: i, rawText: s, bbox: { xMin: x, xMax: x + 5, yMin: y, yMax: y + 6 } });
  it('組織計 marker は「組」「織」「計」が同じ縦位置に揃う行だけ', () => {
    const toks = [t(0, '組', 96, 166.6), t(1, '織', 145, 166.6), t(2, '計', 193, 166.6), t(3, '組', 96, 300), t(4, '計', 193, 300)];
    expect(findOrgSubtotalMarkers(9, toks)).toEqual([{ page: 9, y: 166.5 }]);
  });
  it('名称は code の右・右境界の左の token を x 昇順に連結', () => {
    const toks = [t(0, '020', 62, 125), t(1, '知', 90, 125), t(2, '的', 100, 125), t(3, '246,000', 250, 125), t(4, '別行', 90, 200)];
    expect(rowNameFromTokens(toks, { yMin: 125, yMax: 131 }, 67, 246.75)).toBe('知的');
  });
});
describe('source scan（MOF・hierarchy・filename を参照しない）', () => {
  it('lib', () => {
    const src = fs.readFileSync('scripts/pipeline-v2/lib/budget-request-item-layout-profile.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const f of [/mof-|budget-jikou|MofBudget|mofJikou|normalized\/mof/i, /cao\.go\.jp|0\.pdf/, /observeDocumentHierarchy|hierarchyDependent/, /recordKind === 'item'/]) expect(f.test(src), String(f)).toBe(false);
  });
});
