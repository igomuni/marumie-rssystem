/**
 * SourceToken層（概算要求PDF Extraction PoC）。PDFのtext layerから「何が・どこに・どの粒度で」取れたかを
 * 忠実に保持する。意味を決めない（単語化・行化・読み順・列/領域の分類・Coreとの関連付けは後段の責務）。
 *
 * SourceTokenは意味的な「単語」ではない。pdf.jsのtext item 1個 = SourceToken 1個で、
 * `01-95` が1 itemになる保証も、日本語の事項名が1 itemになる保証もない。rawTextはpdf.jsが返した文字列を
 * 補正・正規化せずそのまま保持する（空文字・空白のみのitemも落とさない）。
 *
 * ## 座標系（bboxの意味）
 * - 原点: ページ左上 / x: 右が正 / y: 下が正 / 単位: pt（1/72 inch）。pdf.jsのviewport(scale=1, rotation=0)と同じ向き。
 * - ページ領域は `page.view`（[x0,y0,x1,y1]、PDF user space）。pageWidth=x1-x0, pageHeight=y1-y0。
 * - 元のPDF user space（原点左下・y上向き）の値は `transform`（pdf.jsのtext item transform。[a,b,c,d,e,f]で
 *   (e,f)=ベースライン開始点）にそのまま残す。bboxはそこから次のように導出する:
 *     xMin = e - view.x0,  xMax = xMin + width
 *     yMin = pageHeight - (f - view.y0) - ascent * fontSize   （文字の上端）
 *     yMax = pageHeight - (f - view.y0) - descent * fontSize  （文字の下端。descentは負値）
 *   fontSize = pdf.jsのitem.height、ascent/descent = pdf.jsのtextContent.styles[fontName]（フォントのmetrics。
 *   埋め込みフォントのglyph実寸ではなく近似）。したがって yMin/yMax は文字のインク範囲ではなく
 *   「text item の em ボックス（pdf.js のフォント metrics 由来）」である。xMin/xMaxはitem.widthによる。
 * - 人間が過去に確認した座標（x, y）はこの bbox の (xMin, yMin) と同じ座標系（左上原点・上端）で一致する。
 * - 回転ページ（rotate != 0）は未対応（PoC範囲外）。例外にする。
 */

export const SOURCE_TOKEN_SCHEMA = 'budget-request-source-token-poc/v1';

export interface SourceTokenBBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface SourceToken {
  /** pdf.js getTextContent().items 内の順序（content stream順。読み順ではない） */
  index: number;
  /** pdf.jsが返した文字列そのまま（正規化・補正・trimなし。空文字・空白のみもあり得る） */
  rawText: string;
  /** PDFの物理ページ番号（1始まり） */
  page: number;
  /** 上記の座標系での外接矩形（小数3桁に丸め） */
  bbox: SourceTokenBBox;
  /** pdf.js text itemのtransform（PDF user space, 原点左下）。丸めずそのまま */
  transform: [number, number, number, number, number, number];
  /** pdf.js item.width（pt） */
  width: number;
  /** pdf.js item.height（フォントサイズ由来。pt） */
  fontSize: number;
  fontName: string;
  /** pdf.jsのitem.hasEOL（content streamの改行位置。意味的な行ではない） */
  hasEOL: boolean;
  dir: string;
}

export interface PageCoordinateSystem {
  origin: 'top-left';
  xDirection: 'right';
  yDirection: 'down';
  unit: 'pt (1/72 inch)';
  bboxDefinition: string;
}

export const COORDINATE_SYSTEM: PageCoordinateSystem = {
  origin: 'top-left',
  xDirection: 'right',
  yDirection: 'down',
  unit: 'pt (1/72 inch)',
  bboxDefinition:
    'xMin=e-view.x0, xMax=xMin+width, yMin=pageHeight-(f-view.y0)-ascent*fontSize (top), yMax=pageHeight-(f-view.y0)-descent*fontSize (bottom); (e,f)=transform baseline origin; ascent/descent=pdf.js font metrics (approximate em box, not glyph ink box)',
};

export interface PageMeta {
  /** 物理ページ番号（1始まり） */
  number: number;
  numPages: number;
  /** PDF user spaceのpage view [x0, y0, x1, y1] */
  view: [number, number, number, number];
  rotate: number;
  width: number;
  height: number;
}

/** pdf.js text item / style のうち使う部分（テストで差し替えられるよう最小限の形） */
export interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
  dir: string;
}
export type RawTextStyles = Record<string, { ascent: number; descent: number }>;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function pageMetaFrom(number: number, numPages: number, view: number[], rotate: number): PageMeta {
  if (rotate !== 0) throw new Error(`回転ページ(rotate=${rotate})は未対応です（page ${number}）`);
  const v = view as [number, number, number, number];
  return { number, numPages, view: v, rotate, width: round3(v[2] - v[0]), height: round3(v[3] - v[1]) };
}

/** page番号の検証（1以上numPages以下の整数） */
export function assertValidPage(page: number, numPages: number): void {
  if (!Number.isInteger(page) || page < 1 || page > numPages) {
    throw new Error(`pageは1〜${numPages}の整数で指定してください: ${page}`);
  }
}

/** pdf.js text item → SourceToken（値の補正・正規化はしない。bboxの導出のみ） */
export function toSourceToken(item: RawTextItem, index: number, meta: PageMeta, styles: RawTextStyles): SourceToken {
  const style = styles[item.fontName];
  if (!style) throw new Error(`fontName "${item.fontName}" のstyleがありません（page ${meta.number}, item ${index}）`);
  const [x0, y0] = meta.view;
  const e = item.transform[4];
  const f = item.transform[5];
  const baselineY = meta.height - (f - y0);
  const xMin = e - x0;
  return {
    index,
    rawText: item.str,
    page: meta.number,
    bbox: {
      xMin: round3(xMin),
      yMin: round3(baselineY - style.ascent * item.height),
      xMax: round3(xMin + item.width),
      yMax: round3(baselineY - style.descent * item.height),
    },
    transform: item.transform.slice(0, 6) as SourceToken['transform'],
    width: item.width,
    fontSize: item.height,
    fontName: item.fontName,
    hasEOL: item.hasEOL,
    dir: item.dir,
  };
}

export function toSourceTokens(items: RawTextItem[], meta: PageMeta, styles: RawTextStyles): SourceToken[] {
  return items.map((item, i) => toSourceToken(item, i, meta, styles));
}

// ---- 人間確認値との比較（評価専用。Extractorの入力・補正には使わない） ---------------------------

export interface HumanObservation {
  /** 比較対象のtokenのrawTextに含まれる文字列 */
  text: string;
  /** 人間が確認した位置（bboxと同じ座標系の左上点。x=左端, y=上端） */
  x: number;
  y: number;
}

export interface ObservationComparison {
  observation: HumanObservation;
  /** 期待位置に最も近いtoken（rawTextにobservation.textを含むものの中から）。無ければundefined */
  token?: SourceToken;
  dx?: number;
  dy?: number;
}

/** 期待位置に最も近い（rawTextにtextを含む）tokenを探し、差を返す。tokenを補正・生成しない */
export function compareObservation(tokens: SourceToken[], observation: HumanObservation): ObservationComparison {
  let best: ObservationComparison = { observation };
  let bestDist = Infinity;
  for (const t of tokens) {
    if (!t.rawText.includes(observation.text)) continue;
    const dx = t.bbox.xMin - observation.x;
    const dy = t.bbox.yMin - observation.y;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = { observation, token: t, dx: round3(dx), dy: round3(dy) };
    }
  }
  return best;
}
