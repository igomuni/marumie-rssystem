/**
 * FY2024 概算要求 full-corpus baseline — extraction-only の評価（MOF との照合は含まない）。
 * 入力: runner の出力（data/work/budget-request-corpus-baseline/2024）と凍結済みの corpus manifest。値の補正・補完はしない。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-corpus-baseline-extraction.ts
 * 出力: tests/fixtures/budget-request-full-corpus-baseline/2024/{extraction-baseline.json,extraction-population.json}（時間などの非決定的な値を含まない）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const DIR = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024');
const MANIFEST = path.join(DIR, 'corpus-manifest.json');
const MANIFEST_SHA = '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a';
const WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortObj = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b)));

interface Field { status: string; value: ({ raw: string; normalized?: string } | { parentNodeRef: string }) | null; reasonCode: string | null }
interface Rec { anchor: { page: number; logicalRowIndex: number }; recordKind: string; rowLocal: { code: Field; name: Field }; hierarchyDependent: { parentItemAssociation: Field; parentOrganizationAssociation: Field } }
interface SegResult { pages: [number, number]; mode: string; status: string; error: string | null; summary: unknown; outputs: { records: { path: string; sha256: string } } | null }
interface DocResult { localPath: string; sha256: string; publisherAuthority: string; accountType: string; executionClass: string; pages: number; status: string; segments: SegResult[]; total: { records: number; pages: { attempted: number; processed: number }; stageCounts: { sourceTokens: number; logicalRowCandidates: number }; pagesWithColumnLayout: number; pagesWithoutColumnLayout: number } }

const refAnchor = (ref: string) => { const m = /-p(\d+)-r(\d+)$/.exec(ref); return m ? `${m[1]}:${m[2]}` : null; };
const nameOf = (f: Field) => (f.status === 'resolved' && f.value && 'raw' in f.value ? { raw: f.value.raw, normalized: f.value.normalized ?? null } : null);
const codeOf = (f: Field) => (f.status === 'resolved' && f.value && 'raw' in f.value ? f.value.raw : null);

function main() {
  const manifestBytes = fs.readFileSync(MANIFEST);
  if (sha(manifestBytes) !== MANIFEST_SHA) throw new Error('corpus manifest が frozen 値と一致しない（STOP）');
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as { corpus: { pdfs: number; totalPages: number }; documents: { localPath: string; sha256: string; publisherAuthority: string; accountType: string }[] };
  const results: DocResult[] = [];
  for (const d of manifest.documents) {
    const slug = d.localPath.replace(/^data\/download\//, '').replace(/[/]/g, '__');
    const f = path.join(WORK, slug, 'result.json');
    if (!fs.existsSync(f)) throw new Error(`runner の結果が無い: ${d.localPath}`);
    const r = JSON.parse(fs.readFileSync(f, 'utf8')) as DocResult;
    if (r.sha256 !== d.sha256) throw new Error(`manifest と hash が一致しない: ${d.localPath}`);
    results.push(r);
  }
  if (results.length !== 82) throw new Error('結果が 82 件でない');

  // ---- record level（全 record の記録・親の解決は同一区間内の anchor で行う） ----
  const population: Record<string, unknown>[] = [];
  const kindBy = { total: {} as Record<string, number>, byMode: {} as Record<string, Record<string, number>> };
  const nameReason: Record<string, Record<string, number>> = {};
  const nameStatus: Record<string, Record<string, number>> = {};
  const requestParent = { total: 0, itemStatus: {} as Record<string, number>, parentRecordKind: {} as Record<string, number>, parentIsItem: 0, parentNamed: 0, parentOrgStatus: {} as Record<string, number> };
  const itemParent = { total: 0, orgStatus: {} as Record<string, number>, orgNamed: 0 };
  const ministry: Record<string, Record<string, number>> = {};
  const m = (key: string) => (ministry[key] ??= { pdfs: 0, pages: 0, pdfsFailed: 0, items: 0, requests: 0, itemNameUnavailable: 0, requestNameUnavailable: 0, requestParentUnresolved: 0, organizationRecords: 0, detailLines: 0 });
  const perDoc: Record<string, unknown>[] = [];

  for (const r of results) {
    const key = `${r.publisherAuthority}|${r.accountType}`;
    const mm = m(key);
    mm.pdfs++; mm.pages += r.pages; if (r.status !== 'success') mm.pdfsFailed++;
    let docItems = 0, docRequests = 0;
    for (const seg of r.segments) {
      if (seg.status !== 'success' || !seg.outputs) continue;
      const recs = zlib.gunzipSync(fs.readFileSync(seg.outputs.records.path)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Rec);
      if (sha(fs.readFileSync(seg.outputs.records.path)) !== seg.outputs.records.sha256) throw new Error(`artifact の hash 不一致: ${seg.outputs.records.path}`);
      const byAnchor = new Map(recs.map(x => [`${x.anchor.page}:${x.anchor.logicalRowIndex}`, x]));
      for (const x of recs) {
        const k = x.recordKind;
        inc(kindBy.total, k); inc((kindBy.byMode[seg.mode] ??= {}), k);
        inc((nameStatus[k] ??= {}), x.rowLocal.name.status);
        if (x.rowLocal.name.status !== 'resolved') inc((nameReason[k] ??= {}), x.rowLocal.name.reasonCode ?? 'none');
        if (k === 'organization') mm.organizationRecords++;
        if (k === 'detail_line') mm.detailLines++;
        if (k !== 'item' && k !== 'request') continue;
        const link = (f: Field) => {
          if (f.status !== 'resolved' || !f.value || !('parentNodeRef' in f.value)) return { status: f.status === 'resolved' ? 'unresolved' : f.status, reasonCode: f.reasonCode, ref: null as string | null, record: null as Rec | null };
          const a = refAnchor(f.value.parentNodeRef);
          return { status: 'resolved', reasonCode: null, ref: f.value.parentNodeRef, record: a ? byAnchor.get(a) ?? null : null };
        };
        const org = link(x.hierarchyDependent.parentOrganizationAssociation);
        const item = k === 'request' ? link(x.hierarchyDependent.parentItemAssociation) : null;
        if (k === 'item') { docItems++; mm.items++; itemParent.total++; inc(itemParent.orgStatus, org.status); if (org.record && nameOf(org.record.rowLocal.name)) itemParent.orgNamed++; if (x.rowLocal.name.status !== 'resolved') mm.itemNameUnavailable++; }
        else {
          docRequests++; mm.requests++; requestParent.total++;
          inc(requestParent.itemStatus, item!.status);
          if (item!.record) { inc(requestParent.parentRecordKind, item!.record.recordKind); if (item!.record.recordKind === 'item') requestParent.parentIsItem++; if (nameOf(item!.record.rowLocal.name)) requestParent.parentNamed++; }
          inc(requestParent.parentOrgStatus, org.status);
          if (x.rowLocal.name.status !== 'resolved') mm.requestNameUnavailable++;
          if (!(item!.status === 'resolved' && item!.record?.recordKind === 'item')) mm.requestParentUnresolved++;
        }
        population.push({
          localPath: r.localPath, segment: seg.pages, mode: seg.mode, sourceSha256: r.sha256, sourceAuthority: r.publisherAuthority, accountType: r.accountType,
          page: x.anchor.page, logicalRowIndex: x.anchor.logicalRowIndex, recordKind: k, rawCode: codeOf(x.rowLocal.code),
          nameStatus: x.rowLocal.name.status, nameReason: x.rowLocal.name.reasonCode, name: nameOf(x.rowLocal.name),
          parentOrganization: { status: org.status, reasonCode: org.reasonCode, ref: org.ref, recordKind: org.record?.recordKind ?? null, name: org.record ? nameOf(org.record.rowLocal.name) : null },
          parentItem: item ? { status: item.status, reasonCode: item.reasonCode, ref: item.ref, recordKind: item.record?.recordKind ?? null, name: item.record ? nameOf(item.record.rowLocal.name) : null, rawCode: item.record ? codeOf(item.record.rowLocal.code) : null } : null,
        });
      }
    }
    perDoc.push({
      localPath: r.localPath, publisherAuthority: r.publisherAuthority, accountType: r.accountType, executionClass: r.executionClass, status: r.status, pages: r.pages, pagesProcessed: r.total.pages.processed,
      records: r.total.records, items: docItems, requests: docRequests,
      segments: r.segments.map(s => ({ pages: s.pages, mode: s.mode, status: s.status, error: s.error })),
    });
  }
  population.sort((a, b) => cmp(`${a.localPath}\x1f${(a.segment as number[])[0]}\x1f${String(a.page).padStart(6, '0')}\x1f${String(a.logicalRowIndex).padStart(6, '0')}`, `${b.localPath}\x1f${(b.segment as number[])[0]}\x1f${String(b.page).padStart(6, '0')}\x1f${String(b.logicalRowIndex).padStart(6, '0')}`));

  const statusCount: Record<string, number> = {};
  results.forEach(r => inc(statusCount, r.status));
  const failureBoundary: Record<string, number> = {};
  const failures = results.filter(r => r.status !== 'success').map(r => ({ localPath: r.localPath, publisherAuthority: r.publisherAuthority, accountType: r.accountType, pages: r.pages, executionClass: r.executionClass, errors: r.segments.filter(s => s.error).map(s => ({ pages: s.pages, mode: s.mode, status: s.status, error: s.error })) }));
  for (const f of failures) for (const e of f.errors) inc(failureBoundary, `${e.status}:${(e.error ?? '').replace(/[0-9]+/g, 'N')}`);
  const byClass = Object.fromEntries(['runnable_existing_contract', 'unrunnable_missing_hierarchy', 'unrunnable_missing_layout_contract', 'unrunnable_other'].map(c => {
    const rs = results.filter(r => r.executionClass === c);
    return [c, { pdfs: rs.length, pages: rs.reduce((n, r) => n + r.pages, 0), success: rs.filter(r => r.status === 'success').length, failed: rs.filter(r => r.status !== 'success').length }];
  }));
  const sum = (f: (r: DocResult) => number) => results.reduce((n, r) => n + f(r), 0);
  const evaluation = {
    schema: 'budget-request-full-corpus-baseline-extraction/v0',
    scope: 'FY2024 概算要求 82 PDF を現行 pipeline に無修正で適用した extraction-only の baseline（MOF との照合は含まない）',
    frozen: { corpusManifestSha256: MANIFEST_SHA, protocolCommit: '4d76dbcf2b45f9a0e2338f8026b476e3842d8849', runnerCommit: '3ae5c819c1c84ee58853aad13124551acdf8588c' },
    document: {
      totalPdfs: results.length, status: sortObj(statusCount), byExecutionClass: byClass,
      pages: { total: manifest.corpus.totalPages, attempted: sum(r => r.total.pages.attempted), processed: sum(r => r.total.pages.processed) },
      successfulPdfsPages: sum(r => (r.status === 'success' ? r.pages : 0)),
      stageCounts: { sourceTokens: sum(r => r.total.stageCounts.sourceTokens), logicalRowCandidates: sum(r => r.total.stageCounts.logicalRowCandidates), pagesWithColumnLayout: sum(r => r.total.pagesWithColumnLayout), pagesWithoutColumnLayout: sum(r => r.total.pagesWithoutColumnLayout) },
      unsupported: 0, notRunnable: results.filter(r => r.status === 'not_runnable').length,
      failures,
    },
    records: { total: sum(r => r.total.records), byKind: sortObj(kindBy.total), byMode: sortObj(Object.fromEntries(Object.entries(kindBy.byMode).map(([k, v]) => [k, sortObj(v)]))), nameStatusByKind: sortObj(Object.fromEntries(Object.entries(nameStatus).map(([k, v]) => [k, sortObj(v)]))), nameUnavailableReasonByKind: sortObj(Object.fromEntries(Object.entries(nameReason).map(([k, v]) => [k, sortObj(v)]))) },
    items: { total: itemParent.total, nameAvailable: nameStatus.item?.resolved ?? 0, nameUnavailable: itemParent.total - (nameStatus.item?.resolved ?? 0), parentOrganizationStatus: sortObj(itemParent.orgStatus), parentOrganizationNamed: itemParent.orgNamed },
    requests: {
      total: requestParent.total, nameAvailable: requestParent.total - Object.entries(nameStatus.request ?? {}).filter(([k]) => k !== 'resolved').reduce((n, [, v]) => n + v, 0),
      parentItemStatus: sortObj(requestParent.itemStatus), parentRecordKind: sortObj(requestParent.parentRecordKind), parentIsItemKind: requestParent.parentIsItem, parentNamed: requestParent.parentNamed, parentOrganizationStatus: sortObj(requestParent.parentOrgStatus),
    },
    byMinistry: sortObj(ministry),
    failureDistribution: {
      A_documentRunBoundary: { hardFailureOrException: sortObj(failureBoundary), unsupported: 0, notRunnable: 0 },
      B_recordDetection: { pdfsWithSuccessAndNoItem: perDoc.filter(d => d.status === 'success' && d.items === 0).length, pdfsWithSuccessAndNoRequest: perDoc.filter(d => d.status === 'success' && d.requests === 0).length, pdfsWithHierarchyContractAndNoItem: perDoc.filter(d => d.executionClass === 'runnable_existing_contract' && d.status === 'success' && d.items === 0).length, unclassifiedRecords: kindBy.total.unclassified ?? 0 },
      C_nameResolution: sortObj(Object.fromEntries(Object.entries(nameReason).map(([k, v]) => [k, sortObj(v)]))),
      D_hierarchy: { requestsParentItemNotObserved: requestParent.itemStatus.not_observed ?? 0, requestsParentItemUnresolved: requestParent.itemStatus.unresolved ?? 0, requestsParentResolvedButNotItemKind: requestParent.itemStatus.resolved ? requestParent.itemStatus.resolved - requestParent.parentIsItem : 0, requestsParentIsItem: requestParent.parentIsItem },
    },
    perDocument: perDoc.sort((a, b) => cmp(a.localPath as string, b.localPath as string)),
  };
  const evalText = `${JSON.stringify(evaluation, null, 2)}\n`;
  const popText = `${JSON.stringify({ schema: 'budget-request-full-corpus-baseline-extraction-population/v0', scope: 'full-corpus baseline の recordKind=item / request（MOF 照合の入力。照合結果は含まない）', records: population.length, items: population.filter(p => p.recordKind === 'item').length, requests: population.filter(p => p.recordKind === 'request').length, population }, null, 2)}\n`;
  fs.writeFileSync(path.join(DIR, 'extraction-baseline.json'), evalText);
  fs.writeFileSync(path.join(DIR, 'extraction-population.json'), popText);
  console.log(JSON.stringify({ evalSha: sha(evalText), popSha: sha(popText), document: { status: evaluation.document.status, pages: evaluation.document.pages, byExecutionClass: byClass }, records: evaluation.records.byKind, items: evaluation.items, requests: evaluation.requests, failureA: evaluation.failureDistribution.A_documentRunBoundary, B: evaluation.failureDistribution.B_recordDetection, C: evaluation.failureDistribution.C_nameResolution, D: evaluation.failureDistribution.D_hierarchy }, null, 1));
}

main();
