/** FieldResolver v0 held-out GT の検証と、事前登録した quota / informative 要件の集計（評価側）。 */
import type { HeldoutManifest } from './budget-request-field-resolver-heldout-manifest';

interface Amount { cellState: string; status: string; magnitudeRaw: string | null; magnitudeNumeric: number | null; explicitZero: boolean; sign: { status: string; raw: string | null } }
export interface HeldoutGoldenTarget {
  id: string;
  kind: string;
  visualLocator: { approxYPt: number; yToleranceBandPt: number };
  rowLocal: { code: { status: string; raw: string | null }; name: { status: string; rawLines: string[]; normalized: string | null; wrapped?: boolean }; previousBudget: Amount; requestedBudget: Amount; difference: Amount };
  auxiliary: { class: string }[];
}
export interface HeldoutGoldenSample { id: string; tier: string; columnLayout: string; document: { canonicalUrl: string }; sourcePage: number; targets: HeldoutGoldenTarget[] }
export interface HeldoutGolden { schemaVersion: string; freezeCommit: string; samples: HeldoutGoldenSample[]; humanReview: { status: string } }

const AMOUNTS = ['previousBudget', 'requestedBudget', 'difference'] as const;

export function validateHeldoutGolden(g: HeldoutGolden, m: HeldoutManifest): string[] {
  const errors: string[] = [];
  if (g.schemaVersion !== 'budget-request-field-resolver-heldout-golden/v0') errors.push('schemaVersion');
  if (g.freezeCommit !== m.freezeCommit) errors.push('freezeCommit が manifest と異なる');
  const expected = new Map<string, string>(m.documents.flatMap(d => d.pages.map(p => [`${d.canonicalUrl}#${p.physicalPage}`, p.category] as [string, string])));
  for (const s of g.samples) {
    const key = `${s.document.canonicalUrl}#${s.sourcePage}`;
    if (!expected.has(key)) errors.push(`${s.id}: manifest に無いページ`);
    else if (expected.get(key) !== s.tier) errors.push(`${s.id}: tier が manifest と異なる`);
    expected.delete(key);
    const ids = new Set<string>();
    for (const t of s.targets) {
      const at = `${s.id}/${t.id}`;
      if (ids.has(t.id)) errors.push(`${at}: target id 重複`);
      ids.add(t.id);
      if (t.rowLocal.code.status !== 'resolved' || !t.rowLocal.code.raw) errors.push(`${at}: code`);
      const n = t.rowLocal.name;
      if (n.status !== 'resolved' || n.rawLines.join('').replace(/[\s　]+/g, '') !== n.normalized) errors.push(`${at}: name.normalized が rawLines と整合しない`);
      for (const f of AMOUNTS) {
        const a = t.rowLocal[f];
        if (a.cellState === 'visually uncertain') { errors.push(`${at}.${f}: visually uncertain は GT に入れない（評価対象外として記録しない）`); continue; }
        if (a.cellState === 'visual blank') {
          if (a.status !== 'blank' || a.magnitudeRaw !== null || a.magnitudeNumeric !== null || a.explicitZero) errors.push(`${at}.${f}: blank は値を持たない`);
          if (a.sign.status !== 'not_applicable') errors.push(`${at}.${f}: blank の符号は not_applicable`);
        } else {
          if (a.status !== 'resolved' || !a.magnitudeRaw || a.magnitudeNumeric !== Number(a.magnitudeRaw.replace(/,/g, ''))) errors.push(`${at}.${f}: magnitude`);
          if ((a.cellState === 'explicit zero') !== (a.magnitudeRaw === '0') || a.explicitZero !== (a.magnitudeRaw === '0')) errors.push(`${at}.${f}: explicit zero`);
          if (a.sign.status === 'resolved' ? !['△', '▲', '-'].includes(a.sign.raw ?? '') : a.sign.status !== 'not_observed') errors.push(`${at}.${f}: sign`);
          if (a.explicitZero && a.sign.status === 'resolved') errors.push(`${at}.${f}: 0 に符号`);
        }
      }
    }
  }
  for (const k of expected.keys()) errors.push(`manifest のページに GT sample が無い: ${k}`);
  return errors;
}

export interface HeldoutGtSummary {
  pages: number;
  targets: number;
  visualBlankFields: number;
  explicitZeroFields: number;
  explicitSignFields: number;
  wrappedNameTargets: number;
  auxiliaryTargets: number;
  templateNoveltyPages: number;
  quota: { blankTarget: 20; blankObserved: number; blankMet: boolean; zeroTarget: 10; zeroObserved: number; zeroMet: boolean };
  informativeKinds: string[];
  informative: boolean;
}

export function summarizeHeldoutGt(g: HeldoutGolden): HeldoutGtSummary {
  const ts = g.samples.flatMap(s => s.targets);
  const fields = ts.flatMap(t => AMOUNTS.map(f => t.rowLocal[f]));
  const blank = fields.filter(a => a.cellState === 'visual blank').length;
  const zero = fields.filter(a => a.cellState === 'explicit zero').length;
  const sign = fields.filter(a => a.sign.status === 'resolved').length;
  const wrapped = ts.filter(t => t.rowLocal.name.wrapped).length;
  const aux = ts.filter(t => t.auxiliary.some(a => a.class !== 'none')).length;
  const novelty = g.samples.filter(s => s.columnLayout !== 'standard-ledger').length;
  const kinds = [blank > 0 && 'blank', zero > 0 && 'explicit zero', sign > 0 && 'explicit sign', aux > 0 && 'auxiliary-heavy', wrapped > 0 && 'wrapped name', novelty > 0 && 'template novelty'].filter(Boolean) as string[];
  return {
    pages: g.samples.length,
    targets: ts.length,
    visualBlankFields: blank,
    explicitZeroFields: zero,
    explicitSignFields: sign,
    wrappedNameTargets: wrapped,
    auxiliaryTargets: aux,
    templateNoveltyPages: novelty,
    quota: { blankTarget: 20, blankObserved: blank, blankMet: blank >= 20, zeroTarget: 10, zeroObserved: zero, zeroMet: zero >= 10 },
    informativeKinds: kinds,
    informative: kinds.length >= 3,
  };
}
