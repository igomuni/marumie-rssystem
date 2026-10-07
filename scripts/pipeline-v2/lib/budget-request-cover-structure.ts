/**
 * FY2024 概算要求 Cover Structure v0 parser（preregistration docs/tasks/20261007_2310_..._Cover_Structure_v0_Preregistration.md §3・§5 の literal implementation）。
 * 入力は 1 page の Raw Text（nonEmptyLines）と source provenance のみ。page-local。GT・development fixture・manifest・path・辞書を参照しない（この module は他の fixture を import しない）。
 * 文字は補完しない。曖昧なら null / PARTIAL / UNRESOLVED（abstain）。
 *
 * 許可 operation: Raw Text の行順、先頭末尾 whitespace の除去、leader dots pattern、visible な ordinal / marker / code、source-order grouping、preregistered continuation rule。
 * continuation rule: SCOPE_REFERENCE の次の non-empty line が marker・ordinal・leader dots・末尾 page 参照のいずれも持たない場合、その行を直前の SCOPE_REFERENCE の nameRawParts の追加 part とする。語途中の分断は連結しない。
 */
export type Status = 'RESOLVED' | 'PARTIAL' | 'UNRESOLVED';
export interface CoverSource { filePath: string; fileSha256: string; physicalPage: number; textSha256: string }
export type CoverEntry =
  | { kind: 'SECTION_REFERENCE'; ordinalRaw: string | null; labelRawParts: string[]; printedPageRefRaw: string | null; status: Status }
  | { kind: 'SCOPE_REFERENCE'; markerRaw: string | null; codeRaw: string | null; nameRawParts: string[]; printedPageRefRaw: string | null; status: Status };
export interface CoverObservation {
  source: CoverSource;
  status: Status;
  header: { codeRaw: string | null; textRawParts: string[]; titleRawParts: string[]; status: Status };
  entries: CoverEntry[];
  /** どの field にも分類できなかった行（abstain の記録。semantic ではない） */
  unclassifiedLines: string[];
}

const LEADER = /[・･]{3,}/;
const TRAILING_REF = /\s\d{1,4}\s*$/;
const SECTION = /^\s*(\d+\.)\s*(\S.*?)\s*[・･]{3,}\s*(\S.*?)\s*$/;
const SCOPE = /^\s*([（(][^）)\s]+[）)])\s*(\d+)\s+(\S.*?)\s*[・･]{3,}\s*(\S.*?)\s*$/;
const HEADER = /^\s*(\d+)\s+(\S.*?)\s*$/;
const MARKER_START = /^\s*[（(][^）)\s]+[）)]/;
const ORDINAL_START = /^\s*\d+\./;

const isTitle = (line: string) => { const w = line.replace(/\s/g, ''); return w.startsWith('令和') && w.endsWith('要求書'); };

export function parseCoverPage(source: CoverSource, nonEmptyLines: { text: string }[]): CoverObservation {
  const lines = nonEmptyLines.map(l => l.text);
  const unclassified: string[] = [];
  // header: 先頭行
  const first = lines[0] ?? '';
  const hm = HEADER.exec(first);
  const header: CoverObservation['header'] = { codeRaw: hm ? hm[1] : null, textRawParts: hm ? [hm[2]] : first.trim() ? [first.trim()] : [], titleRawParts: [], status: hm ? 'RESOLVED' : first.trim() ? 'PARTIAL' : 'UNRESOLVED' };
  // title: header の後ろで最初に見つかる title 行
  let i = 1;
  while (i < lines.length && !isTitle(lines[i])) { if (lines[i].trim()) unclassified.push(lines[i]); i++; }
  if (i < lines.length) { header.titleRawParts = [lines[i].trim()]; i++; }
  else if (header.status === 'RESOLVED') header.status = 'PARTIAL';
  const entries: CoverEntry[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    const sm = SECTION.exec(line);
    const cm = sm ? null : SCOPE.exec(line);
    if (sm) { entries.push({ kind: 'SECTION_REFERENCE', ordinalRaw: sm[1], labelRawParts: [sm[2]], printedPageRefRaw: sm[3], status: 'RESOLVED' }); continue; }
    if (cm) { entries.push({ kind: 'SCOPE_REFERENCE', markerRaw: cm[1], codeRaw: cm[2], nameRawParts: [cm[3]], printedPageRefRaw: cm[4], status: 'RESOLVED' }); continue; }
    const prev = entries[entries.length - 1];
    const isContinuation = prev?.kind === 'SCOPE_REFERENCE' && !MARKER_START.test(line) && !ORDINAL_START.test(line) && !LEADER.test(line) && !TRAILING_REF.test(line);
    if (isContinuation) { (prev as Extract<CoverEntry, { kind: 'SCOPE_REFERENCE' }>).nameRawParts.push(line.trim()); continue; }
    unclassified.push(line);
  }
  const allEntriesResolved = entries.every(e => e.status === 'RESOLVED');
  const status: Status = entries.length === 0 && header.codeRaw === null ? 'UNRESOLVED'
    : header.status === 'RESOLVED' && header.titleRawParts.length > 0 && entries.length > 0 && allEntriesResolved && unclassified.length === 0 ? 'RESOLVED' : 'PARTIAL';
  return { source, status, header, entries, unclassifiedLines: unclassified };
}

/** 評価専用の比較列: parts を連結し Unicode whitespace のみ除去。全角/半角の字幅差のうち preregistration で列挙したもの（数字・丸括弧）だけを吸収する（source raw は書き換えない） */
export function comparisonCharacterSequence(parts: string[]): string {
  return parts.join('').replace(/\s/gu, '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/（/g, '(').replace(/）/g, ')');
}
