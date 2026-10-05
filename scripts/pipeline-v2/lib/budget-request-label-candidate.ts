/**
 * frozen label-shaped predicate の candidate row の inventory（research-only 純関数）。predicate・normalization は変更せず、既存の変換の各段階を分解して記録するだけ。
 * 規則は docs/tasks/20261005_1200_Budget_Request_Label_Shaped_Predicate_Ambiguity_Protocol.md（candidate universe の生成前に固定）。label の意味は解釈しない。
 */
export type Population = 'P1_projected_same_row' | 'P2_ambiguity_additional_after_code' | 'P3_nonambiguous_additional_after_code' | 'P4_before_first_code' | 'P5_other';
export type RelativePosition = 'before_first_code' | 'same_as_first_code' | 'after_first_code' | 'first_code_unavailable';

const SHAPE = /^([^()]+)\(([^()]+)\)$/;
export interface Stages { raw: string; nfkc: string; noWhitespace: string; final: string }
/** 既存 normalization（NFKC → 空白除去 → 数字除去。normalizeLabel と同じ順）の各段階 */
export function stagesOf(raw: string): Stages {
  const nfkc = raw.normalize('NFKC');
  const noWhitespace = nfkc.replace(/[\s　]+/g, '');
  return { raw, nfkc, noWhitespace, final: noWhitespace.replace(/\d/g, '') };
}
export interface StageShapes { raw: boolean; nfkc: boolean; noWhitespace: boolean; final: boolean; firstShapeStage: 'raw' | 'nfkc' | 'noWhitespace' | 'final' | 'none'; digitRemovalDependent: boolean }
export function stageShapes(raw: string): StageShapes {
  const s = stagesOf(raw);
  const f = { raw: SHAPE.test(s.raw), nfkc: SHAPE.test(s.nfkc), noWhitespace: SHAPE.test(s.noWhitespace), final: SHAPE.test(s.final) };
  const first = f.raw ? 'raw' : f.nfkc ? 'nfkc' : f.noWhitespace ? 'noWhitespace' : f.final ? 'final' : 'none';
  return { ...f, firstShapeStage: first, digitRemovalDependent: !f.noWhitespace && f.final };
}

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
export interface CharCounts { total: number; digits: number; asciiDigits: number; han: number; hiragana: number; katakana: number; latin: number; whitespace: number; punctSymbol: number; openParen: number; closeParen: number; comma: number; slash: number; percent: number }
/** 文字クラスの個数（意味解釈なし）。括弧・カンマ・スラッシュ・パーセントは半角・全角の両方を数える */
export function charCounts(s: string): CharCounts {
  return {
    total: [...s].length, digits: count(s, /\p{Nd}/gu), asciiDigits: count(s, /[0-9]/g), han: count(s, /\p{Script=Han}/gu), hiragana: count(s, /\p{Script=Hiragana}/gu), katakana: count(s, /\p{Script=Katakana}/gu), latin: count(s, /\p{Script=Latin}/gu),
    whitespace: count(s, /\s/gu), punctSymbol: count(s, /[\p{P}\p{S}]/gu), openParen: count(s, /[(（]/g), closeParen: count(s, /[)）]/g), comma: count(s, /[,，、]/g), slash: count(s, /[/／]/g), percent: count(s, /[%％]/g),
  };
}

/** 固定の bin（事前登録） */
export const countBin = (n: number): string => (n <= 2 ? String(n) : n <= 5 ? '3-5' : n <= 10 ? '6-10' : '11+');
export const stepBin = (x: number, step: number): string => String(Math.floor(x / step) * step);
export const deltaBin = (d: number): string => (d < 0 ? 'neg' : d <= 2 ? String(d) : d <= 5 ? '3-5' : d <= 10 ? '6-10' : '11+');

export function relativePosition(index: number, firstCodeIndex: number | null): RelativePosition {
  if (firstCodeIndex === null) return 'first_code_unavailable';
  return index < firstCodeIndex ? 'before_first_code' : index === firstCodeIndex ? 'same_as_first_code' : 'after_first_code';
}

/** 排他的な population 割り当て（protocol の順） */
export function populationOf(isProjected: boolean, basisIsFirstCodeLabel: boolean, pos: RelativePosition, pageAmbiguous: boolean, additionalDiffersFromProjected: boolean): Population {
  if (isProjected && basisIsFirstCodeLabel && pos === 'same_as_first_code') return 'P1_projected_same_row';
  if (!isProjected && pageAmbiguous && pos === 'after_first_code' && additionalDiffersFromProjected) return 'P2_ambiguity_additional_after_code';
  if (!isProjected && !pageAmbiguous && pos === 'after_first_code') return 'P3_nonambiguous_additional_after_code';
  if (pos === 'before_first_code') return 'P4_before_first_code';
  return 'P5_other';
}

export type FeatureGroup = 'row_local' | 'projection_context';
export interface FeatureTable { rowLocal: Record<string, string>; projectionContext: Record<string, string> }

export interface DisjointResult { feature: string; group: FeatureGroup; p1Values: Record<string, number>; p2Values: Record<string, number>; disjoint: boolean; tvd: number }
/** feature ごとに P1 と P2 の値の分布を比較（disjoint = 値の集合が交わらない、tvd = total variation distance） */
export function compareFeatures(p1: FeatureTable[], p2: FeatureTable[]): DisjointResult[] {
  const out: DisjointResult[] = [];
  for (const group of ['row_local', 'projection_context'] as const) {
    const key = group === 'row_local' ? 'rowLocal' : 'projectionContext';
    const names = new Set<string>([...p1, ...p2].flatMap(t => Object.keys(t[key])));
    for (const f of [...names].sort()) {
      const dist = (ts: FeatureTable[]) => { const m: Record<string, number> = {}; for (const t of ts) { const v = t[key][f] ?? 'not_available'; m[v] = (m[v] ?? 0) + 1; } return m; };
      const a = dist(p1), b = dist(p2);
      const vals = new Set([...Object.keys(a), ...Object.keys(b)]);
      let tvd = 0;
      for (const v of vals) tvd += Math.abs((a[v] ?? 0) / Math.max(1, p1.length) - (b[v] ?? 0) / Math.max(1, p2.length));
      out.push({ feature: f, group, p1Values: a, p2Values: b, disjoint: [...vals].every(v => !(v in a && v in b)), tvd: Math.round((tvd / 2) * 10000) / 10000 });
    }
  }
  return out;
}

export type AmbiguityDecision = 'AMBIGUITY_STRUCTURALLY_ISOLATED' | 'AMBIGUITY_PARTIALLY_ISOLATED' | 'AMBIGUITY_NOT_ISOLATED' | 'INCONCLUSIVE';
/** 事前登録の判定（D4 → D1 → D2 → D3） */
export function decideAmbiguity(accountingOk: boolean, provenanceMissing: number, results: DisjointResult[]): { decision: AmbiguityDecision; rule: number } {
  if (!accountingOk || provenanceMissing !== 0) return { decision: 'INCONCLUSIVE', rule: 1 };
  if (results.some(r => r.group === 'row_local' && r.disjoint)) return { decision: 'AMBIGUITY_STRUCTURALLY_ISOLATED', rule: 2 };
  if (results.some(r => r.group === 'projection_context' && r.disjoint) || results.some(r => r.group === 'row_local' && r.tvd >= 0.5)) return { decision: 'AMBIGUITY_PARTIALLY_ISOLATED', rule: 3 };
  return { decision: 'AMBIGUITY_NOT_ISOLATED', rule: 4 };
}
