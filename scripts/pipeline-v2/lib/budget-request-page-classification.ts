/**
 * FY2024 概算要求 Page Classification v0 の literal implementation（frozen v0 specification。ルールの追加・変更なし）。
 * 入力は PR-1 の Raw Text（nonEmptyLines）と Phase A の EMPTY-page observation のみ。manifest role・MOF・OCR・GT は使わない。
 *
 * 規則（v0 preregistration docs/tasks/20261007_1925_..._v0_Preregistration.md §4–5）:
 *   - DIRECT: lib/budget-request-page-classification-direct.ts の frozen matcher（先頭 5 non-empty lines）。CONFLICT は UNRESOLVED（source=null）で state を reset。
 *   - INHERITED: DIRECT が NONE の TEXT_OBSERVABLE page に限り、physical PDF 内の active state family を継承する。look-ahead しない。
 *   - DIRECT で state 更新: 継承可能 family（TOC/SUMMARY/DETAIL/STAFFING/PRIORITY_*）はその family、COVER は state を持たず破棄。
 *   - Phase A VISUALLY_BLANK: NO_TEXT。state を変えない（blank bridge）。
 *   - それ以外の Raw Text EMPTY（RASTER・fully-EMPTY 文書・Phase A に無い EMPTY）: NO_TEXT。state を reset し橋渡ししない。
 *   - state は physical PDF ごとに初期化する。OTHER は出力しない（direct-detect rule が無い）。
 * Raw Text が無い page を semantic UNRESOLVED にはしない（status=NO_TEXT, pageType=null）。
 */
import { directMatch, INHERITABLE, type DirectFamily } from './budget-request-page-classification-direct';
import { sha256Hex } from './budget-request-raw-text';

export type RawStatus = 'EXTRACTED' | 'EMPTY';
/** Phase A の isolation category を runtime 入力として受ける（frozen fixture 由来。EXTRACTED page では NONE） */
export type EmptyKind = 'NONE' | 'VISUALLY_BLANK' | 'RASTER' | 'UNRESOLVED_EMPTY';

export interface ClassifierPageInput {
  physicalPage: number;
  rawStatus: RawStatus;
  textSha256: string;
  nonEmptyLines: { text: string }[];
  emptyKind: EmptyKind;
}
export type SemanticPageType = DirectFamily | 'OTHER' | 'UNRESOLVED';
export interface PageClassificationRecord {
  localPdfPath: string;
  pdfSha256: string;
  physicalPage: number;
  rawText: { status: RawStatus; textSha256: string };
  classification: { status: 'RESOLVED' | 'UNRESOLVED' | 'NO_TEXT'; pageType: SemanticPageType | null; source: 'DIRECT' | 'INHERITED' | null; reason: string | null };
  stateObservation: { activeFamilyBefore: string | null; activeFamilyAfter: string | null; resetReason: string | null };
}

export const CLASSIFIER_SPEC_VERSION = 'page-classification-v0-frozen';

/** 1 つの physical PDF の page 列を順に分類する。page は 1..n の連続でなければ throw（順序・欠落・重複の検査） */
export function classifyDocument(localPdfPath: string, pdfSha256: string, pages: ClassifierPageInput[], expectedPageCount?: number): PageClassificationRecord[] {
  if (expectedPageCount !== undefined && pages.length !== expectedPageCount) throw new Error(`page count mismatch: ${localPdfPath} ${pages.length}/${expectedPageCount}`);
  pages.forEach((p, i) => { if (p.physicalPage !== i + 1) throw new Error(`page order/boundary mismatch: ${localPdfPath} expected ${i + 1} got ${p.physicalPage}`); });
  let state: DirectFamily | null = null;
  return pages.map(p => {
    const before = state;
    let reset: string | null = null;
    let cls: PageClassificationRecord['classification'];
    if (p.rawStatus === 'EMPTY') {
      if (p.emptyKind === 'VISUALLY_BLANK') {
        cls = { status: 'NO_TEXT', pageType: null, source: null, reason: 'NO_TEXT_VISUALLY_BLANK' };
      } else {
        cls = { status: 'NO_TEXT', pageType: null, source: null, reason: p.emptyKind === 'RASTER' ? 'NO_TEXT_RASTER_OR_IMAGE_DOMINANT' : 'NO_TEXT_UNRESOLVED' };
        if (state !== null) reset = cls.reason;
        state = null;
      }
    } else {
      const d = directMatch(p.nonEmptyLines);
      if (d.kind === 'DIRECT') {
        cls = { status: 'RESOLVED', pageType: d.family, source: 'DIRECT', reason: null };
        state = (INHERITABLE as readonly string[]).includes(d.family) ? d.family : null;
        if (state === null && before !== null) reset = 'DIRECT_NON_INHERITABLE';
      } else if (d.kind === 'CONFLICT') {
        cls = { status: 'UNRESOLVED', pageType: 'UNRESOLVED', source: null, reason: `DIRECT_CONFLICT:${d.families.join('|')}` };
        if (state !== null) reset = 'DIRECT_CONFLICT';
        state = null;
      } else if (state !== null) {
        cls = { status: 'RESOLVED', pageType: state, source: 'INHERITED', reason: null };
      } else {
        cls = { status: 'UNRESOLVED', pageType: 'UNRESOLVED', source: null, reason: 'NO_ACTIVE_STATE' };
      }
    }
    return { localPdfPath, pdfSha256, physicalPage: p.physicalPage, rawText: { status: p.rawStatus, textSha256: p.textSha256 }, classification: cls, stateObservation: { activeFamilyBefore: before, activeFamilyAfter: state, resetReason: reset } };
  });
}

export const recordLine = (r: PageClassificationRecord) => JSON.stringify(r);
export const documentDigest = (records: PageClassificationRecord[]) => sha256Hex(records.map(recordLine).join('\n') + '\n');

export function verifyHashes(localPdfPath: string, h: { expectedPdfSha256: string; actualPdfSha256: string; expectedPageTextSha256: string[]; actualPageTextSha256: string[] }) {
  if (h.expectedPdfSha256 !== h.actualPdfSha256) throw new Error(`pdf sha256 mismatch: ${localPdfPath}`);
  h.expectedPageTextSha256.forEach((e, i) => { if (e !== h.actualPageTextSha256[i]) throw new Error(`text sha256 mismatch: ${localPdfPath} page ${i + 1}`); });
}
