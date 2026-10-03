/** H1 scope-completion audit — P4 の純粋評価（frozen artifact のみを入力とする。PDF・resolver 再推論なし）。 */
export const H1_LABELS = ['complete_on_current_logical_row', 'incomplete_continues_below', 'unclear'] as const;
export type H1Label = (typeof H1_LABELS)[number];
export type H1Decision = 'GO' | 'STOP' | 'INCONCLUSIVE';

export interface H1Counts { complete: number; incomplete: number; unclear: number; decisive: number }

export function countLabels(labels: string[]): H1Counts {
  for (const l of labels) if (!(H1_LABELS as readonly string[]).includes(l)) throw new Error(`unknown label: ${l}`);
  const complete = labels.filter(l => l === 'complete_on_current_logical_row').length;
  const incomplete = labels.filter(l => l === 'incomplete_continues_below').length;
  const unclear = labels.filter(l => l === 'unclear').length;
  return { complete, incomplete, unclear, decisive: complete + incomplete };
}

/** H1 事前登録 §11: GO = complete 0 かつ unclear 0 / STOP = complete >= 1 / INCONCLUSIVE = complete 0 かつ unclear >= 1 */
export function decideH1(c: Pick<H1Counts, 'complete' | 'unclear'>): H1Decision {
  if (c.complete >= 1) return 'STOP';
  return c.unclear === 0 ? 'GO' : 'INCONCLUSIVE';
}

export type HumanValidationStatus = 'VALIDATED' | 'CONTRADICTED' | 'INCONCLUSIVE';

/** HV-P2 事前登録 §11: VALIDATED = H_complete 0 かつ H_unclear 0 / CONTRADICTED = H_complete >= 1 / INCONCLUSIVE = H_complete 0 かつ H_unclear >= 1 */
export function humanValidationStatus(c: Pick<H1Counts, 'complete' | 'unclear'>): HumanValidationStatus {
  if (c.complete >= 1) return 'CONTRADICTED';
  return c.unclear === 0 ? 'VALIDATED' : 'INCONCLUSIVE';
}

export interface AgreementResult {
  total: number;
  exactAgreementCount: number;
  exactAgreementRate: number;
  /** confusion[human][ai] */
  confusion: Record<H1Label, Record<H1Label, number>>;
  disagreementCount: number;
  disagreementUnitIds: string[];
}

/** human と AI の exact label agreement（unitId の完全一致で結合。集合が一致しなければ throw） */
export function agreement(human: Map<string, string>, ai: Map<string, string>): AgreementResult {
  const hk = [...human.keys()].sort(), ak = [...ai.keys()].sort();
  if (hk.length !== ak.length || hk.some((k, i) => k !== ak[i])) throw new Error('human と AI の unitId 集合が一致しない');
  const confusion = Object.fromEntries(H1_LABELS.map(h => [h, Object.fromEntries(H1_LABELS.map(a => [a, 0]))])) as AgreementResult['confusion'];
  const dis: string[] = [];
  for (const id of hk) {
    const h = human.get(id) as H1Label, a = ai.get(id) as H1Label;
    if (!H1_LABELS.includes(h) || !H1_LABELS.includes(a)) throw new Error(`unknown label: ${id}`);
    confusion[h][a]++;
    if (h !== a) dis.push(id);
  }
  return { total: hk.length, exactAgreementCount: hk.length - dis.length, exactAgreementRate: (hk.length - dis.length) / hk.length, confusion, disagreementCount: dis.length, disagreementUnitIds: dis };
}
