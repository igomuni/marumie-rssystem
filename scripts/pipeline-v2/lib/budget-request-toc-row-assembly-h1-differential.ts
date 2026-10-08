/**
 * H1（#398 preregistration）の development 検証用: trigger の機械判定（H1 実装とは独立に #398 の文言から実装）と、#393 baseline との差分 oracle。
 * 許可差: A) exact trigger 行（whole-line TITLE → LEFT TITLE + RIGHT unit。column の sourceOrder 再採番を伴う）、B) declared downstream effect（H1 RIGHT unit が owner 候補になり、
 * baseline では FRAGMENT_NO_SAFE_OWNER だった同じ fragment 行が attach される）。それ以外の差は全て undeclared（falsification）。
 */
import { nonEmptyLinesOf, sha256Hex } from './budget-request-raw-text';
import { BAND_TOLERANCE_CHARS, MARKER_TOKEN_SOURCE, OTHER_CODE_SOURCE, PAGEREF_SOURCE, REQUEST_TOKEN_SOURCE, type PageOut, type RowOut, type TocPageInput } from './budget-request-toc-row-assembly';

const cps = (s: string) => Array.from(s);
const isWs = (c: string | undefined) => c === undefined || /\s/u.test(c);
const cpIndex = (s: string, utf16: number) => Array.from(s.slice(0, utf16)).length;
const STARTS_REQUEST = new RegExp(`^(${REQUEST_TOKEN_SOURCE})`, 'u');
const STARTS_MARKER = new RegExp(`^(${MARKER_TOKEN_SOURCE})`, 'u');
const OTHER_CODE = new RegExp(OTHER_CODE_SOURCE.replace('PAGEREF', PAGEREF_SOURCE), 'u');
const ANY_REQUEST = new RegExp(REQUEST_TOKEN_SOURCE, 'gu');
const startsRowToken = (seg: string) => { const t = seg.replace(/^\s+/u, ''); return STARTS_REQUEST.test(t) || STARTS_MARKER.test(t) || OTHER_CODE.test(seg); };

export interface TriggerCensus { triggerLines: number[]; negativeControlLines: number[]; tokenTypes: { REQUEST: number; MARKER: number; OTHER_CODE: number } }

/** #398 の trigger（T1〜T5）を baseline の状態（page state・E・header zone）と raw line から機械的に判定する */
export function triggerCensus(page: TocPageInput, baseline: PageOut): TriggerCensus {
  const out: TriggerCensus = { triggerLines: [], negativeControlLines: [], tokenTypes: { REQUEST: 0, MARKER: 0, OTHER_CODE: 0 } };
  if (baseline.pageState !== 'ASSEMBLED_SPLIT' || baseline.rightBandEdge === null) return out; // T1
  const E = baseline.rightBandEdge;
  const headerLines = new Set(baseline.rows.filter(r => r.rowKind === 'TITLE_OR_HEADING' && r.column === 'UNSPLIT').map(r => r.provenance.lineIndex)); // T2（frozen の header zone 出力）
  for (const l of page.nonEmptyLines) {
    if (!headerLines.has(l.lineIndex)) continue;
    const chars = cps(l.text);
    const right = chars.slice(E).join('');
    if (!right.trim()) continue;
    const first = chars.findIndex(c => !isWs(c));
    const toks = [...l.text.matchAll(ANY_REQUEST)].map(m => cpIndex(l.text, m.index as number)).filter(ix => ix > first);
    const conflict = toks.some(ix => (ix >= E - BAND_TOLERANCE_CHARS && ix <= E - 1) || ix >= E + BAND_TOLERANCE_CHARS + 1);
    const crossing = chars.length > E && !isWs(chars[E - 1]) && !isWs(chars[E]);
    if (startsRowToken(right)) {
      if (conflict || crossing) continue; // T4 を満たさない（non-trigger NT5）
      out.triggerLines.push(l.lineIndex);
      const t = right.replace(/^\s+/u, '');
      if (STARTS_REQUEST.test(t)) out.tokenTypes.REQUEST++; else if (STARTS_MARKER.test(t)) out.tokenTypes.MARKER++; else out.tokenTypes.OTHER_CODE++;
    } else out.negativeControlLines.push(l.lineIndex); // NT3: E 以右に text があり row-start token で始まらない
  }
  return out;
}

const strip = (u: RowOut) => { const { sourceOrder: _s, ...rest } = u; return JSON.stringify(rest); };

export interface DiffReport {
  pageStateChanges: number; undeclared: string[];
  triggerLineChanges: number; triggerMismatches: string[]; falseSplits: string[];
  declaredDownstreamFragments: number; provenanceMismatches: number;
  leftTitleCount: number; rightKinds: Record<string, number>; abstentionDelta: Record<string, number>;
}

export function diffPages(page: TocPageInput, baseline: PageOut, h1: PageOut, census: TriggerCensus): DiffReport {
  const rep: DiffReport = { pageStateChanges: 0, undeclared: [], triggerLineChanges: 0, triggerMismatches: [], falseSplits: [], declaredDownstreamFragments: 0, provenanceMismatches: 0, leftTitleCount: 0, rightKinds: {}, abstentionDelta: {} };
  if (baseline.pageState !== h1.pageState || baseline.pageAbstentionReason !== h1.pageAbstentionReason || baseline.rightBandEdge !== h1.rightBandEdge) { rep.pageStateChanges++; rep.undeclared.push('PAGE_STATE_OR_BAND_CHANGED'); }
  const trig = new Set(census.triggerLines);
  const lineText = new Map(nonEmptyLinesOf(page.text).map(l => [l.lineIndex, l.text]));
  const E = baseline.rightBandEdge;

  // 1. trigger 行: baseline は UNSPLIT の whole-line TITLE 1 件、H1 は LEFT TITLE + RIGHT unit
  const h1Right: RowOut[] = [];
  for (const L of trig) {
    const b = baseline.rows.filter(r => r.provenance.lineIndex === L);
    const h = h1.rows.filter(r => r.provenance.lineIndex === L);
    const left = h.filter(r => r.column === 'LEFT'); const right = h.filter(r => r.column === 'RIGHT');
    const rightExpected = E === null ? '' : cps(lineText.get(L) ?? '').slice(E).join('').trim();
    const ok = b.length === 1 && b[0].column === 'UNSPLIT' && b[0].rowKind === 'TITLE_OR_HEADING' && h.length === 2 && left.length === 1 && right.length === 1 && left[0].rowKind === 'TITLE_OR_HEADING' && left[0].state === 'RESOLVED'
      && ['REQUEST_NUMBER_ROW', 'MARKER_ROW', 'OTHER_CODE'].includes(right[0].rowKind) && right[0].state === 'RESOLVED' && E !== null && left[0].provenance.charEnd <= E && right[0].provenance.charStart >= E
      && right[0].provenance.sourceRawSlice === rightExpected;
    if (!ok) rep.triggerMismatches.push(`line${L}`); else { rep.triggerLineChanges++; rep.leftTitleCount++; h1Right.push(right[0]); rep.rightKinds[right[0].rowKind] = (rep.rightKinds[right[0].rowKind] ?? 0) + 1; }
  }
  // 2. 非 trigger の header zone 行が分割されていれば false split
  for (const b of baseline.rows.filter(r => r.rowKind === 'TITLE_OR_HEADING' && r.column === 'UNSPLIT' && !trig.has(r.provenance.lineIndex))) {
    const h = h1.rows.filter(r => r.provenance.lineIndex === b.provenance.lineIndex);
    if (!(h.length === 1 && strip(h[0]) === strip(b))) rep.falseSplits.push(`line${b.provenance.lineIndex}`);
  }
  // 3. declared downstream: baseline の FRAGMENT_NO_SAFE_OWNER が、H1 では trigger の RIGHT unit に attach された同一 fragment
  const attached = h1Right.flatMap(r => r.fragments.map(f => ({ lineIndex: f.provenance.lineIndex, slice: f.provenance.sourceRawSlice })));
  const declared = baseline.rows.filter(r => r.state === 'ABSTAINED' && r.abstentionReason === 'FRAGMENT_NO_SAFE_OWNER' && r.column === 'RIGHT' && attached.some(a => a.lineIndex === r.provenance.lineIndex && a.slice === r.provenance.sourceRawSlice));
  rep.declaredDownstreamFragments = declared.length;
  if (attached.length !== declared.length) rep.undeclared.push(`H1_RIGHT_FRAGMENTS_NOT_DECLARED(${attached.length} attached / ${declared.length} declared)`);
  // 4. 残りは sourceOrder の再採番を除いて完全一致（内容・分類・provenance・相対順序）
  const declaredKeys = new Set(declared.map(r => `${r.column}@${r.provenance.lineIndex}`));
  const bRest = baseline.rows.filter(r => !trig.has(r.provenance.lineIndex) && !declaredKeys.has(`${r.column}@${r.provenance.lineIndex}`));
  const hRest = h1.rows.filter(r => !trig.has(r.provenance.lineIndex));
  if (bRest.length !== hRest.length || bRest.some((r, i) => strip(r) !== strip(hRest[i]))) rep.undeclared.push(`UNRELATED_UNIT_DIFFERENCE(baseline ${bRest.length} / h1 ${hRest.length})`);
  // 5. abstention delta
  const count = (rows: RowOut[]) => rows.reduce((a: Record<string, number>, r) => ((a[r.abstentionReason ?? 'NONE'] = (a[r.abstentionReason ?? 'NONE'] ?? 0) + (r.abstentionReason ? 1 : 0)), a), {});
  const cb = count(baseline.rows); const ch = count(h1.rows);
  for (const k of new Set([...Object.keys(cb), ...Object.keys(ch)])) if (k !== 'NONE' && (ch[k] ?? 0) !== (cb[k] ?? 0)) rep.abstentionDelta[k] = (ch[k] ?? 0) - (cb[k] ?? 0);
  // 6. provenance（H1 出力全 unit / fragment を raw line と照合）
  const prov = (p: { pdfSha256: string; textSha256: string; physicalPage: number; localPdfPath: string; lineIndex: number; charStart: number; charEnd: number; sourceRawSlice: string }) => {
    const t = lineText.get(p.lineIndex);
    if (!(p.pdfSha256 === page.pdfSha256 && p.textSha256 === page.textSha256 && sha256Hex(page.text) === page.textSha256 && p.physicalPage === page.physicalPage && p.localPdfPath === page.localPdfPath && t !== undefined && cps(t).slice(p.charStart, p.charEnd).join('') === p.sourceRawSlice)) rep.provenanceMismatches++;
  };
  for (const r of h1.rows) { if (r.state === 'RESOLVED' || r.provenance.sourceRawSlice !== undefined) { if (r.provenance.localPdfPath) prov(r.provenance); } for (const f of r.fragments) prov(f.provenance); }
  return rep;
}
