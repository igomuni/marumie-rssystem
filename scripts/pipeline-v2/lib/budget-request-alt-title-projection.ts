/**
 * source-only alternative title projection（research-only。production の title extractor には接続しない）。
 * 規則は docs/tasks/20261005_1135_Budget_Request_Alternative_Title_Projection_Preregistration.md: 現行 projection が observed_blank を返す page で、現行の最初の code row が
 * frozen label-shaped predicate（上端帯・prefix(inner) 形）を満たす場合に限り、その row を丸ごと title として projection する。それ以外は現行と同一。補完・bridge・救済はしない。
 */
import { classifyRow, titleOfPage, type LogicalRowText, type PageTitle } from './budget-request-header-label';
import { evidenceOf } from './budget-request-title-ordering';

export interface AltRow extends LogicalRowText { x: number; y: number }
export type ProjectionBasis = 'before_first_code_row' | 'label_on_first_code_row';
export interface AltProjection { title: PageTitle; basis: ProjectionBasis | null; otherLabelRowsDifferingFromProjected: number; labelShapedRows: number }

export function titleOfPageAlt(rows: AltRow[], pageHeight: number): AltProjection {
  const current = titleOfPage(rows);
  const evs = rows.map(r => evidenceOf({ index: r.logicalRowIndex, x: r.x, y: r.y, texts: r.texts, physicalRowIndexes: r.physicalRowIndexes, tokenIndexes: r.tokenIndexes }, pageHeight));
  const labelShapedRows = evs.filter(e => e.labelShaped).length;
  if (current.status === 'observed_nonblank') return { title: current, basis: 'before_first_code_row', otherLabelRowsDifferingFromProjected: 0, labelShapedRows };
  if (current.status !== 'observed_blank') return { title: current, basis: null, otherLabelRowsDifferingFromProjected: 0, labelShapedRows };
  const firstCode = rows.findIndex(r => classifyRow(r.texts) !== 'other');
  if (firstCode < 0 || !evs[firstCode].labelShaped) return { title: current, basis: null, otherLabelRowsDifferingFromProjected: 0, labelShapedRows };
  const e = evs[firstCode], r = rows[firstCode];
  const title: PageTitle = {
    status: 'observed_nonblank', blankReason: null, firstTitleRaw: e.raw, firstTitleNormalized: e.normalized,
    shape: { length: e.normalized.length, parenthesized: true, prefixLength: e.shape!.prefixLength, innerLength: e.shape!.innerLength },
    sourceRefs: { logicalRowIndex: r.logicalRowIndex, physicalRowIndexes: r.physicalRowIndexes, tokenIndexes: r.tokenIndexes },
  };
  return { title, basis: 'label_on_first_code_row', otherLabelRowsDifferingFromProjected: evs.filter((x, i) => i !== firstCode && x.labelShaped && x.normalized !== e.normalized).length, labelShapedRows };
}
