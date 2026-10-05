/**
 * rotate ≠ 0 の page を、人が通常の PDF viewer で見る向き（pdf.js の viewport。page の rotate を含む）に座標正規化する research-only 関数。
 * 規則は docs/tasks/20261005_2115_Budget_Request_8p6pt_Full_Corpus_With_Rotate90_Protocol.md。production の SourceToken / TableGeometry / FieldResolver は変更しない。
 * text item の transform T を U = F∘M∘T（M = viewport.transform、F = y 反転）へ変換して既存の toSourceTokens に渡し、罫線の端点は表示座標へ変換する。
 */
import type { DrawingPrimitive } from './budget-request-drawing-primitives';
import { pageMetaFrom, toSourceTokens, type PageMeta, type RawTextItem, type RawTextStyles, type SourceToken } from './budget-request-source-token';

export type Matrix = number[];
/** a∘b（b を先に適用） */
export const mul = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export const applyMatrix = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** U = F∘M∘T。F = [1,0,0,-1,0,viewportHeight]（表示の y 下向きを、toSourceToken が前提とする y 上向きへ戻す） */
export const normalizeItemTransform = (t: Matrix, viewportTransform: Matrix, viewportHeight: number): Matrix => mul([1, 0, 0, -1, 0, viewportHeight], mul(viewportTransform, t));

export interface PdfjsPageLike {
  rotate: number; view: number[];
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getTextContent(o: { disableNormalization: boolean }): Promise<{ items: unknown[]; styles: unknown }>;
}
export interface DisplayExtraction { meta: PageMeta; tokens: SourceToken[]; rotate: number; viewportTransform: Matrix }

/** rotate 0 の page は production の extractPageTokens と同じ導出。rotate ≠ 0 は表示向きへ正規化（meta の rotate は正規化後なので 0、元の rotate は戻り値の rotate） */
export async function extractDisplayPage(page: PdfjsPageLike, pageNumber: number, numPages: number): Promise<DisplayExtraction> {
  const content = await page.getTextContent({ disableNormalization: true });
  const items = content.items.filter((i): i is RawTextItem => typeof i === 'object' && i !== null && 'str' in (i as object)) as RawTextItem[];
  const styles = content.styles as RawTextStyles;
  const vp = page.getViewport({ scale: 1 });
  if (page.rotate === 0) return { meta: pageMetaFrom(pageNumber, numPages, page.view, 0), tokens: toSourceTokens(items, pageMetaFrom(pageNumber, numPages, page.view, 0), styles), rotate: 0, viewportTransform: vp.transform };
  const meta: PageMeta = { number: pageNumber, numPages, view: [0, 0, vp.width, vp.height], rotate: 0, width: round3(vp.width), height: round3(vp.height) };
  const norm = items.map(it => ({ ...it, transform: normalizeItemTransform(it.transform, vp.transform, vp.height) }));
  return { meta, tokens: toSourceTokens(norm, meta, styles), rotate: page.rotate, viewportTransform: vp.transform };
}

/** extractDrawingPrimitives（user space・左上原点: x − view[0]、view[3] − y）の線分を表示座標へ変換し、orientation を再導出する。rect・curve は変換しない */
export function normalizeLinePrimitives(prims: DrawingPrimitive[], view: number[], viewportTransform: Matrix): DrawingPrimitive[] {
  return prims.map(p => {
    if (p.kind !== 'line') return p;
    const [x1, y1] = applyMatrix(viewportTransform, p.x1 + view[0], view[3] - p.y1);
    const [x2, y2] = applyMatrix(viewportTransform, p.x2 + view[0], view[3] - p.y2);
    const orientation = Math.abs(x1 - x2) < 1e-3 ? 'vertical' : Math.abs(y1 - y2) < 1e-3 ? 'horizontal' : 'oblique';
    return { ...p, x1: round3(x1), y1: round3(y1), x2: round3(x2), y2: round3(y2), orientation };
  });
}
