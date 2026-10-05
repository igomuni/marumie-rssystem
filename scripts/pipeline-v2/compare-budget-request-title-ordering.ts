/**
 * Phase B: frozen な Phase A（title ordering source-only inventory）と、前回の header label projection / segment・layout range・manual contract 境界・mext / mhlw・semantic-boundary population との比較（事前登録 Page_Header_Blank_Title_Ordering_Protocol）。
 * Phase A の rule・artifact は変更しない。segment counterfactual は post-freeze diagnostic のみ（production rule・新 extractor として採用しない。manual 境界への一致率で rule を選ばない）。blank に前後 page の label を補完しない（blank page 自身の source label だけを使う診断）。MOF は使わない。
 * 使い方: npx tsx scripts/pipeline-v2/compare-budget-request-title-ordering.ts
 * 出力: tests/fixtures/budget-request-title-ordering/2024/title-ordering-phaseB-comparison.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { hierarchyContractFor } from './lib/budget-request-corpus-plan';
import { segmentize, type PageProjection, type PageTitle } from './lib/budget-request-header-label';

const FX = 'tests/fixtures';
const OUT = path.join(FX, 'budget-request-title-ordering', '2024');
const P = {
  inv: `${OUT}/page-ordering-inventory.json`, sum: `${OUT}/page-ordering-summary.json`, projection: `${FX}/budget-request-header-label/2024/header-label-projection.json`, comparison: `${FX}/budget-request-header-label/2024/header-label-structural-comparison.json`,
  layout: `${FX}/budget-request-layout-hierarchy-inventory/2024/layout-summary.json`, paired: `${FX}/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json`, population: `${FX}/budget-request-semantic-boundary/2024/population-887.json`,
  protocol: 'docs/tasks/20261005_1117_Budget_Request_Page_Header_Blank_Title_Ordering_Protocol.md',
};
const FROZEN: Record<string, string> = {
  [P.inv]: '9eb910a876fb3c807fa957f9b9ca65879187f55b1d338c6e4180ea8a544fddc3', [P.sum]: '45a157b4d6d6a22d2b141a0734c070fb2dcaca17b8483ac79a58d750dddf61ef',
  [P.projection]: '9ff3b970d403d37aea3562cc0eb87a3ee07fca92cbd3bc03986c79b7b9c402e5', [P.comparison]: 'e196ab814ccad140f0592c5500c7158e59b8d82108940ff3e1d2e7def0144d6d',
  [P.layout]: '67808613ed7d0a0e0ef7df7be736473a88159306417254100e6241fe69d63266', [P.paired]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1',
  [P.population]: '24f4803bb3fefd756ccb85f313404879529588792d7ae88352b30beab34c1aee', [P.protocol]: 'b3ed79803f9d60a72bbd2b9b068d8893e042fb915958f287d4c1f2cf9af4f2f8',
};
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);

interface Ev { p: number; st: string; cls: string; br: string | null; label: [number, number, number, string, string, number | null, number | null, number[]] | null }
interface PdfInv { localPath: string; accountType: string; pages: number; evidence: Ev[] }
interface PdfProj { localPath: string; projection: { p: number; s: string; n: string | null }[]; segments: { kind: string; state: string; from: number; to: number; pages: number }[] }
interface Rec { anchor: { page: number; logicalRowIndex: number }; rowLocal: { code: { status: string; value: { raw: string } | null; evidence: { bboxUnion: { xMin: number } } | null }; name: { value: { raw: string } | null } } }

function title(status: PageTitle['status'], n: string | null): PageTitle { return { status, blankReason: null, firstTitleRaw: n, firstTitleNormalized: n, shape: null, sourceRefs: null }; }

async function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const inv = readJson<{ perPdf: PdfInv[]; decision: { decision: string } }>(P.inv).perPdf;
  const invBy = new Map(inv.map(p => [p.localPath, p]));
  const proj = readJson<{ pdfs: PdfProj[] }>(P.projection).pdfs;
  const layout = new Map(readJson<{ perPdf: { localPath: string; ranges: { from: number; to: number }[] }[] }>(P.layout).perPdf.map(p => [p.localPath, p]));
  const paired = readJson<{ documents: { localPath: string; canonicalUrl: string; class: string }[] }>(P.paired).documents.filter(d => d.class === 'paired_evaluable');
  const contract = new Map(paired.map(d => [d.localPath, hierarchyContractFor(d.canonicalUrl)!.pages as [number, number]]));
  const pop = readJson<{ rows: { localPath: string; onKind: string; page: number }[] }>(P.population).rows;
  const ev = (lp: string, page: number) => invBy.get(lp)!.evidence.find(e => e.p === page)!;

  // ---- 8.1: label → blank → label（blank 1 page）で、blank page 自身の source label が前後と一致するか（補完ではない）----
  const triple: Record<string, number> = {};
  const tripleByCls: Record<string, number> = {};
  for (const pdf of proj) {
    const ps = pdf.projection;
    for (let k = 1; k + 1 < ps.length; k++) {
      if (!(ps[k].s === 'observed_blank' && ps[k - 1].s === 'observed_nonblank' && ps[k + 1].s === 'observed_nonblank')) continue;
      const own = ev(pdf.localPath, ps[k].p).label?.[4] ?? null;
      const a = ps[k - 1].n, b = ps[k + 1].n;
      const rel = own === null ? 'no_own_label' : own === a && own === b ? 'own_equals_both_neighbors' : own === a ? 'own_equals_prev_only' : own === b ? 'own_equals_next_only' : 'own_differs_from_both';
      inc(triple, `${rel}|neighbors_${a === b ? 'same' : 'different'}`);
      inc(tripleByCls, ev(pdf.localPath, ps[k].p).cls);
    }
  }

  // ---- segment counterfactual（post-freeze diagnostic のみ）: blank page に自身の label row があればその normalized を使う（前後からの補完なし）----
  const diagSeg = (pdf: PdfProj) => {
    const pages: PageProjection[] = pdf.projection.map(x => {
      if (x.s === 'observed_blank') { const own = ev(pdf.localPath, x.p).label?.[4] ?? null; if (own) return { page: x.p, title: title('observed_nonblank', own) }; return { page: x.p, title: title('observed_blank', null) }; }
      if (x.s === 'observed_nonblank') return { page: x.p, title: title('observed_nonblank', x.n) };
      return { page: x.p, title: title(x.s as PageTitle['status'], null) };
    });
    return segmentize(pages);
  };
  const stat = (segs: { kind: string; state: string; from: number; to: number }[]) => {
    const labelSegs = segs.filter(s => s.kind === 'label');
    let direct = 0, viaBlank = 0, sameViaBlank = 0;
    for (let k = 1; k < segs.length; k++) if (segs[k - 1].kind === 'label' && segs[k].kind === 'label' && segs[k - 1].state !== segs[k].state) direct++;
    for (let k = 1; k + 1 < segs.length; k++) if (segs[k].kind !== 'label' && segs[k - 1].kind === 'label' && segs[k + 1].kind === 'label') (segs[k - 1].state === segs[k + 1].state ? sameViaBlank++ : viaBlank++);
    return { labelSegments: labelSegs.length, directLabelTransitions: direct, blankMediatedSameLabelRecurrence: sameViaBlank, blankMediatedDifferentLabel: viaBlank, blankSegments: segs.filter(s => s.kind === 'blank').length, segments: segs.length };
  };
  const cur: Record<string, ReturnType<typeof stat>> = {}, diag: Record<string, ReturnType<typeof stat>> = {};
  const tot = (m: Record<string, ReturnType<typeof stat>>) => Object.values(m).reduce((a, s) => ({ labelSegments: a.labelSegments + s.labelSegments, directLabelTransitions: a.directLabelTransitions + s.directLabelTransitions, blankMediatedSameLabelRecurrence: a.blankMediatedSameLabelRecurrence + s.blankMediatedSameLabelRecurrence, blankMediatedDifferentLabel: a.blankMediatedDifferentLabel + s.blankMediatedDifferentLabel, blankSegments: a.blankSegments + s.blankSegments, segments: a.segments + s.segments }), { labelSegments: 0, directLabelTransitions: 0, blankMediatedSameLabelRecurrence: 0, blankMediatedDifferentLabel: 0, blankSegments: 0, segments: 0 });
  const diagSegsBy = new Map<string, ReturnType<typeof segmentize>>();
  for (const pdf of proj) { cur[pdf.localPath] = stat(pdf.segments); const ds = diagSeg(pdf); diagSegsBy.set(pdf.localPath, ds); diag[pdf.localPath] = stat(ds); }
  const focus = (sfx: string) => { const lp = proj.find(p => p.localPath.endsWith(sfx))!.localPath; return { localPath: lp, current: cur[lp], diagnostic: diag[lp] }; };

  // ---- manual contract 境界の page class / reason ----
  const manual = [...contract.entries()].map(([lp, [a, b]]) => {
    const pick = (p: number) => { const e = invBy.get(lp)!.evidence.find(x => x.p === p); return e ? { page: p, currentStatus: e.st, cls: e.cls, blankReason: e.br, ownLabel: e.label?.[4] ?? null } : { page: p, currentStatus: 'out_of_range' }; };
    const ds = diagSegsBy.get(lp)!;
    const segAt = (p: number) => ds.find(s => p >= s.from && p <= s.to) ?? null;
    return { localPath: lp, manual: [a, b], aroundStart: [a - 1, a, a + 1].map(pick), aroundEnd: [b - 1, b, b + 1].map(pick), diagnosticStartIsSegmentStart: !!segAt(a) && segAt(a)!.kind === 'label' && segAt(a)!.from === a && a > 1, diagnosticEndIsSegmentEnd: !!segAt(b) && segAt(b)!.kind === 'label' && segAt(b)!.to === b && b < invBy.get(lp)!.pages };
  });

  // ---- layout 境界上の blank page ----
  const layoutBlank: Record<string, number> = {};
  for (const [lp, l] of layout) { const e = invBy.get(lp); if (!e) continue; for (const r of l.ranges.slice(1)) for (const pg of [r.from - 1, r.from]) { const x = e.evidence.find(v => v.p === pg); if (x) inc(layoutBlank, x.st === 'observed_blank' ? `blank:${x.br}` : x.st); } }

  // ---- x=38 の 3 桁 code 行（mext / mhlw、manual range 外 450 件ずつ）の page-level blank reason ----
  const x38: Record<string, unknown> = {};
  for (const lp of [...contract.keys()].filter(k => /_03\.pdf$|05-1b-01\.pdf$/.test(k))) {
    const res = readJson<{ segments: { outputs: { records: { path: string } } }[] }>(path.join(BASE_WORK, slugOf(lp), 'result.json'));
    const [a, b] = contract.get(lp)!;
    const rows = res.segments.flatMap(s => readGz<Rec>(s.outputs.records.path)).filter(r => r.rowLocal.code.value && /^\d{3}$/.test(r.rowLocal.code.value.raw) && r.rowLocal.code.status === 'resolved' && Math.abs((r.rowLocal.code.evidence?.bboxUnion.xMin ?? 0) - 38) <= 0.5 && r.rowLocal.name.value === null);
    const by: Record<string, number> = {}, byCls: Record<string, number> = {}; let outside = 0;
    for (const r of rows) { const e = ev(lp, r.anchor.page); inc(by, e.st === 'observed_blank' ? `blank:${e.br}` : e.st); inc(byCls, e.cls); if (r.anchor.page < a || r.anchor.page > b) outside++; }
    x38[path.basename(lp)] = { rows: rows.length, outsideManual: outside, pageLevelReason: by, pageLevelClass: byCls };
  }

  // ---- semantic-boundary population のページ ----
  const popRel: Record<string, Record<string, number>> = {};
  for (const r of pop) { const e = ev(r.localPath, r.page); const k = e.st === 'observed_blank' ? `blank:${e.br}` : e.st; (popRel[r.onKind] ??= {}); inc(popRel[r.onKind], k); }

  const out = sortDeep({
    schema: 'budget-request-title-ordering-phaseB/v0', note: 'Phase A は変更していない。counterfactual は post-freeze diagnostic のみで production rule・新 extractor ではない。blank に前後 page の label を補完していない。label の意味は解釈しない。manual contract・existing ON kind は GT ではない。MOF は未使用',
    frozen: { hashes: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])) }, phaseADecision: readJson<{ decision: unknown }>(P.sum).decision,
    labelBlankLabel: { description: 'label → blank（1 page）→ label の triple で、blank page 自身の source label の normalized が前後の label と一致するか', byRelation: triple, blankPageClassOfTriples: tripleByCls },
    segmentCounterfactualDiagnostic: { current: tot(cur), diagnostic: tot(diag), mext: focus('mxt_kaikesou01-000031817_03.pdf'), mhlw: focus('05-1b-01.pdf'), definition: 'blank page に自身の label-shaped row（Phase A）があれば、その normalized を label として同じ segmentation rule を適用（前後からの補完なし）' },
    manualContractBoundaries: manual, layoutBoundaryPageStatus: layoutBlank, x38Rows: x38, semanticBoundaryPopulationPages: popRel,
  });
  const text = `${JSON.stringify(out, null, 1)}\n`;
  fs.writeFileSync(path.join(OUT, 'title-ordering-phaseB-comparison.json'), text);
  console.log(JSON.stringify({ sha: sha(text), labelBlankLabel: triple, cur: (out as { segmentCounterfactualDiagnostic: { current: unknown; diagnostic: unknown } }).segmentCounterfactualDiagnostic.current, diag: (out as { segmentCounterfactualDiagnostic: { diagnostic: unknown } }).segmentCounterfactualDiagnostic.diagnostic, x38, popRel, layoutBlank }, null, 1));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
