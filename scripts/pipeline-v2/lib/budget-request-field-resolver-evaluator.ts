/**
 * FieldResolver v0 PoC — 評価側。Golden を読んでよいのはこの module と評価CLI・テストだけ（推論側は読まない）。
 * Golden の値は変更しない。比較方針（空白除去・Unicode保留の扱い・source 判定）はここに置き、推論には持ち込まない。
 * 主指標は false-resolve rate（resolved / blank と出力したもののうち、誤っていたもの）。
 * 失敗の優先度: false resolved > wrong source > wrong normalization > recall loss。
 */
import type { AmountValue, FieldEvidence, FieldResolverResult, FieldResult, RecordFieldResolution } from './budget-request-field-resolver';

export const FIELD_RESOLVER_EVAL_SCHEMA = 'budget-request-field-resolver-poc-evaluation/v0';

// ---- Golden（必要な部分だけの緩い型。fixture は golden.ts の validator が検証済み）
interface GoldenSign { status: string; raw: string | null }
interface GoldenAmount { status: string; magnitudeRaw?: string | null; magnitudeNumeric?: number | null; explicitZero?: boolean; sign?: GoldenSign }
interface GoldenHierarchyField { status: string; value?: { code: string; name: string }; acceptableStatuses?: string[] }
export interface GoldenTarget {
  id: string;
  kind: string;
  visualLocator: { approxYPt: number; yToleranceBandPt: number };
  rowLocal: {
    code: { status: string; raw: string };
    name: { status: string; normalized: string };
    previousBudget: GoldenAmount;
    requestedBudget: GoldenAmount;
    difference: GoldenAmount;
  };
  expectedSourceClass: Record<string, string>;
  auxiliary: { class: string }[];
  hierarchy: { inputState: string; expected: { parentItemAssociation: GoldenHierarchyField; parentOrganizationAssociation: GoldenHierarchyField } };
}
export interface GoldenSample {
  id: string;
  sourcePage: number;
  document: { canonicalUrl: string };
  pageUnitLabel: { status: string; raw: string | null };
  targets: GoldenTarget[];
}
export interface Golden {
  schemaVersion: string;
  columnBandsPt: { previousBudget: [number, number]; requestedBudget: [number, number]; difference: [number, number] };
  samples: GoldenSample[];
  humanReview: { exceptions?: { target: string; field: string }[] };
}

export type Outcome = 'exact' | 'false_resolved' | 'wrong_source' | 'wrong_normalization' | 'unresolved' | 'ambiguous' | 'not_observed' | 'not_found' | 'skipped_outside_scope';

export interface FieldOutcome {
  targetId: string;
  field: string;
  outcome: Outcome;
  /** GT が resolvable（resolved / blank / 明示的に期待する not_applicable・not_observed を除く、値または空欄の期待）か */
  gtResolvable: boolean;
  /** 出力が resolved または blank か（false-resolve rate の分母） */
  outputResolvedOrBlank: boolean;
  detail: string;
}

export interface FieldMetrics {
  gtResolvable: number;
  /** GT が resolvable で exact だった数 */
  exact: number;
  /** GT が not_applicable / not_observed / 許容 unresolved で、出力が正しく確定しなかった数（正しい abstention） */
  correctAbstention: number;
  falseResolved: number;
  wrongNormalization: number;
  wrongSource: number;
  unresolved: number;
  ambiguous: number;
  notObserved: number;
  notFound: number;
  outputResolvedOrBlank: number;
  /** （exact かつ resolved/blank 出力）/ resolved/blank 出力 */
  precision: number | null;
  /** exact / gtResolvable */
  safeCoverage: number | null;
  /** (falseResolved + wrongSource + wrongNormalization) / outputResolvedOrBlank */
  falseResolveRate: number | null;
}

export interface EvaluationReport {
  schema: typeof FIELD_RESOLVER_EVAL_SCHEMA;
  golden: { schemaVersion: string; sampleCount: number; targetCount: number };
  outcomes: FieldOutcome[];
  byField: Record<string, FieldMetrics>;
  rowLocal: FieldMetrics;
  hierarchy: FieldMetrics;
  overall: FieldMetrics;
  byContext: Record<string, FieldMetrics & { targets: string[] }>;
  failures: FieldOutcome[];
  recordNotFound: string[];
}

const rate = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 10000) / 10000);
const stripSpaces = (s: string): string => s.replace(/[\s　]+/g, '');

function metricsOf(outcomes: FieldOutcome[]): FieldMetrics {
  const c = (o: Outcome) => outcomes.filter(x => x.outcome === o).length;
  const gtResolvable = outcomes.filter(x => x.gtResolvable).length;
  const exactOut = outcomes.filter(x => x.outcome === 'exact' && x.outputResolvedOrBlank).length;
  const outputResolvedOrBlank = outcomes.filter(x => x.outputResolvedOrBlank).length;
  const bad = c('false_resolved') + c('wrong_source') + c('wrong_normalization');
  return {
    gtResolvable,
    exact: outcomes.filter(x => x.outcome === 'exact' && x.gtResolvable).length,
    falseResolved: c('false_resolved'),
    wrongNormalization: c('wrong_normalization'),
    wrongSource: c('wrong_source'),
    unresolved: c('unresolved'),
    ambiguous: c('ambiguous'),
    notObserved: c('not_observed'),
    notFound: c('not_found'),
    outputResolvedOrBlank,
    correctAbstention: outcomes.filter(x => x.outcome === 'exact' && !x.gtResolvable && !x.outputResolvedOrBlank).length,
    precision: rate(exactOut, outputResolvedOrBlank),
    safeCoverage: rate(outcomes.filter(x => x.outcome === 'exact' && x.gtResolvable).length, gtResolvable),
    falseResolveRate: rate(bad, outputResolvedOrBlank),
  };
}

const AMOUNT_FIELDS = ['previousBudget', 'requestedBudget', 'difference'] as const;
const SIGN_FIELDS: Record<(typeof AMOUNT_FIELDS)[number], 'previousBudgetSign' | 'requestedBudgetSign' | 'differenceSign'> = {
  previousBudget: 'previousBudgetSign',
  requestedBudget: 'requestedBudgetSign',
  difference: 'differenceSign',
};

function sourceOk(expected: string | undefined, ev: FieldEvidence | null): boolean {
  if (!ev) return false;
  if (ev.associationClass === 'auxiliary' || ev.associationClass === 'unrelated') return false;
  if (expected === 'same_row') return ev.associationClass === 'same_row';
  return true; // same_row_or_continuation / 未指定
}

function inBand(ev: FieldEvidence | null, band: [number, number], slack: number): boolean {
  if (!ev) return false;
  const cx = (ev.bboxUnion.xMin + ev.bboxUnion.xMax) / 2;
  return cx >= band[0] - slack && cx <= band[1] + slack;
}

function statusOutcome(status: string): Outcome {
  if (status === 'ambiguous') return 'ambiguous';
  if (status === 'not_observed') return 'not_observed';
  return 'unresolved';
}

export interface EvaluatorOptions {
  /** record 照合のy許容に足すpt（Golden の yToleranceBandPt に加える） */
  locatorSlackPt?: number;
}

export function findRecord(result: FieldResolverResult, page: number, t: GoldenTarget, slack = 0): RecordFieldResolution | null {
  const tol = t.visualLocator.yToleranceBandPt + slack;
  const y = t.visualLocator.approxYPt;
  const near = result.records.filter(r => r.anchor.page === page && r.anchorBBox.yMin - tol <= y && r.anchorBBox.yMax + tol >= y);
  if (near.length === 0) return null;
  const byCode = near.filter(r => r.rowLocal.code.value?.raw === t.rowLocal.code.raw);
  const pool = byCode.length > 0 ? byCode : near;
  return [...pool].sort((a, b) => Math.abs((a.anchorBBox.yMin + a.anchorBBox.yMax) / 2 - y) - Math.abs((b.anchorBBox.yMin + b.anchorBBox.yMax) / 2 - y))[0];
}

function evalSimple(targetId: string, field: string, gtResolvable: boolean, f: FieldResult<unknown>, exact: boolean, wrongSource: boolean, detail: string): FieldOutcome {
  const out = f.status === 'resolved' || f.status === 'blank';
  let outcome: Outcome;
  if (out) outcome = !exact ? 'false_resolved' : wrongSource ? 'wrong_source' : 'exact';
  else outcome = statusOutcome(f.status);
  return { targetId, field, outcome, gtResolvable, outputResolvedOrBlank: out, detail };
}

function evalAmount(t: GoldenTarget, field: (typeof AMOUNT_FIELDS)[number], rec: RecordFieldResolution, golden: Golden): FieldOutcome[] {
  const g = t.rowLocal[field];
  const f = rec.rowLocal[field] as FieldResult<AmountValue>;
  const sf = rec.rowLocal[SIGN_FIELDS[field]] as FieldResult<{ raw: string }>;
  const out: FieldOutcome[] = [];
  const out1 = f.status === 'resolved' || f.status === 'blank';
  const expectedSrc = t.expectedSourceClass[field];
  let o: Outcome;
  let detail = '';
  if (g.status === 'blank') {
    if (f.status === 'blank') { o = 'exact'; detail = 'blank'; }
    else if (f.status === 'resolved') { o = 'false_resolved'; detail = `GT blank, got ${f.value?.magnitudeRaw}`; }
    else { o = statusOutcome(f.status); detail = `GT blank, got ${f.status}/${f.reasonCode}`; }
  } else {
    if (f.status === 'resolved' && f.value) {
      const valueOk = f.value.magnitudeNumeric === g.magnitudeNumeric && f.value.explicitZero === g.explicitZero;
      if (!valueOk) {
        o = f.value.magnitudeNumeric === g.magnitudeNumeric ? 'wrong_normalization' : 'false_resolved';
        detail = `GT ${g.magnitudeRaw}, got ${f.value.magnitudeRaw}`;
      } else if (!sourceOk(expectedSrc, f.evidence) || !inBand(f.evidence, golden.columnBandsPt[field], 8)) {
        o = 'wrong_source';
        detail = `value matches (${g.magnitudeRaw}) but source is not the target cell (class=${f.evidence?.associationClass})`;
      } else { o = 'exact'; detail = g.magnitudeRaw ?? ''; }
    } else if (f.status === 'blank') { o = 'false_resolved'; detail = `GT ${g.magnitudeRaw}, got blank`; }
    else { o = statusOutcome(f.status); detail = `GT ${g.magnitudeRaw}, got ${f.status}/${f.reasonCode}`; }
  }
  out.push({ targetId: t.id, field, outcome: o, gtResolvable: true, outputResolvedOrBlank: out1, detail });

  // sign
  const gs = g.status === 'blank' ? null : g.sign;
  const sOut = sf.status === 'resolved';
  let so: Outcome;
  let sdetail: string;
  let gtRes: boolean;
  if (g.status === 'blank') {
    gtRes = false;
    so = sf.status === 'not_applicable' ? 'exact' : sOut ? 'false_resolved' : statusOutcome(sf.status);
    sdetail = `amount blank: expected not_applicable, got ${sf.status}`;
  } else if (gs && gs.status === 'resolved') {
    gtRes = true;
    if (sf.status === 'resolved') {
      if (sf.value?.raw !== gs.raw) { so = 'false_resolved'; sdetail = `GT ${gs.raw}, got ${sf.value?.raw}`; }
      else if (!sourceOk('same_row', sf.evidence) && !sourceOk('same_row_or_continuation', sf.evidence)) { so = 'wrong_source'; sdetail = 'sign source not same row'; }
      else { so = 'exact'; sdetail = gs.raw ?? ''; }
    } else { so = statusOutcome(sf.status); sdetail = `GT ${gs.raw}, got ${sf.status}/${sf.reasonCode}`; }
  } else {
    // GT: 符号 token は無い（not_observed）。出力が resolved なら符号の捏造
    gtRes = false;
    so = sf.status === 'not_observed' ? 'exact' : sOut ? 'false_resolved' : statusOutcome(sf.status);
    sdetail = `GT no sign token: expected not_observed, got ${sf.status}${sOut ? `(${sf.value?.raw})` : ''}`;
  }
  out.push({ targetId: t.id, field: SIGN_FIELDS[field], outcome: so, gtResolvable: gtRes, outputResolvedOrBlank: sOut, detail: sdetail });
  return out;
}

function evalHierarchy(t: GoldenTarget, key: 'parentItemAssociation' | 'parentOrganizationAssociation', rec: RecordFieldResolution): FieldOutcome {
  const g = t.hierarchy.expected[key];
  const f = rec.hierarchyDependent[key];
  const out = f.status === 'resolved';
  const mk = (outcome: Outcome, gtResolvable: boolean, detail: string): FieldOutcome => ({ targetId: t.id, field: key, outcome, gtResolvable, outputResolvedOrBlank: out, detail });
  if (g.status === 'outside_v0_scope') return { targetId: t.id, field: key, outcome: 'skipped_outside_scope', gtResolvable: false, outputResolvedOrBlank: false, detail: `outside v0 scope; output ${f.status}/${f.reasonCode}` };
  if (g.status === 'not_applicable') return mk(f.status === 'not_applicable' ? 'exact' : out ? 'false_resolved' : statusOutcome(f.status), false, `expected not_applicable, got ${f.status}/${f.reasonCode}`);
  if (g.status === 'not_resolved') {
    const acc = g.acceptableStatuses ?? ['unresolved', 'ambiguous'];
    return mk(acc.includes(f.status) ? 'exact' : out ? 'false_resolved' : statusOutcome(f.status), false, `expected one of ${acc.join('/')}, got ${f.status}/${f.reasonCode}`);
  }
  // resolved
  if (out) {
    const code = f.evidence?.rawText.trim();
    return mk(code === g.value?.code ? 'exact' : 'false_resolved', true, `expected parent code ${g.value?.code}, got ${code}`);
  }
  return mk(statusOutcome(f.status), true, `expected parent code ${g.value?.code}, got ${f.status}/${f.reasonCode}`);
}

const SIGN_ANY = (t: GoldenTarget): boolean => AMOUNT_FIELDS.some(f => t.rowLocal[f].status !== 'blank' && t.rowLocal[f].sign?.status === 'resolved');
const BLANK_ANY = (t: GoldenTarget): boolean => AMOUNT_FIELDS.some(f => t.rowLocal[f].status === 'blank');
const ZERO_ANY = (t: GoldenTarget): boolean => AMOUNT_FIELDS.some(f => t.rowLocal[f].explicitZero === true);

export function contextsOf(t: GoldenTarget): string[] {
  const c: string[] = [];
  if (t.auxiliary.some(a => a.class !== 'none')) c.push('auxiliary-heavy');
  if (['explicitly_unresolved', 'resolved_risky_or_level_gap'].includes(t.hierarchy.inputState)) c.push('hierarchy-unresolved');
  if (['resolved_risky', 'resolved_risky_or_level_gap', 'safe_edge_risky_composition'].includes(t.hierarchy.inputState)) c.push('hierarchy-risky');
  if (BLANK_ANY(t)) c.push('blank');
  if (SIGN_ANY(t)) c.push('explicit-sign');
  if (ZERO_ANY(t)) c.push('explicit-zero');
  if (c.length === 0) c.push('normal');
  return c;
}

export function evaluateGolden(golden: Golden, resultFor: (sample: GoldenSample) => FieldResolverResult | null, options: EvaluatorOptions = {}): EvaluationReport {
  const outcomes: FieldOutcome[] = [];
  const recordNotFound: string[] = [];
  const exceptions = golden.humanReview.exceptions ?? [];
  let targetCount = 0;
  const targetContexts = new Map<string, string[]>();
  for (const s of golden.samples) {
    const result = resultFor(s);
    for (const t of s.targets) {
      targetCount++;
      targetContexts.set(t.id, contextsOf(t));
      const rec = result ? findRecord(result, s.sourcePage, t, options.locatorSlackPt ?? 0) : null;
      if (!rec) {
        recordNotFound.push(t.id);
        for (const f of ['code', 'name', 'previousBudget', 'requestedBudget', 'difference', 'previousBudgetSign', 'requestedBudgetSign', 'differenceSign', 'parentItemAssociation', 'parentOrganizationAssociation']) {
          outcomes.push({ targetId: t.id, field: f, outcome: 'not_found', gtResolvable: ['code', 'name', 'previousBudget', 'requestedBudget', 'difference'].includes(f), outputResolvedOrBlank: false, detail: 'record not found at the visual locator' });
        }
        continue;
      }
      outcomes.push(evalSimple(t.id, 'code', true, rec.rowLocal.code, rec.rowLocal.code.value?.raw === t.rowLocal.code.raw, !sourceOk(t.expectedSourceClass.code, rec.rowLocal.code.evidence), `GT ${t.rowLocal.code.raw}, got ${rec.rowLocal.code.value?.raw ?? rec.rowLocal.code.status}`));
      const unicodePending = exceptions.some(e => e.target === t.id && e.field === 'name');
      const norm = (x: string) => (unicodePending ? stripSpaces(x).normalize('NFKC') : stripSpaces(x));
      const nameOk = rec.rowLocal.name.value ? norm(rec.rowLocal.name.value.normalized) === norm(t.rowLocal.name.normalized) : false;
      outcomes.push(evalSimple(t.id, 'name', true, rec.rowLocal.name, nameOk, !sourceOk(t.expectedSourceClass.name, rec.rowLocal.name.evidence), `GT ${t.rowLocal.name.normalized}, got ${rec.rowLocal.name.value?.normalized ?? rec.rowLocal.name.status + '/' + rec.rowLocal.name.reasonCode}${unicodePending ? ' [compared after whitespace removal + NFKC: Unicode representation pending]' : ''}`));
      for (const f of AMOUNT_FIELDS) outcomes.push(...evalAmount(t, f, rec, golden));
      outcomes.push(evalHierarchy(t, 'parentItemAssociation', rec), evalHierarchy(t, 'parentOrganizationAssociation', rec));
    }
  }
  // pageUnitLabel（ページ単位）
  for (const s of golden.samples) {
    const result = resultFor(s);
    const rec = result?.records.find(r => r.anchor.page === s.sourcePage);
    const u = rec?.pageUnitLabel;
    const id = `${s.id}#pageUnitLabel`;
    if (!u) { outcomes.push({ targetId: id, field: 'pageUnitLabel', outcome: 'not_found', gtResolvable: s.pageUnitLabel.status === 'resolved', outputResolvedOrBlank: false, detail: 'no record on the page' }); continue; }
    if (s.pageUnitLabel.status === 'resolved') {
      const ok = u.status === 'resolved' && u.value?.raw === s.pageUnitLabel.raw;
      outcomes.push({ targetId: id, field: 'pageUnitLabel', outcome: ok ? 'exact' : u.status === 'resolved' ? 'false_resolved' : statusOutcome(u.status), gtResolvable: true, outputResolvedOrBlank: u.status === 'resolved', detail: `GT ${s.pageUnitLabel.raw}, got ${u.value?.raw ?? u.status}` });
    } else {
      outcomes.push({ targetId: id, field: 'pageUnitLabel', outcome: u.status === 'not_observed' ? 'exact' : u.status === 'resolved' ? 'false_resolved' : statusOutcome(u.status), gtResolvable: false, outputResolvedOrBlank: u.status === 'resolved', detail: `GT not_observed, got ${u.status}` });
    }
  }
  const fieldNames = [...new Set(outcomes.map(o => o.field))];
  const byField: Record<string, FieldMetrics> = {};
  for (const f of fieldNames) byField[f] = metricsOf(outcomes.filter(o => o.field === f));
  const isHier = (o: FieldOutcome) => o.field === 'parentItemAssociation' || o.field === 'parentOrganizationAssociation';
  const evaluated = outcomes.filter(o => o.outcome !== 'skipped_outside_scope');
  const byContext: EvaluationReport['byContext'] = {};
  const ctxNames = [...new Set([...targetContexts.values()].flat())].sort();
  for (const c of ctxNames) {
    const ids = [...targetContexts.entries()].filter(([, v]) => v.includes(c)).map(([k]) => k).sort();
    byContext[c] = { ...metricsOf(evaluated.filter(o => ids.includes(o.targetId))), targets: ids };
  }
  return {
    schema: FIELD_RESOLVER_EVAL_SCHEMA,
    golden: { schemaVersion: golden.schemaVersion, sampleCount: golden.samples.length, targetCount },
    outcomes,
    byField,
    rowLocal: metricsOf(evaluated.filter(o => !isHier(o) && o.field !== 'pageUnitLabel')),
    hierarchy: metricsOf(evaluated.filter(isHier)),
    overall: metricsOf(evaluated),
    byContext,
    failures: outcomes.filter(o => o.outcome !== 'exact' && o.outcome !== 'skipped_outside_scope').sort(failureOrder),
    recordNotFound,
  };
}

const PRIORITY: Outcome[] = ['false_resolved', 'wrong_source', 'wrong_normalization', 'not_found', 'unresolved', 'ambiguous', 'not_observed'];
function failureOrder(a: FieldOutcome, b: FieldOutcome): number {
  return PRIORITY.indexOf(a.outcome) - PRIORITY.indexOf(b.outcome) || a.targetId.localeCompare(b.targetId) || a.field.localeCompare(b.field);
}

export function renderEvaluationMarkdown(r: EvaluationReport): string {
  const pct = (x: number | null) => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);
  const row = (name: string, m: FieldMetrics) => `| ${name} | ${m.gtResolvable} | ${m.exact} | ${m.correctAbstention} | ${m.falseResolved} | ${m.wrongSource} | ${m.wrongNormalization} | ${m.unresolved} | ${m.ambiguous} | ${m.notObserved + m.notFound} | ${pct(m.precision)} | ${pct(m.safeCoverage)} | ${pct(m.falseResolveRate)} |`;
  const head = '| 区分 | GT resolvable | exact | correct abstention | false resolved | wrong source | wrong norm. | unresolved | ambiguous | not observed/found | precision | safe coverage | false-resolve rate |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
  const lines: string[] = [];
  lines.push('# FieldResolver v0 PoC — Golden 評価', '', `schema: ${r.schema} / Golden: ${r.golden.schemaVersion}（${r.golden.sampleCount} ページ・${r.golden.targetCount} target）`, '');
  lines.push('## 全体', '', head, row('row-local', r.rowLocal), row('hierarchy', r.hierarchy), row('overall', r.overall), '');
  lines.push('## field 別', '', head, ...Object.entries(r.byField).map(([k, m]) => row(k, m)), '');
  lines.push('## context 別', '', head, ...Object.entries(r.byContext).map(([k, m]) => row(`${k} (${m.targets.length} target)`, m)), '');
  lines.push('## 失敗・未確定（優先順）', '', '| target | field | outcome | detail |', '|---|---|---|---|', ...r.failures.map(f => `| ${f.targetId} | ${f.field} | ${f.outcome} | ${f.detail.replace(/\|/g, '\\|')} |`), '');
  if (r.recordNotFound.length > 0) lines.push('## record が見つからなかった target', '', ...r.recordNotFound.map(x => `- ${x}`), '');
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
