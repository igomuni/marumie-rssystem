/**
 * FieldResolver v0 Golden fixture の整合性検証（fixture integrity のみ。FieldResolver の推論ではない）。
 * Golden は評価専用で、将来の推論コードからは import しない（Contract §14）。検証と coverage の判定だけを持つ。
 */
export const GOLDEN_SCHEMA_VERSION = 'budget-request-field-resolver-golden/v0';
export const STATUS_VOCABULARY = ['resolved', 'blank', 'unresolved', 'ambiguous', 'not_observed', 'not_applicable'] as const;
const KINDS = ['organization', 'item', 'request', 'detail_line'];
const AUX_CLASSES = ['remark_text', 'breakdown_table', 'history_table', 'ruled_table', 'inline_label_number'];
const SIGNS = ['△', '▲', '-'];
const HIER_STATES = ['safe', 'explicitly_unresolved', 'resolved_risky', 'level_gap', 'resolved_risky_or_level_gap', 'safe_edge_risky_composition', 'not_available', 'not_applicable'];
const ASSOC_STATUS = ['resolved', 'not_resolved', 'not_applicable', 'outside_v0_scope'];
const AMOUNT_RAW = /^(0|[1-9]\d{0,2}(,\d{3})*)$/;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const isStatus = (s: unknown): boolean => (STATUS_VOCABULARY as readonly string[]).includes(s as string);

function checkAmount(p: string, a: Json, errors: string[]): void {
  if (!a || !isStatus(a.status)) return void errors.push(`${p}: invalid status ${JSON.stringify(a?.status)}`);
  if (a.status === 'resolved') {
    if (typeof a.magnitudeRaw !== 'string' || !AMOUNT_RAW.test(a.magnitudeRaw)) errors.push(`${p}: resolved amount needs magnitudeRaw in thousands-separated form`);
    else if (a.magnitudeNumeric !== Number(a.magnitudeRaw.replace(/,/g, ''))) errors.push(`${p}: magnitudeNumeric does not match magnitudeRaw`);
    if (a.explicitZero !== (a.magnitudeRaw === '0')) errors.push(`${p}: explicitZero must be true exactly when magnitudeRaw is "0"`);
    if (!a.sign || !['resolved', 'not_observed'].includes(a.sign.status)) errors.push(`${p}: a resolved amount needs sign.status resolved or not_observed`);
    else if (a.sign.status === 'resolved' && (!SIGNS.includes(a.sign.raw) || !a.sign.position)) errors.push(`${p}: resolved sign needs raw in ${SIGNS.join('/')} and position`);
    else if (a.sign.status === 'not_observed' && a.sign.raw !== null) errors.push(`${p}: not_observed sign must have raw null`);
  } else if (a.status === 'blank') {
    if (a.magnitudeRaw !== null || a.magnitudeNumeric !== null) errors.push(`${p}: a blank amount must not carry a value (blank is not 0)`);
    if (a.explicitZero !== false) errors.push(`${p}: a blank amount cannot be an explicit zero`);
    if (!a.sign || a.sign.status !== 'not_applicable') errors.push(`${p}: a blank amount has sign.status not_applicable`);
  } else errors.push(`${p}: an amount in Golden is resolved or blank (found ${a.status})`);
}

export function validateGolden(fx: Json): string[] {
  const errors: string[] = [];
  if (fx?.schemaVersion !== GOLDEN_SCHEMA_VERSION) errors.push('schemaVersion mismatch');
  if (JSON.stringify(fx?.statusVocabulary) !== JSON.stringify(STATUS_VOCABULARY)) errors.push('statusVocabulary must equal the Contract status model');
  const om = fx?.observationMethod;
  if (!om?.method || !om?.observer || !om?.humanReview || typeof om.usedExtractedTextForValues !== 'boolean') errors.push('observationMethod must record method, observer, humanReview, usedExtractedTextForValues');
  if (!Array.isArray(fx?.samples) || fx.samples.length === 0) return [...errors, 'samples missing'];
  const sampleIds = new Set<string>();
  const targetIds = new Set<string>();
  for (const s of fx.samples) {
    const sp = `sample ${s?.id}`;
    if (!s?.id || sampleIds.has(s.id)) errors.push(`${sp}: duplicate or missing sample id`);
    sampleIds.add(s?.id);
    if (typeof s?.document?.canonicalUrl !== 'string' || !s.document.canonicalUrl.startsWith('https://')) errors.push(`${sp}: document.canonicalUrl required`);
    if (!Number.isInteger(s?.sourcePage) || s.sourcePage < 1) errors.push(`${sp}: sourcePage must be a 1-based integer`);
    if (!s?.printedPageLabel) errors.push(`${sp}: printedPageLabel required`);
    const u = s?.pageUnitLabel;
    if (!u || !isStatus(u.status) || !['resolved', 'not_observed'].includes(u.status)) errors.push(`${sp}: pageUnitLabel.status must be resolved or not_observed`);
    else if ((u.status === 'resolved') !== (typeof u.raw === 'string' && u.raw.length > 0)) errors.push(`${sp}: pageUnitLabel raw must be present exactly when resolved`);
    if (typeof s?.hierarchyInput?.available !== 'boolean') errors.push(`${sp}: hierarchyInput.available required`);
    for (const a of s?.humanAnchors ?? []) if (typeof a.x !== 'number' || typeof a.y !== 'number' || !a.source || !a.text) errors.push(`${sp}: humanAnchor needs text, x, y, source`);
    if (!Array.isArray(s?.targets) || s.targets.length === 0) errors.push(`${sp}: targets missing`);
    for (const t of s?.targets ?? []) {
      const p = `target ${t?.id}`;
      if (!t?.id || targetIds.has(t.id)) errors.push(`${p}: duplicate or missing target id`);
      targetIds.add(t?.id);
      if (!KINDS.includes(t?.kind)) errors.push(`${p}: invalid kind`);
      if (!t?.visualLocator?.description || typeof t.visualLocator.approxYPt !== 'number') errors.push(`${p}: visualLocator needs description and approxYPt`);
      if (!['high', 'medium', 'low'].includes(t?.observationConfidence)) errors.push(`${p}: observationConfidence required`);
      const c = t?.rowLocal?.code;
      if (!c || c.status !== 'resolved' || !c.raw) errors.push(`${p}: code must be resolved with raw (resolved without evidence is rejected)`);
      const n = t?.rowLocal?.name;
      if (!n || n.status !== 'resolved' || !Array.isArray(n.rawLines) || n.rawLines.length === 0 || !n.normalized) errors.push(`${p}: name must be resolved with rawLines and normalized`);
      else {
        if (n.normalized !== n.rawLines.join('').replace(/\s+/g, '')) errors.push(`${p}: name.normalized must equal rawLines joined with whitespace removed`);
        if (n.wrapped !== n.rawLines.length > 1) errors.push(`${p}: name.wrapped must match the number of raw lines`);
      }
      for (const f of ['previousBudget', 'requestedBudget', 'difference']) checkAmount(`${p}.${f}`, t?.rowLocal?.[f], errors);
      for (const k of ['code', 'name', 'previousBudget', 'requestedBudget', 'difference', 'signs']) if (!t?.expectedSourceClass?.[k]) errors.push(`${p}: expectedSourceClass.${k} required`);
      for (const a of t?.auxiliary ?? []) {
        if (!AUX_CLASSES.includes(a.class) || !a.visualDescription) errors.push(`${p}: invalid auxiliary entry`);
        if (a.expectedAttachToAmountFields !== 'none') errors.push(`${p}: auxiliary must not attach to amount fields`);
      }
      const h = t?.hierarchy;
      if (!h || !HIER_STATES.includes(h.inputState)) errors.push(`${p}: invalid hierarchy.inputState`);
      for (const k of ['parentItemAssociation', 'parentOrganizationAssociation']) {
        const e = h?.expected?.[k];
        if (!e || !ASSOC_STATUS.includes(e.status)) errors.push(`${p}: hierarchy.expected.${k}.status invalid`);
        else if (e.status === 'resolved' && !(e.value?.code && e.value?.name)) errors.push(`${p}: a resolved hierarchy expectation needs value {code, name}`);
        else if (e.status === 'not_resolved' && !(Array.isArray(e.acceptableStatuses) && e.acceptableStatuses.length > 0 && e.acceptableStatuses.every((x: string) => ['unresolved', 'ambiguous'].includes(x)))) errors.push(`${p}: not_resolved needs acceptableStatuses (unresolved/ambiguous)`);
        if (s?.hierarchyInput?.available === false && e && e.status !== 'outside_v0_scope') errors.push(`${p}: no hierarchy artifact for this sample, so ${k} must be outside_v0_scope`);
      }
    }
  }
  return errors;
}

/** Contract §28 の coverage（実PDF上に例が無いものは NOT FOUND として明示し、値を作らない） */
export function goldenCoverage(fx: Json): { covered: Record<string, string[]>; notFound: string[] } {
  const targets: { sample: Json; t: Json }[] = fx.samples.flatMap((s: Json) => s.targets.map((t: Json) => ({ sample: s, t })));
  const ids = (pred: (x: { sample: Json; t: Json }) => boolean): string[] => targets.filter(pred).map(x => x.t.id);
  const amounts = (t: Json): Json[] => ['previousBudget', 'requestedBudget', 'difference'].map(f => t.rowLocal[f]);
  const covered: Record<string, string[]> = {
    'explicit sign (difference)': ids(({ t }) => t.rowLocal.difference.sign?.status === 'resolved'),
    'explicit sign (requested)': ids(({ t }) => t.rowLocal.requestedBudget.sign?.status === 'resolved'),
    'sign-like symbol that is not an amount sign': ids(({ t }) => (t.auxiliary ?? []).some((a: Json) => a.mustNotUseAsSign)),
    'blank amount': ids(({ t }) => amounts(t).some(a => a.status === 'blank')),
    'explicit zero': ids(({ t }) => amounts(t).some(a => a.status === 'resolved' && a.explicitZero)),
    'blank and explicit zero on the same page': [...new Set(targets.filter(({ sample }) => sample.targets.some((x: Json) => amounts(x).some(a => a.status === 'blank')) && sample.targets.some((x: Json) => amounts(x).some(a => a.explicitZero))).map(x => x.sample.id))] as string[],
    'auxiliary region beside the core row': ids(({ t }) => (t.auxiliary ?? []).length > 0),
    'auxiliary number must not fill an amount': ids(({ t }) => (t.auxiliary ?? []).some((a: Json) => a.class === 'inline_label_number' || a.class === 'breakdown_table')),
    'wrapped name': ids(({ t }) => t.rowLocal.name.wrapped),
    'hierarchy safe': ids(({ t }) => t.hierarchy.inputState === 'safe'),
    'hierarchy explicitly unresolved (root)': ids(({ t }) => t.hierarchy.inputState === 'explicitly_unresolved'),
    'hierarchy level_gap + strong header': ids(({ t }) => t.hierarchy.inputState === 'resolved_risky_or_level_gap'),
    'hierarchy resolved + strong header': ids(({ t }) => ['resolved_risky', 'safe_edge_risky_composition'].includes(t.hierarchy.inputState)),
    'page unit label observed': [...new Set(targets.filter(({ sample }) => sample.pageUnitLabel.status === 'resolved').map(x => x.sample.id))] as string[],
    'page unit label not observed': [...new Set(targets.filter(({ sample }) => sample.pageUnitLabel.status === 'not_observed').map(x => x.sample.id))] as string[],
  };
  return { covered, notFound: ['missing difference (previous and requested shown, difference not shown)', 'single-organization B placement as a field-level behavior'] };
}
