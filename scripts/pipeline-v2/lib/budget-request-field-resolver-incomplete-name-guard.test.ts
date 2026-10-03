import { describe, expect, it } from 'vitest';
import { buildTableGeometry } from './budget-request-table-geometry';
import { resolveLogicalRows } from './budget-request-logical-row';
import { pageMetaFrom, toSourceToken, type RawTextItem, type SourceToken } from './budget-request-source-token';
import { INCOMPLETE_NAME_GUARD_REASON, resolveFields, serializeFieldResolverResult, type FieldResolverPageInput, type FieldResolverResult } from './budget-request-field-resolver';

const meta = pageMetaFrom(1, 1, [0, 0, 842, 595], 0);
const styles = { f1: { ascent: 0.859, descent: -0.141 } };
const FS = 6.944;
const tok = (text: string, x: number, baselineTop: number, width?: number): SourceToken => {
  const item: RawTextItem = { str: text, transform: [FS, 0, 0, FS, x, 595 - baselineTop], width: width ?? text.length * FS, height: FS, fontName: 'f1', hasEOL: false, dir: 'ltr' };
  return toSourceToken(item, 0, meta, styles);
};
const header = (y = 80): SourceToken[] => {
  const g = (chars: string, x0: number, step: number) => [...chars].map((c, i) => tok(c, x0 + i * step, y, 7));
  return [...g('前年度', 207.1, 19), ...g('予算額', 207.1, 19).map(t => ({ ...t, bbox: { ...t.bbox, yMin: t.bbox.yMin + 7, yMax: t.bbox.yMax + 7 } })), tok('概 算 要 求 額', 258.8, y + 7, 45.2), ...g('対前年度', 414.1, 14)];
};
const amount = (text: string, rightEdge: number, y: number): SourceToken[] => {
  const chunks = text.split(',').map((c, i, a) => (i < a.length - 1 ? `${c},` : c));
  const out: SourceToken[] = [];
  let x = rightEdge;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const w = chunks[i].length * 3.4;
    out.push(tok(chunks[i], x - w, y, w));
    x -= w + 1.5;
  }
  return out;
};
const PREV = 255.4, REQ = 307.2, DIFF = 462.5;
const NAME_X = 160;

function pageOf(tokens: SourceToken[]): FieldResolverPageInput {
  const indexed = tokens.map((t, i) => ({ ...t, index: i, page: 1 }));
  const geometry = buildTableGeometry(indexed, meta);
  return { meta, tokens: indexed, geometry, logical: resolveLogicalRows(indexed, meta, geometry) };
}
const run = (tokens: SourceToken[], guard?: boolean): FieldResolverResult => resolveFields({ pages: [pageOf(tokens)], hierarchy: null, ...(guard === undefined ? {} : { incompleteNameGuard: guard }) });
const rec = (r: FieldResolverResult, code: string) => r.records.find(x => x.rowLocal.code.value?.raw === code)!;

interface Variant { dy?: number; successorX?: number; successorFirst?: string; successorAmount?: boolean; blankAmounts?: boolean }
/** 3 桁 code の record の直下に、備考側 segment（x=470）を持つ後続行を置く。備考側だけが揃わないので LogicalRow は結合しない */
function page(v: Variant = {}): SourceToken[] {
  const y = 120;
  const record = [tok('003', 128, y, 24), tok('例の名称', NAME_X, y, 28), ...(v.blankAmounts ? [] : [...amount('100', PREV, y), ...amount('200', REQ, y), ...amount('100', DIFF, y)])];
  const sy = y + (v.dy ?? 6.944);
  const succ = [tok(v.successorFirst ?? '続きの行', v.successorX ?? NAME_X, sy, 28), tok('備考の文', 470, sy, 40), ...(v.successorAmount ? amount('50', PREV, sy) : [])];
  // 後続行の更に下に、名称側・備考側ともに揃う行を置く。LogicalRow はこれを後続行へ連鎖させ、後続行の最初の ambiguous が出力から消える（failure isolation の再現）
  const chained = [tok('更に続く行', v.successorX ?? NAME_X, sy + 6.944, 28), tok('備考の続き', 470, sy + 6.944, 40)];
  return [...header(), ...record, ...succ, ...chained];
}

const fires = (v: Variant) => rec(run(page(v), true), '003').rowLocal.name.status === 'ambiguous' && rec(run(page(v), true), '003').rowLocal.name.reasonCode === INCOMPLETE_NAME_GUARD_REASON;

describe('incomplete-name guard（事前登録 A ∧ B ∧ ¬C ∧ ¬D の転記）', () => {
  it('A・B が成り立ち、C・D が成り立たなければ発火し、name だけが resolved → ambiguous（value null・断片の evidence を candidate に 1 つ）', () => {
    expect(rec(run(page(), false), '003').rowLocal.name.status).toBe('resolved');
    const name = rec(run(page(), true), '003').rowLocal.name;
    expect(name).toMatchObject({ status: 'ambiguous', value: null, reasonCode: INCOMPLETE_NAME_GUARD_REASON, evidence: null });
    expect(name.candidates).toHaveLength(1);
    // 断片は baseline の名称の evidence と同じ token・同じ文字列（後続行の文字列は入れない）
    const base = rec(run(page(), false), '003').rowLocal.name;
    expect(name.candidates![0].sourceTokenRefs).toEqual(base.evidence!.sourceTokenRefs);
    expect(name.candidates![0].rawText).toBe(base.evidence!.rawText);
    expect(JSON.stringify(name)).not.toContain('続きの行');
  });
  it('A が偽（直下でない）なら発火しない。範囲の境界（基準フォントの 1.5 倍 = 10.416pt）', () => {
    expect(fires({ dy: 14 })).toBe(false);
    expect(fires({ dy: 10.2 })).toBe(true);
    expect(fires({ dy: 10.7 })).toBe(false);
  });
  it('B が偽（名称 x が揃わない）なら発火しない。許容の境界（基準フォントの 0.25 倍 = 1.736pt）', () => {
    expect(fires({ successorX: NAME_X + 15 })).toBe(false);
    expect(fires({ successorX: NAME_X + 1.5 })).toBe(true);
    expect(fires({ successorX: NAME_X + 2.0 })).toBe(false);
  });
  it('C が真（後続が record の code で始まる）なら発火しない', () => {
    expect(fires({ successorFirst: '004' })).toBe(false);
  });
  it('D が真（後続が金額セルに token を持つ）なら発火しない', () => {
    expect(fires({ successorAmount: true })).toBe(false);
  });
  it('option off（既定）の出力は option を渡さない場合・false を渡した場合と byte-identical で、guard の条件が成り立つページでも変わらない', () => {
    const a = serializeFieldResolverResult(run(page()));
    expect(serializeFieldResolverResult(run(page(), false))).toBe(a);
    expect(rec(run(page()), '003').rowLocal.name.status).toBe('resolved');
  });
  it('発火しないページでは on と off の出力は全体が byte-identical', () => {
    for (const v of [{ dy: 14 }, { successorFirst: '004' }, { successorAmount: true }, { successorX: NAME_X + 15 }]) {
      expect(serializeFieldResolverResult(run(page(v), true))).toBe(serializeFieldResolverResult(run(page(v), false)));
    }
  });
  it('発火しても name 以外の field は変わらない。金額が空欄の record でも blank は unresolved にならない', () => {
    for (const v of [{}, { blankAmounts: true }]) {
      const off = rec(run(page(v), false), '003');
      const on = rec(run(page(v), true), '003');
      const { name: _a, ...offRest } = off.rowLocal; // eslint-disable-line @typescript-eslint/no-unused-vars
      const { name: _b, ...onRest } = on.rowLocal; // eslint-disable-line @typescript-eslint/no-unused-vars
      expect(onRest).toEqual(offRest);
      expect({ ...on, rowLocal: undefined }).toEqual({ ...off, rowLocal: undefined });
    }
    expect(rec(run(page({ blankAmounts: true }), true), '003').rowLocal.previousBudget.status).toBe('blank');
  });
  it('他の record（後続行の無いもの）の出力は変わらない', () => {
    const tokens = [...header(), tok('003', 128, 120, 24), tok('例の名称', NAME_X, 120, 28), ...amount('100', PREV, 120), ...amount('200', REQ, 120), ...amount('100', DIFF, 120)];
    expect(serializeFieldResolverResult(run(tokens, true))).toBe(serializeFieldResolverResult(run(tokens, false)));
  });
});
