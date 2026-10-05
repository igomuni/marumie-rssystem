/**
 * 項名称の source-only continuation 連結（research-only。production は変更しない）。規則は
 * docs/tasks/20261006_0655_Budget_Request_MEXT_Item_Name_Continuation_Preregistration.md（実装・評価の前に固定）。
 * 継続の判定は既存 FieldResolver の凍結済み predicate（observeIncompleteNameGuard = A ∧ B ∧ ¬C ∧ ¬D）のみ。MOF・金額・名称の意味・対象の filename / page を使わない。
 */
import { observeIncompleteNameGuard, type ColumnLayout, type FieldResolverPageInput } from './budget-request-field-resolver';
import type { SourceToken } from './budget-request-source-token';

export interface NameLine { logicalRowIndex: number; physicalRowIndex: number; text: string; tokens: { index: number; text: string; bbox: SourceToken['bbox'] }[] }
export interface ContinuationResult {
  fired: boolean; baseLines: NameLine[]; appended: { logicalRowIndex: number; lines: NameLine[]; guard: { A: boolean | null; B: boolean | null; C: boolean | null; D: boolean | null } }[];
  stop: { reason: 'guard_not_satisfied' | 'page_end'; nextLogicalRowIndex: number | null; guard: { A: boolean | null; B: boolean | null; C: boolean | null; D: boolean | null } | null };
}

const isBlank = (t: SourceToken) => t.rawText.trim() === '';
const center = (b: SourceToken['bbox']) => (b.xMin + b.xMax) / 2;
const inNameRegion = (layout: ColumnLayout, t: SourceToken) => { const [l, r] = layout.regions.name; const c = center(t.bbox); return c >= (l ?? Number.NEGATIVE_INFINITY) && c < r; };

/** production の rowTokens と同じ: logical row の visual 順 token と、それが属する physical row */
export function rowTokensOf(page: FieldResolverPageInput, rowIdx: number): { token: SourceToken; physicalRowIndex: number }[] {
  const row = page.logical.logicalRowCandidates[rowIdx];
  const physByToken = new Map<number, number>();
  for (const pr of row.physicalRowIndexes) for (const i of page.geometry.physicalRows[pr]?.rawTokenIndexes ?? []) physByToken.set(i, pr);
  return row.visualTokenIndexes.map(i => ({ token: page.tokens[i], physicalRowIndex: physByToken.get(i) ?? row.physicalRowIndexes[0] })).filter(x => !isBlank(x.token));
}

/** name 領域内の token（code token を除く）を physical row ごとに x 昇順で連結した行 */
export function nameLinesOf(page: FieldResolverPageInput, layout: ColumnLayout, rowIdx: number, excludeTokenIndexes: Set<number>): NameLine[] {
  const by = new Map<number, SourceToken[]>();
  for (const x of rowTokensOf(page, rowIdx)) if (!excludeTokenIndexes.has(x.token.index) && inNameRegion(layout, x.token)) by.set(x.physicalRowIndex, [...(by.get(x.physicalRowIndex) ?? []), x.token]);
  return [...by.keys()].sort((a, b) => a - b).map(pr => {
    const toks = by.get(pr)!.sort((a, b) => a.bbox.xMin - b.bbox.xMin || a.index - b.index);
    return { logicalRowIndex: page.logical.logicalRowCandidates[rowIdx].logicalRowIndex, physicalRowIndex: pr, text: toks.map(t => t.rawText).join(''), tokens: toks.map(t => ({ index: t.index, text: t.rawText, bbox: t.bbox })) };
  });
}

/** 基底名称 + 既存 guard が満たされる間の continuation 行（name 領域の token のみ）。MOF を使わない */
export function composeContinuation(page: FieldResolverPageInput, layout: ColumnLayout, rowIdx: number, codeTokenIndex: number): ContinuationResult {
  const rows = page.logical.logicalRowCandidates;
  const baseLines = nameLinesOf(page, layout, rowIdx, new Set([codeTokenIndex]));
  const appended: ContinuationResult['appended'] = [];
  let cur = rowIdx;
  let codeIdx = new Set([codeTokenIndex]);
  for (;;) {
    const nextIdx = cur + 1;
    if (nextIdx >= rows.length) return { fired: appended.length > 0, baseLines, appended, stop: { reason: 'page_end', nextLogicalRowIndex: null, guard: null } };
    const g = observeIncompleteNameGuard(page, layout, rows[cur], rows[nextIdx], rowTokensOf(page, cur), codeIdx);
    const guard = { A: g.A, B: g.B, C: g.C, D: g.D };
    if (!g.fires) return { fired: appended.length > 0, baseLines, appended, stop: { reason: 'guard_not_satisfied', nextLogicalRowIndex: rows[nextIdx].logicalRowIndex, guard } };
    const lines = nameLinesOf(page, layout, nextIdx, new Set());
    appended.push({ logicalRowIndex: rows[nextIdx].logicalRowIndex, lines, guard });
    cur = nextIdx; codeIdx = new Set();
  }
}

/** 連結後の名称（行は \n で連結した raw と、空白除去前の連結 text） */
export function joinedName(r: ContinuationResult): { raw: string; concatenated: string } {
  const lines = [...r.baseLines, ...r.appended.flatMap(a => a.lines)].map(l => l.text);
  return { raw: lines.join('\n'), concatenated: lines.join('') };
}
