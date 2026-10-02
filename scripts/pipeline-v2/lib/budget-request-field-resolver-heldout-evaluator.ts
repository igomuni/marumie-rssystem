/**
 * FieldResolver v0 held-out 評価（評価側。既存の Golden evaluator の意味は変えず、template ごとに呼び分けて集計し、追加指標を足す）。
 * 総表レイアウトのページは列の x 帯が通常の台帳と異なるため、sample の columnLayout ごとに列帯を与えて既存の evaluateGolden を呼ぶ。
 */
import { evaluateGolden, findRecord, type FieldMetrics, type FieldOutcome, type Golden, type GoldenSample, type GoldenTarget } from './budget-request-field-resolver-evaluator';
import type { FieldResolverResult } from './budget-request-field-resolver';
import type { HeldoutGolden } from './budget-request-field-resolver-heldout-gt';

export const HELDOUT_EVAL_SCHEMA = 'budget-request-field-resolver-heldout-evaluation/v0';

type BandSet = { previousBudget: [number, number]; requestedBudget: [number, number]; difference: [number, number] };
interface RawHeldoutGolden extends HeldoutGolden {
  columnBandsPt: Record<string, BandSet & { note?: string }>;
  humanReview: { status: string; exceptions?: { target: string; field: string }[] };
  samples: (HeldoutGolden['samples'][number] & { pageUnitLabel: { status: string; raw: string | null } })[];
}

const rate = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 10000) / 10000);

export function metricsFromOutcomes(outcomes: FieldOutcome[]): FieldMetrics {
  const c = (o: FieldOutcome['outcome']) => outcomes.filter(x => x.outcome === o).length;
  const gtResolvable = outcomes.filter(x => x.gtResolvable).length;
  const exactOut = outcomes.filter(x => x.outcome === 'exact' && x.outputResolvedOrBlank).length;
  const outputResolvedOrBlank = outcomes.filter(x => x.outputResolvedOrBlank).length;
  const exactResolvable = outcomes.filter(x => x.outcome === 'exact' && x.gtResolvable).length;
  const bad = c('false_resolved') + c('wrong_source') + c('wrong_normalization');
  return {
    gtResolvable,
    exact: exactResolvable,
    correctAbstention: outcomes.filter(x => x.outcome === 'exact' && !x.gtResolvable && !x.outputResolvedOrBlank).length,
    falseResolved: c('false_resolved'),
    wrongNormalization: c('wrong_normalization'),
    wrongSource: c('wrong_source'),
    unresolved: c('unresolved'),
    ambiguous: c('ambiguous'),
    notObserved: c('not_observed'),
    notFound: c('not_found'),
    outputResolvedOrBlank,
    precision: rate(exactOut, outputResolvedOrBlank),
    safeCoverage: rate(exactResolvable, gtResolvable),
    falseResolveRate: rate(bad, outputResolvedOrBlank),
  };
}

const AMOUNTS = ['previousBudget', 'requestedBudget', 'difference'] as const;

export interface HeldoutReport {
  schema: typeof HELDOUT_EVAL_SCHEMA;
  targetCount: number;
  overall: FieldMetrics;
  byLayout: Record<string, FieldMetrics>;
  byTier: Record<string, FieldMetrics>;
  blank: { gtBlank: number; outputBlank: number; exactBlank: number; blankPrecision: number | null; blankRecall: number | null };
  explicitZero: { gtZero: number; exactZero: number; accuracy: number | null };
  confusion: { blankConfirmedAsZero: number; zeroConfirmedAsBlank: number };
  templateAbstention: Record<string, { evaluatedResolvableFields: number; unresolvedOrAmbiguous: number; notFound: number; rate: number | null }>;
  auxiliaryIsolation: { wrongSource: number; auxiliaryDerivedCoreValues: number; auxiliaryDerivedDetail: string[] };
  failures: FieldOutcome[];
  recordNotFound: string[];
  outcomes: FieldOutcome[];
}

export function evaluateHeldout(golden: RawHeldoutGolden, resultFor: (sample: GoldenSample) => FieldResolverResult | null): HeldoutReport {
  const layouts = [...new Set(golden.samples.map(s => s.columnLayout))].sort();
  const outcomes: FieldOutcome[] = [];
  const outcomeLayout = new Map<string, string>();
  const outcomeTier = new Map<string, string>();
  const recordNotFound: string[] = [];
  const asSample = (s: RawHeldoutGolden['samples'][number]) => s as unknown as GoldenSample;
  for (const layout of layouts) {
    const group = golden.samples.filter(s => s.columnLayout === layout);
    const g = {
      schemaVersion: golden.schemaVersion,
      columnBandsPt: { previousBudget: golden.columnBandsPt[layout].previousBudget, requestedBudget: golden.columnBandsPt[layout].requestedBudget, difference: golden.columnBandsPt[layout].difference },
      samples: group.map(asSample),
      humanReview: { exceptions: golden.humanReview.exceptions ?? [] },
    } as unknown as Golden;
    const r = evaluateGolden(g, resultFor);
    outcomes.push(...r.outcomes);
    recordNotFound.push(...r.recordNotFound);
    for (const s of group) {
      for (const t of s.targets) { outcomeLayout.set(t.id, layout); outcomeTier.set(t.id, s.tier); }
      outcomeLayout.set(`${s.id}#pageUnitLabel`, layout);
      outcomeTier.set(`${s.id}#pageUnitLabel`, s.tier);
    }
  }
  const evaluated = outcomes.filter(o => o.outcome !== 'skipped_outside_scope');
  const group = (f: (o: FieldOutcome) => string | undefined): Record<string, FieldMetrics> => {
    const keys = [...new Set(evaluated.map(f).filter(Boolean) as string[])].sort();
    return Object.fromEntries(keys.map(k => [k, metricsFromOutcomes(evaluated.filter(o => f(o) === k))]));
  };
  // blank / zero / auxiliary は出力の中身（record）から数える
  let gtBlank = 0, outputBlank = 0, exactBlank = 0, gtZero = 0, exactZero = 0, blankAsZero = 0, zeroAsBlank = 0;
  let auxDerived = 0;
  const auxDetail: string[] = [];
  for (const s of golden.samples) {
    const result = resultFor(asSample(s));
    const bands = golden.columnBandsPt[s.columnLayout];
    for (const t of s.targets) {
      const rec = result ? findRecord(result, s.sourcePage, t as unknown as GoldenTarget) : null;
      for (const f of AMOUNTS) {
        const gt = t.rowLocal[f];
        const out = rec?.rowLocal[f];
        if (gt.cellState === 'visual blank') gtBlank++;
        if (gt.cellState === 'explicit zero') gtZero++;
        if (!out) continue;
        if (out.status === 'blank') {
          outputBlank++;
          if (gt.cellState === 'visual blank') exactBlank++;
          if (gt.cellState === 'explicit zero') zeroAsBlank++;
        }
        if (out.status === 'resolved' && out.value) {
          if (gt.cellState === 'visual blank' && out.value.magnitudeNumeric === 0) blankAsZero++;
          if (gt.cellState === 'explicit zero' && out.value.explicitZero && out.value.magnitudeNumeric === 0) exactZero++;
          const cx = out.evidence ? (out.evidence.bboxUnion.xMin + out.evidence.bboxUnion.xMax) / 2 : 0;
          if (out.evidence && cx > bands.difference[1] + 8) { auxDerived++; auxDetail.push(`${t.id}.${f}`); }
        }
      }
    }
  }
  const tmpl: HeldoutReport['templateAbstention'] = {};
  for (const layout of layouts) {
    const os = evaluated.filter(o => outcomeLayout.get(o.targetId) === layout && o.gtResolvable);
    const abst = os.filter(o => o.outcome === 'unresolved' || o.outcome === 'ambiguous').length;
    const nf = os.filter(o => o.outcome === 'not_found').length;
    tmpl[layout] = { evaluatedResolvableFields: os.length, unresolvedOrAmbiguous: abst, notFound: nf, rate: rate(abst, os.length) };
  }
  const overall = metricsFromOutcomes(evaluated);
  return {
    schema: HELDOUT_EVAL_SCHEMA,
    targetCount: golden.samples.reduce((n, s) => n + s.targets.length, 0),
    overall,
    byLayout: group(o => outcomeLayout.get(o.targetId)),
    byTier: group(o => outcomeTier.get(o.targetId)),
    blank: { gtBlank, outputBlank, exactBlank, blankPrecision: rate(exactBlank, outputBlank), blankRecall: rate(exactBlank, gtBlank) },
    explicitZero: { gtZero, exactZero, accuracy: rate(exactZero, gtZero) },
    confusion: { blankConfirmedAsZero: blankAsZero, zeroConfirmedAsBlank: zeroAsBlank },
    templateAbstention: tmpl,
    auxiliaryIsolation: { wrongSource: overall.wrongSource, auxiliaryDerivedCoreValues: auxDerived, auxiliaryDerivedDetail: auxDetail.sort() },
    failures: outcomes.filter(o => o.outcome !== 'exact' && o.outcome !== 'skipped_outside_scope'),
    recordNotFound: [...new Set(recordNotFound)].sort(),
    outcomes,
  };
}

export function renderHeldoutMarkdown(r: HeldoutReport): string {
  const pct = (x: number | null) => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);
  const head = '| 区分 | GT resolvable | exact | correct abstention | false resolved | wrong source | wrong norm. | unresolved | ambiguous | not observed/found | precision | safe coverage | false-resolve rate |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
  const row = (n: string, m: FieldMetrics) => `| ${n} | ${m.gtResolvable} | ${m.exact} | ${m.correctAbstention} | ${m.falseResolved} | ${m.wrongSource} | ${m.wrongNormalization} | ${m.unresolved} | ${m.ambiguous} | ${m.notObserved + m.notFound} | ${pct(m.precision)} | ${pct(m.safeCoverage)} | ${pct(m.falseResolveRate)} |`;
  const L: string[] = ['# FieldResolver v0 held-out 評価（初回）', '', `targets: ${r.targetCount}`, ''];
  L.push('## 全体', '', head, row('overall', r.overall), '', '## template 別', '', head, ...Object.entries(r.byLayout).map(([k, m]) => row(k, m)), '', '## カテゴリ別', '', head, ...Object.entries(r.byTier).map(([k, m]) => row(k, m)), '');
  L.push('## blank / explicit zero', '', `- GT visual blank ${r.blank.gtBlank} / 出力 blank ${r.blank.outputBlank} / exact blank ${r.blank.exactBlank}（precision ${pct(r.blank.blankPrecision)}・recall ${pct(r.blank.blankRecall)}）`, `- GT explicit zero ${r.explicitZero.gtZero} / exact ${r.explicitZero.exactZero}（accuracy ${pct(r.explicitZero.accuracy)}）`, `- blank を 0 として確定 ${r.confusion.blankConfirmedAsZero} / 0 を blank として確定 ${r.confusion.zeroConfirmedAsBlank}`, '');
  L.push('## template abstention', '', ...Object.entries(r.templateAbstention).map(([k, v]) => `- ${k}: unresolved/ambiguous ${v.unresolvedOrAmbiguous} / resolvable ${v.evaluatedResolvableFields}（${pct(v.rate)}）、record 未発見 ${v.notFound}`), '');
  L.push('## auxiliary isolation', '', `- wrong source: ${r.auxiliaryIsolation.wrongSource}`, `- 備考領域（差額列の右）にある根拠で確定した金額: ${r.auxiliaryIsolation.auxiliaryDerivedCoreValues}${r.auxiliaryIsolation.auxiliaryDerivedDetail.length ? `（${r.auxiliaryIsolation.auxiliaryDerivedDetail.join(', ')}）` : ''}`, '');
  const pri = ['false_resolved', 'wrong_source', 'wrong_normalization', 'not_found', 'unresolved', 'ambiguous', 'not_observed'];
  const fs = [...r.failures].sort((a, b) => pri.indexOf(a.outcome) - pri.indexOf(b.outcome) || a.targetId.localeCompare(b.targetId) || a.field.localeCompare(b.field));
  L.push('## 失敗・未確定（優先順）', '', '| target | field | outcome | detail |', '|---|---|---|---|', ...fs.map(f => `| ${f.targetId} | ${f.field} | ${f.outcome} | ${f.detail.replace(/\|/g, '\\|')} |`), '');
  return `${L.join('\n').replace(/\n+$/, '')}\n`;
}
