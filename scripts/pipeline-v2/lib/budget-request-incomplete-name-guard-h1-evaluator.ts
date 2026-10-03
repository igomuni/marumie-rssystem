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
