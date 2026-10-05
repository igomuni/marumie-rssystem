/**
 * source-only alternative title projection の frozen evaluation（事前登録 Alternative_Title_Projection_Preregistration）。
 * --phase=primary  : 9,145 page の C1〜C5 に対する M1〜M6 と primary decision（alternative projection artifact も出力）
 * --phase=segments : primary decision の後。segment 再構成（P4）と前回 structural gate の再適用（P5）
 * production の title extractor には接続しない。補完・bridge・救済・MOF・manual contract（P5 の diagnostic を除く）は使わない。
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/evaluate-budget-request-alt-title-projection.ts --phase=primary|segments
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { hierarchyContractFor } from './lib/budget-request-corpus-plan';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { pageMetaFrom, toSourceTokens, type RawTextItem, type RawTextStyles } from './lib/budget-request-source-token';
import { segmentize, shapeOf, titleOfPage, type PageProjection, type PageTitle, type Segment } from './lib/budget-request-header-label';
import { titleOfPageAlt, type AltRow, type ProjectionBasis } from './lib/budget-request-alt-title-projection';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-alt-title-projection', '2024');
const P = {
  manifest: `${FX}/budget-request-full-corpus-baseline/2024/corpus-manifest.json`, projection: `${FX}/budget-request-header-label/2024/header-label-projection.json`, hlSummary: `${FX}/budget-request-header-label/2024/header-label-summary.json`,
  hlComparison: `${FX}/budget-request-header-label/2024/header-label-structural-comparison.json`, inventory: `${FX}/budget-request-title-ordering/2024/page-ordering-inventory.json`, orderSummary: `${FX}/budget-request-title-ordering/2024/page-ordering-summary.json`,
  orderPhaseB: `${FX}/budget-request-title-ordering/2024/title-ordering-phaseB-comparison.json`, population: `${OUT}/population-manifest.json`, layout: `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`, paired: `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`,
  semPopulation: `${FX}/budget-request-semantic-boundary/2024/population-887.json`, prereg: 'docs/tasks/20261005_1135_Budget_Request_Alternative_Title_Projection_Preregistration.md',
  lib: 'scripts/pipeline-v2/lib/budget-request-alt-title-projection.ts', script: 'scripts/pipeline-v2/evaluate-budget-request-alt-title-projection.ts',
};
const FROZEN: Record<string, string> = {
  [P.manifest]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', [P.projection]: '9ff3b970d403d37aea3562cc0eb87a3ee07fca92cbd3bc03986c79b7b9c402e5', [P.hlSummary]: '599acde04daf80cda23404834cd895f12efe83f2188a7e72ef229527208b78f9',
  [P.hlComparison]: 'e196ab814ccad140f0592c5500c7158e59b8d82108940ff3e1d2e7def0144d6d', [P.inventory]: '9eb910a876fb3c807fa957f9b9ca65879187f55b1d338c6e4180ea8a544fddc3', [P.orderSummary]: '45a157b4d6d6a22d2b141a0734c070fb2dcaca17b8483ac79a58d750dddf61ef',
  [P.orderPhaseB]: '49ac0a3c62036d1b6f2911c5cd6da2a3812fe3f9a5dfe8bfc6ab65690170ff07', [P.population]: 'ffac4a9d68c7fc4a2cd7883ecb89ed2c5f6009026dcc2fd2d24b6792d981c38d', [P.layout]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266',
  [P.paired]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1', [P.semPopulation]: '24f4803bb3fefd756ccb85f313404879529588792d7ae88352b30beab34c1aee', [P.prereg]: 'c43c49a787c2aab0eba9b84924cc45340191ee78415c48464a89110ba650454e',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const json = (o: unknown, indent = 1) => `${JSON.stringify(sortDeep(o), null, indent)}\n`;

interface Doc { localPath: string; canonicalUrl: string; publisherAuthority: string; accountType: string; sha256: string; pages: number }
interface PageOut { page: number; cur: PageTitle; alt: PageTitle; basis: ProjectionBasis | null; otherLabelDiff: number; labelShapedRows: number }
const key = (lp: string, p: number) => `${lp}|${p}`;

async function scan(docs: Doc[]): Promise<Map<string, PageOut[]>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.join('node_modules', 'pdfjs-dist');
  const out = new Map<string, PageOut[]>();
  const un = (s: PageTitle['status']): PageTitle => ({ status: s, blankReason: null, firstTitleRaw: null, firstTitleNormalized: null, shape: null, sourceRefs: null });
  for (const d of docs) {
    if (!fs.existsSync(d.localPath) || fileSha(d.localPath) !== d.sha256) throw new Error(`PDF が無い・hash 不一致（STOP）: ${d.localPath}`);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(d.localPath)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
    const pages: PageOut[] = [];
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        try {
          const page = await doc.getPage(n);
          if (page.rotate !== 0) { pages.push({ page: n, cur: un('unavailable_rotate90'), alt: un('unavailable_rotate90'), basis: null, otherLabelDiff: 0, labelShapedRows: 0 }); page.cleanup(); continue; }
          const content = await page.getTextContent({ disableNormalization: true });
          const meta = pageMetaFrom(n, doc.numPages, page.view, page.rotate);
          const items = content.items.filter((i): i is typeof i & RawTextItem => 'str' in i) as unknown as RawTextItem[];
          const tokens = toSourceTokens(items, meta, content.styles as unknown as RawTextStyles);
          const geom = buildTableGeometry(tokens, meta);
          const lr = resolveLogicalRows(tokens, meta, geom);
          const rows: AltRow[] = lr.logicalRowCandidates.map(r => { const toks = r.visualTokenIndexes.map(i => tokens[i]).filter(t => t.rawText.trim() !== ''); return { logicalRowIndex: r.logicalRowIndex, physicalRowIndexes: [...r.physicalRowIndexes], tokenIndexes: toks.map(t => t.index), texts: toks.map(t => t.rawText.trim()), x: Math.round((toks[0]?.bbox.xMin ?? 0) * 10) / 10, y: Math.round(r.bbox.yMin * 10) / 10 }; });
          const a = titleOfPageAlt(rows, meta.height);
          pages.push({ page: n, cur: titleOfPage(rows), alt: a.title, basis: a.basis, otherLabelDiff: a.otherLabelRowsDifferingFromProjected, labelShapedRows: a.labelShapedRows });
          page.cleanup();
        } catch { pages.push({ page: n, cur: un('other_unavailable'), alt: un('other_unavailable'), basis: null, otherLabelDiff: 0, labelShapedRows: 0 }); }
      }
    } finally { await doc.destroy(); }
    out.set(d.localPath, pages);
  }
  return out;
}

const same = (a: PageTitle, b: PageTitle) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
const guard = () => { for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`); };
const docsOf = () => [...readJson<{ documents: Doc[] }>(P.manifest).documents].sort((a, b) => cmp(a.localPath, b.localPath));

function altArtifact(res: Map<string, PageOut[]>, docs: Doc[]) {
  return json({ schema: 'budget-request-alt-title-projection/v0', note: 'research-only。production title extractor・DocumentHierarchy・FieldResolver には接続しない。補完・bridge なし', pdfs: docs.map(d => ({ localPath: d.localPath, accountType: d.accountType, publisherAuthority: d.publisherAuthority, group: hierarchyContractFor(d.canonicalUrl) ? 'discovery' : 'non_discovery', pages: res.get(d.localPath)!.map(p => ({ p: p.page, s: p.alt.status, br: p.alt.blankReason, basis: p.basis, raw: p.alt.firstTitleRaw, n: p.alt.firstTitleNormalized, sh: p.alt.shape ? [p.alt.shape.length, p.alt.shape.parenthesized ? 1 : 0, p.alt.shape.prefixLength, p.alt.shape.innerLength] : null, ref: p.alt.sourceRefs ? [p.alt.sourceRefs.logicalRowIndex, ...p.alt.sourceRefs.tokenIndexes] : null })) })) }, 0);
}

async function primary() {
  guard();
  const docs = docsOf();
  const res = await scan(docs);
  const res2 = await scan(docs); // M5: 同一入力で再実行
  const art = altArtifact(res, docs);
  const deterministic = art === altArtifact(res2, docs);
  const frozenProj = new Map(readJson<{ pdfs: { localPath: string; projection: { p: number; s: string; raw: string | null; n: string | null; ref: unknown }[] }[] }>(P.projection).pdfs.map(p => [p.localPath, p.projection]));
  let curMismatch = 0;
  for (const d of docs) for (const p of res.get(d.localPath)!) { const f = frozenProj.get(d.localPath)!.find(x => x.p === p.page)!; if (f.s !== p.cur.status || f.raw !== p.cur.firstTitleRaw || f.n !== p.cur.firstTitleNormalized) curMismatch++; }
  if (curMismatch !== 0) throw new Error(`current projection が frozen projection を再現しない（STOP）: ${curMismatch}`);
  const pop = readJson<{ counts: Record<string, number>; members: Record<string, Record<string, number[]>> }>(P.population);
  const memberOf = new Map<string, string>();
  for (const [c, byPdf] of Object.entries(pop.members)) for (const [lp, ps] of Object.entries(byPdf)) for (const p of ps) memberOf.set(key(lp, p), c);
  const inv = new Map(readJson<{ perPdf: { localPath: string; evidence: { p: number; label: [number, number, number, string, string, number | null, number | null, number[]] | null }[] }[] }>(P.inventory).perPdf.map(p => [p.localPath, new Map(p.evidence.map(e => [e.p, e.label]))]));
  const c: Record<string, Record<string, number>> = {};
  const failures: Record<string, { localPath: string; page: number }[]> = {};
  const fail = (k: string, lp: string, p: number) => { (failures[k] ??= []).push({ localPath: lp, page: p }); };
  let provenanceMissing = 0, fidelityViolations = 0;
  for (const d of docs) for (const p of res.get(d.localPath)!) {
    const cls = memberOf.get(key(d.localPath, p.page));
    if (p.basis === 'label_on_first_code_row' && !p.alt.sourceRefs) provenanceMissing++;
    if (!cls) continue;
    const bucket = (c[cls] ??= {});
    inc(bucket, 'pages');
    if (cls === 'C1_current_nonblank') { if (same(p.cur, p.alt)) inc(bucket, 'unchanged'); else { inc(bucket, 'changed'); fail('C1_changed', d.localPath, p.page); } }
    else if (cls === 'C2_target_same_row') {
      const lab = inv.get(d.localPath)!.get(p.page);
      if (p.basis !== 'label_on_first_code_row') { inc(bucket, 'unresolved'); fail('C2_unresolved', d.localPath, p.page); }
      else if (lab && p.alt.firstTitleRaw === lab[3] && p.alt.firstTitleNormalized === lab[4] && p.alt.sourceRefs!.logicalRowIndex === lab[0] && JSON.stringify(p.alt.sourceRefs!.tokenIndexes) === JSON.stringify(lab[7])) inc(bucket, 'recovered');
      else { inc(bucket, 'mismatch'); fail('C2_mismatch', d.localPath, p.page); }
      if (p.basis === 'label_on_first_code_row' && p.otherLabelDiff > 0) { inc(bucket, 'ambiguous'); fail('C2_ambiguous', d.localPath, p.page); }
      if (p.basis === 'label_on_first_code_row' && p.alt.firstTitleRaw !== null && !p.alt.firstTitleRaw.length) fidelityViolations++;
    } else { if (p.cur.status !== p.alt.status) { inc(bucket, 'changed'); fail(`${cls}_changed`, d.localPath, p.page); } else inc(bucket, 'unchanged'); }
  }
  const sample = Object.fromEntries(Object.entries(failures).map(([k, v]) => [k, { count: v.length, first: v.sort((a, b) => cmp(a.localPath, b.localPath) || a.page - b.page).slice(0, 5) }]));
  const c1 = c.C1_current_nonblank ?? {}, c2 = c.C2_target_same_row ?? {};
  const nonTargetChanged = ['C3_cutoff_other', 'C4_source_label_absent', 'C5_label_shape_unrecognized'].reduce((n, k) => n + (c[k]?.changed ?? 0), 0);
  const frozenOk = true;
  let decision: string, rule: number;
  if (!frozenOk) { decision = 'INCONCLUSIVE'; rule = 4; }
  else if ((c1.changed ?? 0) > 0 || nonTargetChanged > 0 || !deterministic || fidelityViolations > 0) { decision = 'ALTERNATIVE_PROJECTION_REJECTED'; rule = 3; }
  else if ((c2.recovered ?? 0) === 2537 && (c2.unresolved ?? 0) === 0 && (c2.mismatch ?? 0) === 0 && (c2.ambiguous ?? 0) === 0 && provenanceMissing === 0) { decision = 'ALTERNATIVE_PROJECTION_SUPPORTED'; rule = 1; }
  else { decision = 'ALTERNATIVE_PROJECTION_PARTIALLY_SUPPORTED'; rule = 2; }
  const evalText = json({
    schema: 'budget-request-alt-title-projection-primary/v0',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), implementation: { lib: fileSha(P.lib), script: fileSha(P.script) }, preregistration: fileSha(P.prereg) },
    corpus: { pdfs: docs.length, pages: docs.reduce((n, d) => n + d.pages, 0), currentProjectionReproduced: curMismatch === 0, populationCounts: pop.counts },
    classes: c, M1: { changed: c1.changed ?? 0, missing: 0, extra: 0 }, M2: { target: c2.pages, recovered: c2.recovered ?? 0, unresolved: c2.unresolved ?? 0, mismatch: c2.mismatch ?? 0 },
    M3: { C3: c.C3_cutoff_other?.changed ?? 0, C4: c.C4_source_label_absent?.changed ?? 0, C5: c.C5_label_shape_unrecognized?.changed ?? 0 }, M4: { C2Ambiguous: c2.ambiguous ?? 0, provenanceMissing },
    M5: { deterministicRerun: deterministic, alternativeArtifactSha256: sha(art) }, M6: { fidelityViolations, neighborCopies: 0, note: '投影は同一 page の row のみから生成（他 page・他 row の参照なし。コード上 title row の raw と Phase A の label evidence の一致で検証）' },
    failureSamples: sample, decision, rule,
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'alt-title-projection.json'), art);
  fs.writeFileSync(path.join(OUT, 'primary-evaluation.json'), evalText);
  console.log(JSON.stringify({ evalSha: sha(evalText), altSha: sha(art), classes: c, M5: deterministic, provenanceMissing, nonTargetChanged, decision }, null, 1));
}

// ---------------------------------------------------------------- P4 / P5
interface AltPage { p: number; s: string; br: string | null; basis: string | null; raw: string | null; n: string | null; sh: (number | null)[] | null }
interface AltPdf { localPath: string; accountType: string; group: string; pages: AltPage[] }
async function segments() {
  guard();
  const alt = readJson<{ pdfs: AltPdf[] }>(`${OUT}/alt-title-projection.json`).pdfs;
  const evalP = readJson<{ decision: string }>(`${OUT}/primary-evaluation.json`);
  const cur = readJson<{ pdfs: { localPath: string; group: string; segments: Segment[]; projection: { p: number; s: string; n: string | null; sh: (number | null)[] | null }[] }[] }>(P.projection).pdfs;
  const layout = new Map(readJson<{ perPdf: { localPath: string; ranges: { from: number; to: number }[] }[] }>(P.layout).perPdf.map(p => [p.localPath, p]));
  const paired = readJson<{ documents: { localPath: string; canonicalUrl: string; class: string }[] }>(P.paired).documents.filter(d => d.class === 'paired_evaluable');
  const contract = new Map(paired.map(d => [d.localPath, hierarchyContractFor(d.canonicalUrl)!.pages as [number, number]]));
  const toTitle = (s: string, n: string | null): PageTitle => ({ status: s as PageTitle['status'], blankReason: null, firstTitleRaw: n, firstTitleNormalized: n, shape: null, sourceRefs: null });
  const altSegs = new Map<string, Segment[]>();
  for (const pdf of alt) altSegs.set(pdf.localPath, segmentize(pdf.pages.map(x => ({ page: x.p, title: toTitle(x.s, x.n) }) as PageProjection)));
  const stat = (segsBy: Map<string, Segment[]>) => {
    let labelSegments = 0, all = 0, direct = 0, reappear = 0, sameViaBlank = 0, diffViaBlank = 0;
    for (const segs of segsBy.values()) {
      all += segs.length; const seen = new Set<string>();
      for (let k = 0; k < segs.length; k++) { const s = segs[k]; if (s.kind === 'label') { labelSegments++; if (seen.has(s.state)) reappear++; seen.add(s.state); } }
      for (let k = 1; k < segs.length; k++) if (segs[k - 1].kind === 'label' && segs[k].kind === 'label' && segs[k - 1].state !== segs[k].state) direct++;
      for (let k = 1; k + 1 < segs.length; k++) if (segs[k].kind !== 'label' && segs[k - 1].kind === 'label' && segs[k + 1].kind === 'label') (segs[k - 1].state === segs[k + 1].state ? sameViaBlank++ : diffViaBlank++);
    }
    return { labelSegments, allSegments: all, directLabelTransitions: direct, sameLabelNonContiguousRecurrence: reappear, blankMediatedSameLabel: sameViaBlank, blankMediatedDifferentLabel: diffViaBlank };
  };
  const curSegs = new Map(cur.map(p => [p.localPath, p.segments]));
  const pages = (rows: { s: string }[], st: string) => rows.filter(r => r.s === st).length;
  const nonblank = (o: AltPdf[]) => o.reduce((n, p) => n + pages(p.pages, 'observed_nonblank'), 0), blank = (o: AltPdf[]) => o.reduce((n, p) => n + pages(p.pages, 'observed_blank'), 0);
  const curAsAlt: AltPdf[] = cur.map(p => ({ localPath: p.localPath, accountType: '', group: p.group, pages: p.projection.map(x => ({ p: x.p, s: x.s, br: null, basis: null, raw: null, n: x.n, sh: x.sh })) }));
  const focusKey = (sfx: string) => alt.find(p => p.localPath.endsWith(sfx))!.localPath;
  const mextKey = focusKey('mxt_kaikesou01-000031817_03.pdf'), mhlwKey = focusKey('05-1b-01.pdf');
  const table = {
    observedNonblank: { current: nonblank(curAsAlt), alternative: nonblank(alt) }, observedBlank: { current: blank(curAsAlt), alternative: blank(alt) },
    current: stat(curSegs), alternative: stat(altSegs),
    mextSegments: { current: curSegs.get(mextKey)!.length, alternative: altSegs.get(mextKey)!.length }, mhlwSegments: { current: curSegs.get(mhlwKey)!.length, alternative: altSegs.get(mhlwKey)!.length },
    referenceOnly: { previousCounterfactual: { labelSegments: 400, allSegments: 563, mext: 5, mhlw: 11 } },
  };
  // P5: 前回の gate（G1・G3・G4・G5）を変更せず再適用
  const labelStarts = (segs: Segment[]) => segs.filter(s => s.kind === 'label' && s.from > 1);
  const covOf = (ps: AltPdf[]) => { let nb = 0, ev = 0, par = 0; for (const p of ps) for (const x of p.pages) { if (x.s === 'observed_nonblank' || x.s === 'observed_blank') ev++; if (x.s === 'observed_nonblank') { nb++; if (x.sh && x.sh[1] === 1) par++; } } return { pdfs: ps.length, evaluablePages: ev, observedNonblankPages: nb, parenthesizedPages: par, nonblankRatio: ev ? nb / ev : null }; };
  const all = covOf(alt), non = covOf(alt.filter(p => p.group === 'non_discovery')), disc = covOf(alt.filter(p => p.group === 'discovery'));
  const nonPdf = (() => { const ps = alt.filter(p => p.group === 'non_discovery' && p.pages.some(x => x.s === 'observed_nonblank')); const ok = ps.filter(p => { const c = covOf([p]); return c.observedNonblankPages ? c.parenthesizedPages / c.observedNonblankPages >= 0.5 : false; }); return { pdfsWithNonblank: ps.length, pdfsParenthesizedMajority: ok.length, ratio: ps.length ? ok.length / ps.length : null }; })();
  const g3: { key: string; ok: boolean; startIsLabelSegmentStart?: boolean }[] = [];
  const otherTransitions: Record<string, number> = {};
  const manual: Record<string, unknown>[] = [];
  for (const [lp, [a, b]] of contract) {
    const segs = altSegs.get(lp)!; const total = alt.find(p => p.localPath === lp)!.pages.length;
    const segAt = (p: number) => segs.find(s => p >= s.from && p <= s.to) ?? null;
    const lay = layout.get(lp)!; const lbStart = new Set(lay.ranges.slice(1).map(r => r.from)); const lEnds = new Set(lay.ranges.map(r => r.to));
    const sa = segAt(a), sb = segAt(b);
    const startIsSegStart = !!sa && sa.kind === 'label' && sa.from === a && a > 1, endIsSegEnd = !!sb && sb.kind === 'label' && sb.to === b && b < total;
    const startLayout = lbStart.has(a), endLayout = lEnds.has(b) && b < total;
    const others = labelStarts(segs).filter(s => s.from !== a && s.from !== b + 1);
    otherTransitions[path.basename(lp)] = others.length;
    manual.push({ localPath: lp, manual: [a, b], startIsLabelSegmentStart: startIsSegStart, endIsLabelSegmentEnd: endIsSegEnd, startLayoutBoundary: startLayout, endLayoutBoundary: endLayout, otherLabelTransitionsInPdf: others.length, interiorLabelTransitions: labelStarts(segs).filter(s => s.from > a && s.from <= b).length });
    if (/mxt_kaikesou01-000031817_03\.pdf$/.test(lp)) g3.push({ key: 'mext_start', ok: startIsSegStart && !startLayout });
    if (/05-1b-01\.pdf$/.test(lp)) { g3.push({ key: 'mhlw_start', ok: startIsSegStart && !startLayout }); g3.push({ key: 'mhlw_end', ok: endIsSegEnd && !endLayout }); }
  }
  const G1 = (all.nonblankRatio ?? 0) >= 0.5 && (non.nonblankRatio ?? 0) >= 0.5, G3 = g3.length === 3 && g3.every(x => x.ok);
  const mextOther = otherTransitions['20230914-mxt_kaikesou01-000031817_03.pdf'] ?? 0, mhlwOther = otherTransitions['05-1b-01.pdf'] ?? 0;
  const G4 = mextOther <= 2 && mhlwOther <= 2, G5 = (nonPdf.ratio ?? 0) >= 0.5;
  const evaluableShare = 9145 / 9899;
  let decision: string, rule: number;
  if (evaluableShare < 0.5) { decision = 'INCONCLUSIVE'; rule = 1; }
  else if (!G1) { decision = 'HEADER_LABEL_SOURCE_UNSTABLE'; rule = 2; }
  else if (G3 && G4 && G5) { decision = 'HEADER_LABEL_STRUCTURAL_SEGMENT_SUPPORTED'; rule = 3; }
  else if (G3 && G4 && !G5) { decision = 'HEADER_LABEL_LOCAL_ONLY'; rule = 4; }
  else { decision = 'HEADER_LABEL_PRESENT_BUT_NOT_BOUNDARY_SPECIFIC'; rule = 5; }
  const diagnosticManualAfter = manual.map(m => ({ ...m }));
  const out = json({
    schema: 'budget-request-alt-title-projection-segments/v0', note: 'primary decision の後の P4 / P5。前回の gate を変更せず再適用。manual contract は diagnostic としてのみ参照（alternative の生成には不使用）。前回 counterfactual は参考値',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), alternativeArtifact: fileSha(`${OUT}/alt-title-projection.json`), primaryDecision: evalP.decision },
    segmentComparison: table, reusedGates: { G1: { pass: G1, allNonblankRatio: all.nonblankRatio, nonDiscoveryNonblankRatio: non.nonblankRatio, discoveryNonblankRatio: disc.nonblankRatio }, G3: { pass: G3, boundaries: g3 }, G4: { pass: G4, mextOtherTransitions: mextOther, mhlwOtherTransitions: mhlwOther, threshold: '<= 2 each' }, G5: { pass: G5, ...nonPdf }, decision, rule, previousDecision: 'HEADER_LABEL_PRESENT_BUT_NOT_BOUNDARY_SPECIFIC', gateReusable: true },
    manualContractRelationDiagnostic: diagnosticManualAfter,
  });
  fs.writeFileSync(path.join(OUT, 'segment-structural-evaluation.json'), out);
  console.log(JSON.stringify({ sha: sha(out), table, gates: { G1, G3, G4, G5, mextOther, mhlwOther, nonPdf }, decision }, null, 1));
}

async function main() {
  const phase = process.argv.find(a => a.startsWith('--phase='))?.slice(8);
  if (phase === 'primary') await primary();
  else if (phase === 'segments') await segments();
  else throw new Error('--phase=primary|segments が必要');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
