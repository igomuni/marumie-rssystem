export type AuditFragment = {
  sourcePdf: string;
  page: number;
  rawLineIndex: number;
  rawLine: string;
  rawText: string;
  reason: string;
  scope?: 'cover' | 'toc';
};
export type CsvRecord = { 要求番号: string; 区分: string; ページ: string };
export type CoverRecord = {
  source_pdf: string;
  physical_page: number;
  header_code: string;
  header_name: string;
  year_raw: string;
  document_title_raw: string;
};
export type CoverEntry = {
  source_pdf: string;
  physical_page: number;
  entry_order: number;
  区分: string;
  ページ: string;
};
export type SourceTrace = { sourcePdf: string; page: number; rawLineIndex: number; side?: 'left' | 'right'; csvRecordIndex: number; scope: 'cover' | 'toc'; role: string; recordType?: 'cover' | 'cover_entry' | 'toc' };
export function offsetCoverProvenance(traces: SourceTrace[], coverRecordOffset: number, entryRecordOffset: number) {
  return traces.map(trace => ({
    ...trace,
    csvRecordIndex: trace.recordType === 'cover'
      ? trace.csvRecordIndex + coverRecordOffset
      : trace.recordType === 'cover_entry'
        ? trace.csvRecordIndex + entryRecordOffset
        : trace.csvRecordIndex,
  }));
}
const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;
const codePattern = '\\d{2}[‐‑-]\\d{2}';
const markerPattern = '（(?:項|組織|所管|会計|勘定)）';
type Start = { at: number; kind: 'request' | 'item' | 'marker' | 'numbered' | 'table'; requestNumber: string; prefix: string; side: 'left' | 'right' };
type MutableTocRecord = CsvRecord & { side: 'left' | 'right'; sourceLines: number[]; physicalPage: number };

function findHeaderBoundary(lines: string[]): number | undefined {
  for (const line of lines) {
    const requests = [...line.matchAll(/要求/gu)].map(m => m.index!);
    const pages = [...line.matchAll(/ページ/gu)].map(m => m.index!);
    if (requests.length >= 2 && pages.length >= 1 && requests[1] > pages[0]) {
      return Math.floor((pages[0] + 'ページ'.length + requests[1]) / 2);
    }
  }
  return undefined;
}

function addStart(starts: Start[], line: string, at: number, kind: Start['kind'], requestNumber = '', prefix = '') {
  if (starts.some(s => s.at === at)) return;
  starts.push({ at, kind, requestNumber, prefix, side: 'left' });
}

function findStarts(line: string, boundary: number): Start[] {
  const starts: Start[] = [];
  const request = new RegExp(`(^|[\\s])([0-9]{1,3})[\\t \u3000]+(${codePattern})[\\t \u3000]+`, 'gu');
  for (const m of line.matchAll(request)) { const codeOffset = m[0].indexOf(m[3]); addStart(starts, line, m.index! + m[1].length, 'request', m[2], `${m[3]}${m[0].slice(codeOffset + m[3].length)}`); }
  const marker = new RegExp(`(^|[\\s])(${markerPattern})[\\t \u3000]*([0-9]{1,4})?[\\t \u3000]*`, 'gu');
  for (const m of line.matchAll(marker)) {
    const at = m.index! + m[1].length;
    addStart(starts, line, at, 'marker', '', m[0].slice(m[1].length));
  }
  const ordinal = /(^|[\t \u3000])([0-9]{1,2}[.)．、])[\t \u3000]*(?=令和|平成|昭和|概算要求|歳出概算)/gu;
  for (const m of line.matchAll(ordinal)) addStart(starts, line, m.index! + m[1].length, 'numbered', '', m[0].slice(m[1].length));
  const genericItem = /(^|[\t \u3000])([0-9]{3})[\t \u3000]+(?!(?:[0-9]{2}[‐‑-][0-9]{2}|[0-9]))(?=[\p{L}（(])/gu;
  for (const m of line.matchAll(genericItem)) addStart(starts, line, m.index! + m[1].length, 'item', '', m[0].slice(m[1].length));
  const tableTitle = /(?:令和[６6]年度|概算要求定員表|歳出概算要求額(?:総表|明細表)|概算要求額(?:総表|明細表|定員表))/gu;
  for (const m of line.matchAll(tableTitle)) {
    const firstNonblank = line.search(/\S/u);
    if (firstNonblank >= 0 && !starts.some(s => s.at <= m.index! && s.kind !== 'table')) addStart(starts, line, firstNonblank, 'table', '', '');
  }
  const filtered = starts.filter(start => !(start.kind === 'item' && starts.some(markerStart => markerStart.kind === 'marker' && markerStart.at < start.at && start.at - markerStart.at < 24)));
  for (const start of filtered) start.side = start.at < boundary ? 'left' : 'right';
  return filtered.sort((a, b) => a.at - b.at);
}

function stripPageReference(segment: string): { label: string; page: string } {
  const leader = /[.・…･·。]{2,}/u.exec(segment);
  let body = segment;
  let page = '';
  if (leader) {
    const after = segment.slice(leader.index + leader[0].length);
    const m = /((?:[^\s　]+[\t \u3000]+)?[0-9]{1,4})[\t \u3000]*$/u.exec(after);
    if (m) {
      page = m[1].trim();
      body = segment.slice(0, leader.index);
    }
  } else {
    const m = /[\t \u3000]+([0-9]{1,4})[\t \u3000]*$/u.exec(segment);
    if (m) {
      page = m[1].trim();
      body = segment.slice(0, m.index);
    }
  }
  return { label: body.trim(), page };
}

function tocExclusionReason(line: string): string | undefined {
  const t = line.trim();
  if (!t) return 'blank line';
  if (/^(?:要求\s+区|番号|目\s*次|\d{1,4})$/u.test(t) || /^\d{1,4}[\t \u3000]*$/u.test(t)) return 'column header or isolated page marker';
  if (/令\s*和.*目\s*次/u.test(t)) return 'page title';
  const compactForHeaderCheck = t.replace(/[\t \u3000]/gu, '');
  if (/^[0-9]{2,4}.*(?:所管|特別会計)/u.test(compactForHeaderCheck) && !new RegExp(codePattern, 'u').test(t) && !/[\t \u3000][0-9]{1,4}$/u.test(t)) return 'page-level jurisdiction/account heading without a printed reference';
  return undefined;
}

export function tocPage(text: string, sourcePdf: string, page: number) {
  const pageTexts = text.split('\f');
  const records: MutableTocRecord[] = [];
  const audit: AuditFragment[] = [];
  const provenance: SourceTrace[] = [];
  for (const [pageOffset, pageText] of pageTexts.entries()) {
    const lines = pageText.split('\n').map(line => line.replace(/\r$/u, ''));
    const physicalPage = page + pageOffset;
    const boundary = findHeaderBoundary(lines);
    if (boundary === undefined) {
      for (const [rawLineIndex, rawLine] of lines.entries()) if (rawLine.trim()) audit.push({ sourcePdf, page: physicalPage, rawLineIndex, rawLine, rawText: rawLine, reason: 'column boundary unavailable from printed header; page held for review', scope: 'toc' });
      continue;
    }
    const latest: Record<'left' | 'right', MutableTocRecord | undefined> = { left: undefined, right: undefined };
    const emittedLines = new Set<number>();
    const appendContinuation = (side: 'left' | 'right', rawLineIndex: number, rawLine: string, fragment: string) => {
      const value = fragment.trim();
      if (!value) return;
      const current = latest[side];
      if (!current) {
        audit.push({ sourcePdf, page: physicalPage, rawLineIndex, rawLine, rawText: rawLine, reason: `unresolved ${side} text without a same-side preceding item`, scope: 'toc' });
      } else {
        current.区分 += value;
        current.sourceLines.push(rawLineIndex);
        emittedLines.add(rawLineIndex);
      }
    };
    for (const [rawLineIndex, rawLine] of lines.entries()) {
      const excludedReason = tocExclusionReason(rawLine);
      if (excludedReason || /^(?:要求|番号|区分|ページ)/u.test(rawLine.trim())) {
        audit.push({ sourcePdf, page: physicalPage, rawLineIndex, rawLine, rawText: rawLine, reason: `excluded: ${excludedReason ?? 'column header'}`, scope: 'toc' });
        continue;
      }
      const starts = findStarts(rawLine, boundary);
      if (!starts.length) {
        const leftPart = rawLine.slice(0, boundary);
        const rightPart = rawLine.slice(boundary);
        const nonblankLeft = leftPart.trim();
        const nonblankRight = rightPart.trim();
        if (nonblankLeft && nonblankRight) {
          audit.push({ sourcePdf, page: physicalPage, rawLineIndex, rawLine, rawText: rawLine, reason: 'unresolved text spans both header-derived column regions without a new-item anchor', scope: 'toc' });
          continue;
        }
        appendContinuation(nonblankLeft ? 'left' : 'right', rawLineIndex, rawLine, nonblankLeft || nonblankRight);
        continue;
      }
      const firstNonblank = rawLine.search(/\S/u);
      if (firstNonblank >= 0 && firstNonblank < starts[0].at) {
        const prefix = rawLine.slice(firstNonblank, starts[0].at);
        const side = firstNonblank < boundary ? 'left' : 'right';
        appendContinuation(side, rawLineIndex, rawLine, prefix);
      }
      for (const [i, start] of starts.entries()) {
        const nextAnySide = starts[i + 1];
        let rightTail = '';
        let end = nextAnySide?.at ?? rawLine.length;
        if (start.side === 'left' && !starts.some(candidate => candidate.side === 'right') && latest.right) {
          const tails = [...rawLine.matchAll(/\S[\t \u3000]+([0-9]{1,4})[\t \u3000]{3,}(\S.*)$/gu)];
          const tail = tails.at(-1);
          if (tail && tail.index! > start.at && tail.index! + tail[0].lastIndexOf(tail[2]) >= boundary) {
            rightTail = tail[2];
            end = tail.index! + tail[0].lastIndexOf(tail[2]);
          }
        }
        const rawSegment = rawLine.slice(start.at, end);
        if (start.side === 'left' && !nextAnySide && rawLine.slice(boundary).trim() && end > boundary && !stripPageReference(rawSegment).page) {
          audit.push({ sourcePdf, page: physicalPage, rawLineIndex, rawLine, rawText: rawLine, reason: 'left item text crosses header-derived column region without a separable right-side anchor', scope: 'toc' });
          latest.left = undefined;
          continue;
        }
        const content = rawSegment.replace(start.kind === 'request' ? /^\s*[0-9]{1,3}[\t \u3000]+[0-9]{2}[‐‑-][0-9]{2}[\t \u3000]+/u : start.kind === 'marker' ? /^\s*（(?:項|組織|所管|会計|勘定)）[\t \u3000]*(?:[0-9]{1,4}[\t \u3000]*)?/u : start.kind === 'numbered' ? /^\s*[0-9]{1,2}[.)．、][\t \u3000]*/u : start.kind === 'item' ? /^\s*[0-9]{3}[\t \u3000]+/u : /^$/u, '');
        const { label: rest, page: printedPage } = stripPageReference(content);
        const label = `${start.prefix}${rest}`.trim();
        const req = start.kind === 'request' ? /^(\d{1,3})/.exec(rawSegment) : null;
        const requestNumber = start.kind === 'request' ? start.requestNumber : '';
        if (!label || !printedPage) {
          audit.push({ sourcePdf, page: physicalPage, rawLineIndex, rawLine, rawText: rawLine, reason: !label ? 'item has no recoverable label' : 'item has no unambiguous printed page reference', scope: 'toc' });
          latest[start.side] = undefined;
          continue;
        }
        const record: MutableTocRecord = { 要求番号: requestNumber, 区分: label, ページ: printedPage, side: start.side, sourceLines: [rawLineIndex], physicalPage };
        records.push(record);
        latest[start.side] = record;
        emittedLines.add(rawLineIndex);
        if (rightTail) appendContinuation('right', rawLineIndex, rawLine, rightTail);
      }
    }
  }
  // Each page is emitted left column top-to-bottom, followed by right column top-to-bottom.
  records.sort((a, b) => a.physicalPage - b.physicalPage || (a.side === b.side ? 0 : a.side === 'left' ? -1 : 1) || a.sourceLines[0] - b.sourceLines[0]);
  const ordered = records.map((record, csvRecordIndex) => {
    for (const rawLineIndex of record.sourceLines) provenance.push({ sourcePdf, page: record.physicalPage, rawLineIndex, side: record.side, csvRecordIndex, scope: 'toc', role: rawLineIndex === record.sourceLines[0] ? 'item' : 'continuation', recordType: 'toc' });
    return { 要求番号: record.要求番号, 区分: record.区分, ページ: record.ページ };
  });
  return { records: ordered, audit, provenance };
}

export function renderTocCsv(records: CsvRecord[]) {
  return ['要求番号,区分,ページ', ...records.map(r => [r.要求番号, r.区分, r.ページ].map(csv).join(','))].join('\n') + '\n';
}

function getCoverEntry(rawLine: string): { label: string; page: string } | undefined {
  const trimmed = rawLine.trim();
  const hasOrdinal = /^[0-9]{1,2}[.)．、][\t \u3000]*/u.test(trimmed);
  const hasMarker = new RegExp(markerPattern, 'u').test(trimmed);
  const hasContentsTitle = /(?:歳出概算要求額(?:総表|明細表)|概算要求定員表|歳出概算要求定員表)/u.test(trimmed);
  if (!hasOrdinal && !hasMarker && !hasContentsTitle) return undefined;
  const { label: body, page } = stripPageReference(trimmed);
  if (!body || !page) return { label: body, page: '' };
  return { label: body, page };
}

function coverTitle(lines: string[]) {
  const yearPattern = /令\s*和\s*[６6]\s*年\s*度/u;
  for (const line of lines) {
    const match = yearPattern.exec(line);
    if (!match) continue;
    const after = line.slice(match.index + match[0].length);
    const end = after.lastIndexOf('書');
    if (end < 0) return { year: '', title: '', lineIndex: -1 };
    const title = after.slice(0, end + 1).trim();
    return { year: match[0], title, lineIndex: lines.indexOf(line) };
  }
  return { year: '', title: '', lineIndex: -1 };
}

export function coverTables(text: string, sourcePdf: string, physicalPage: number) {
  const lines = text.split('\n').map(line => line.replace(/\r$/u, ''));
  const audit: AuditFragment[] = [];
  const provenance: SourceTrace[] = [];
  const entries: CoverEntry[] = [];
  let headerCode = '', headerName = '', headerLine = -1;
  for (const [index, line] of lines.entries()) {
    const match = /^\s*([0-9]{2}|[0-9]{4})[\t \u3000]+(.+?)\s*$/u.exec(line);
    if (match) { headerCode = match[1]; headerName = match[2]; headerLine = index; break; }
  }
  const title = coverTitle(lines);
  const cover: CoverRecord = { source_pdf: sourcePdf, physical_page: physicalPage, header_code: headerCode, header_name: headerName, year_raw: title.year, document_title_raw: title.title };
  if (!headerCode || !headerName) audit.push({ sourcePdf, page: physicalPage, rawLineIndex: headerLine, rawLine: lines[headerLine] ?? '', rawText: lines[headerLine] ?? '', reason: 'Cover header code/name was not uniquely identified', scope: 'cover' });
  if (!title.year || !title.title) audit.push({ sourcePdf, page: physicalPage, rawLineIndex: title.lineIndex, rawLine: title.lineIndex >= 0 ? lines[title.lineIndex] : '', rawText: title.lineIndex >= 0 ? lines[title.lineIndex] : '', reason: 'Cover year/title boundary was not uniquely identified', scope: 'cover' });
  if (headerLine >= 0) provenance.push({ sourcePdf, page: physicalPage, rawLineIndex: headerLine, csvRecordIndex: 0, scope: 'cover', role: 'header-fields', recordType: 'cover' });
  if (title.lineIndex >= 0) provenance.push({ sourcePdf, page: physicalPage, rawLineIndex: title.lineIndex, csvRecordIndex: 0, scope: 'cover', role: 'year-title-fields', recordType: 'cover' });
  const represented = new Set([headerLine, title.lineIndex]);
  for (const [rawLineIndex, rawLine] of lines.entries()) {
    const entry = getCoverEntry(rawLine);
    if (!entry) continue;
    represented.add(rawLineIndex);
    if (!entry.page) {
      audit.push({ sourcePdf, page: physicalPage, rawLineIndex, rawLine, rawText: rawLine, reason: 'Cover entry candidate has no recoverable printed page reference', scope: 'cover' });
      continue;
    }
    const fullLabel = entry.label;
    entries.push({ source_pdf: sourcePdf, physical_page: physicalPage, entry_order: entries.length + 1, 区分: fullLabel, ページ: entry.page });
    provenance.push({ sourcePdf, page: physicalPage, rawLineIndex, csvRecordIndex: entries.length - 1, scope: 'cover', role: 'entry', recordType: 'cover_entry' });
    const next = lines[rawLineIndex + 1] ?? '';
    if (next.trim() && !getCoverEntry(next) && !/書\s*$/u.test(next.trim()) && !/^令\s*和/u.test(next.trim())) {
      const nextIndex = rawLineIndex + 1;
      const leading = next.search(/\S/u);
      if (leading >= 0 && leading >= Math.max(0, rawLine.search(/\S/u)) && next.trim().length < 80) {
        entries[entries.length - 1].区分 += next.trim();
        represented.add(nextIndex);
        provenance.push({ sourcePdf, page: physicalPage, rawLineIndex: nextIndex, csvRecordIndex: entries.length - 1, scope: 'cover', role: 'continuation-candidate', recordType: 'cover_entry' });
      }
    }
  }
  for (const [rawLineIndex, rawLine] of lines.entries()) {
    if (rawLine.trim() && !represented.has(rawLineIndex)) audit.push({ sourcePdf, page: physicalPage, rawLineIndex, rawLine, rawText: rawLine, reason: 'unclassified Cover line retained for review', scope: 'cover' });
  }
  return { cover, entries, audit, provenance };
}

export function renderCoverCsv(records: CoverRecord[]) {
  return ['source_pdf,physical_page,header_code,header_name,year_raw,document_title_raw', ...records.map(r => [r.source_pdf, String(r.physical_page), r.header_code, r.header_name, r.year_raw, r.document_title_raw].map(csv).join(','))].join('\n') + '\n';
}
export function renderCoverEntriesCsv(records: CoverEntry[]) {
  return ['source_pdf,physical_page,entry_order,区分,ページ', ...records.map(r => [r.source_pdf, String(r.physical_page), String(r.entry_order), r.区分, r.ページ].map(csv).join(','))].join('\n') + '\n';
}

// Compatibility export for the original one-Cover API; callers should use coverTables.
export function coverPage(text: string, sourcePdf = 'cover', page = 1) {
  const result = coverTables(text, sourcePdf, page);
  return { csv: renderCoverCsv([result.cover]), audit: result.audit };
}
