export type AuditFragment = { sourcePdf: string; page: number; rawLineIndex: number; rawLine: string; rawText: string; reason: string };
export type CsvRecord = { 要求番号: string; 区分: string; ページ: string };
const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;
const codePattern = '\\d{2}[‐‑-]\\d{2}';
type Start = { at: number; contentAt: number; kind: 'R' | 'I'; number: string; code?: string; separator?: string; itemNumber?: string; token?: string };

function startsIn(line: string): Start[] {
  const starts: Start[] = [];
  const r = new RegExp(`(^|\\s)(\\d{1,3})\\s+(${codePattern})(\\s+)`, 'gu');
  for (const m of line.matchAll(r)) starts.push({ at: m.index! + m[1].length, contentAt: m.index! + m[0].length, kind: 'R', number: m[2], code: m[3], separator: m[4] });
  const i = /(^|\s)(（項）\s*\d+)\s+/gu;
  for (const m of line.matchAll(i)) starts.push({ at: m.index! + m[1].length, contentAt: m.index! + m[0].length, kind: 'I', number: '', itemNumber: /\d+/u.exec(m[2])![0], token: m[2].replace(/\d+$/u, '') });
  return starts.sort((a, b) => a.at - b.at);
}
function sideAt(line: string, at: number): 'left' | 'right' | 'ambiguous' {
  const column = [...line.slice(0, at)].length;
  return column < 30 ? 'left' : column > 30 ? 'right' : 'ambiguous';
}
function excludedLineReason(line: string): string | undefined {
  const t = line.trim();
  if (!t) return 'blank line';
  if (/^(要求|番号|区\s*分|ページ|頁|目次|目\s*次|令和|平成|昭和|内\s*閣|\d+\s*)/u.test(t) && !new RegExp(codePattern, 'u').test(t) && !/（項）/u.test(t)) return 'page header/title or isolated page marker';
  if (/^(?:要求番号|区分|ページ)/u.test(t)) return 'column header';
  return undefined;
}
function parseOnePage(text: string, sourcePdf: string, page: number) {
  const records: CsvRecord[] = [], audit: AuditFragment[] = [];
  const latest: Record<'left' | 'right', CsvRecord | undefined> = { left: undefined, right: undefined };
  const addAudit = (rawLineIndex: number, rawLine: string, reason: string) => audit.push({ sourcePdf, page, rawLineIndex, rawLine, rawText: rawLine, reason });
  for (const [rawLineIndex, sourceLine] of text.split('\n').entries()) {
    const rawLine = sourceLine.replace(/\r$/u, '');
    const starts = startsIn(rawLine);
    if (starts.length) {
      const first = rawLine.search(/\S/u);
      const prefix = first >= 0 ? rawLine.slice(first, starts[0].at).trim() : '';
      if (prefix) {
        const prefixSide = sideAt(rawLine, first);
        if (prefixSide !== 'ambiguous' && latest[prefixSide]) latest[prefixSide]!.区分 += prefix;
        else addAudit(rawLineIndex, rawLine, prefixSide === 'ambiguous' ? 'unresolved pre-start text at ambiguous development boundary' : 'unresolved pre-start continuation: no unique same-side parent record');
      }
      for (let i = 0; i < starts.length; i++) {
        const s = starts[i], side = sideAt(rawLine, s.at);
        if (side === 'ambiguous') { addAudit(rawLineIndex, rawLine, 'start token at ambiguous development boundary column 30'); continue; }
        const seg = rawLine.slice(s.contentAt, starts[i + 1]?.at ?? rawLine.length);
        const pm = /\s+(\d{1,4})\s*$/u.exec(seg), printedPage = pm?.[1] ?? '';
        const label = seg.replace(/\s+\d{1,4}\s*$/u, '').trim();
        if (!printedPage || !label) {
          addAudit(rawLineIndex, rawLine, !printedPage ? 'start token without printed terminal page candidate' : 'start token without a label');
          latest[side] = undefined;
          continue;
        }
        const record: CsvRecord = s.kind === 'R'
          ? { 要求番号: s.number, 区分: `${s.code}${s.separator}${label}`, ページ: printedPage }
          : { 要求番号: '', 区分: `${s.token}${s.itemNumber} ${label}`, ページ: printedPage };
        records.push(record); latest[side] = record;
      }
      continue;
    }
    const excluded = excludedLineReason(rawLine);
    if (excluded) { if (rawLine.trim()) addAudit(rawLineIndex, rawLine, `excluded: ${excluded}`); continue; }
    const first = rawLine.search(/\S/u), side = sideAt(rawLine, first);
    if (side === 'ambiguous') { addAudit(rawLineIndex, rawLine, 'unclassified text begins at ambiguous development boundary column 30'); continue; }
    const fragment = rawLine.slice(first).trim();
    if (latest[side]) latest[side]!.区分 += fragment;
    else addAudit(rawLineIndex, rawLine, 'unresolved continuation: no unique same-side parent record');
  }
  return { records, audit };
}
export function tocPage(text: string, sourcePdf: string, page: number) {
  const pages = text.split('\f');
  const parsed = pages.map((pageText, offset) => parseOnePage(pageText, sourcePdf, page + offset));
  return { records: parsed.flatMap(result => result.records), audit: parsed.flatMap(result => result.audit) };
}
export function renderTocCsv(records: CsvRecord[]) {
  return ['要求番号,区分,ページ', ...records.map(r => [r.要求番号, r.区分, r.ページ].map(csv).join(','))].join('\n') + '\n';
}
export function coverPage(text: string, sourcePdf = 'cover', page = 1) {
  const lines = text.split('\n').map(line => line.replace(/\r$/u, ''));
  const authorityIndex = lines.findIndex(line => /内\s*閣\s*府\s*所\s*管/u.test(line));
  const authorityLine = lines[authorityIndex]?.trim() ?? '';
  const authority = authorityLine;
  const titleIndex = lines.findIndex(line => /歳\s*出\s*概\s*算\s*要\s*求\s*書/u.test(line));
  const titleLine = lines[titleIndex]?.trim() ?? '';
  const titleMatch = /^(.*?書)/u.exec(titleLine), title = titleMatch?.[1]?.trim() ?? '';
  const year = /令\s*和\s*６\s*年\s*度/u.exec(title)?.[0] ?? '';
  const fiscalYear = year, documentName = title.slice(year.length).trim();
  if (!authority || !fiscalYear || !documentName) throw new Error('selected Cover page does not support the fixed four-column schema');
  const represented = new Set([authorityIndex, titleIndex]);
  const audit: AuditFragment[] = lines.flatMap((rawLine, rawLineIndex) => rawLine.trim() && !represented.has(rawLineIndex)
    ? [{ sourcePdf, page, rawLineIndex, rawLine, rawText: rawLine, reason: 'excluded: Cover line is not represented in the four CSV fields' }]
    : []);
  return { csv: ['年度,所管,会計,資料名', [fiscalYear, authority, '', documentName].map(csv).join(',')].join('\n') + '\n', audit };
}
