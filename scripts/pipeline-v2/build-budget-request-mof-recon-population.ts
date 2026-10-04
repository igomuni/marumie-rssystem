/**
 * 概算要求PDF × MOF V2 照合 P1-A — PDF 側 population の inventory（照合結果は見ない・MOF 側を読まない）。
 * 既存の FieldResolver 抽出 artifact（data/work/budget-request-field-resolver/**\/field-resolution.json）から、
 * recordKind=item / request の record を、source・locator・名称・親とともに固定する。新しい PDF 抽出はしない。
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-mof-recon-population.ts
 * 出力: tests/fixtures/budget-request-mof-reconciliation/2024/p1-pdf-population.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { listExtractionTargets } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';

const ROOT = path.join('data', 'work', 'budget-request-field-resolver');
const OUT = path.join('tests', 'fixtures', 'budget-request-mof-reconciliation', '2024', 'p1-pdf-population.json');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Field { status: string; value: { raw: string; normalized?: string } | { parentNodeRef: string } | null; reasonCode: string | null }
interface Rec { anchor: { page: number; logicalRowIndex: number }; recordKind: string; rowLocal: { code: Field; name: Field }; hierarchyDependent: { parentItemAssociation: Field; parentOrganizationAssociation: Field } }
interface RunFile { documentKey: string; source: { canonicalUrl: string }; pageRange: { from: number; to: number }; hierarchyInput: unknown; records: Rec[] }

function findRuns(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'evaluation') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findRuns(p));
    else if (e.name === 'field-resolution.json') out.push(p);
  }
  return out.sort(cmp);
}

const refAnchor = (ref: string) => { const m = /-p(\d+)-r(\d+)$/.exec(ref); return m ? `${m[1]}:${m[2]}` : null; };
const nameOf = (f: Field) => (f.status === 'resolved' && f.value && 'raw' in f.value ? { raw: f.value.raw, normalized: f.value.normalized ?? null } : null);
const codeOf = (f: Field) => (f.status === 'resolved' && f.value && 'raw' in f.value ? f.value.raw : null);

function main() {
  const targets = listExtractionTargets(getBudgetRequestManifest(2024));
  const targetByUrl = new Map(targets.map(t => [t.canonicalUrl, t]));
  const shaCache = new Map<string, string>();
  const runs = findRuns(ROOT);
  const records: Record<string, unknown>[] = [];
  const runSummaries: Record<string, unknown>[] = [];

  for (const file of runs) {
    const bytes = fs.readFileSync(file);
    const run = JSON.parse(bytes.toString('utf8')) as RunFile;
    const runId = path.relative(ROOT, path.dirname(file));
    const t = targetByUrl.get(run.source.canonicalUrl);
    if (!t) throw new Error(`manifest に無い source: ${run.source.canonicalUrl}`);
    if (!shaCache.has(t.localPath)) shaCache.set(t.localPath, sha(fs.readFileSync(t.localPath)));
    const byAnchor = new Map(run.records.map(r => [`${r.anchor.page}:${r.anchor.logicalRowIndex}`, r]));
    const nodeRec = (f: Field) => {
      if (f.status !== 'resolved' || !f.value || !('parentNodeRef' in f.value)) return { status: f.status === 'resolved' ? 'unresolved' : f.status, reasonCode: f.reasonCode, ref: null as string | null, record: null as Rec | null };
      const a = refAnchor(f.value.parentNodeRef);
      return { status: 'resolved', reasonCode: null, ref: f.value.parentNodeRef, record: a ? byAnchor.get(a) ?? null : null };
    };
    let items = 0, requests = 0;
    for (const r of run.records) {
      if (r.recordKind !== 'item' && r.recordKind !== 'request') continue;
      const org = nodeRec(r.hierarchyDependent.parentOrganizationAssociation);
      const item = r.recordKind === 'request' ? nodeRec(r.hierarchyDependent.parentItemAssociation) : null;
      records.push({
        runId, documentKey: run.documentKey, canonicalUrl: run.source.canonicalUrl,
        sourceAuthority: t.publisherAuthority, sourceDomain: t.publisherDomain, accountType: t.accountType, account: t.account,
        sourceFile: t.localPath, sourceSha256: shaCache.get(t.localPath),
        page: r.anchor.page, logicalRowIndex: r.anchor.logicalRowIndex, recordKind: r.recordKind,
        rawCode: codeOf(r.rowLocal.code), nameStatus: r.rowLocal.name.status, nameReason: r.rowLocal.name.reasonCode, name: nameOf(r.rowLocal.name),
        parentOrganization: { status: org.status, reasonCode: org.reasonCode, ref: org.ref, recordKind: org.record?.recordKind ?? null, name: org.record ? nameOf(org.record.rowLocal.name) : null, rawCode: org.record ? codeOf(org.record.rowLocal.code) : null },
        parentItem: item ? { status: item.status, reasonCode: item.reasonCode, ref: item.ref, recordKind: item.record?.recordKind ?? null, name: item.record ? nameOf(item.record.rowLocal.name) : null, rawCode: item.record ? codeOf(item.record.rowLocal.code) : null } : null,
      });
      if (r.recordKind === 'item') items++; else requests++;
    }
    runSummaries.push({ runId, documentKey: run.documentKey, canonicalUrl: run.source.canonicalUrl, pageRange: run.pageRange, hierarchyInput: run.hierarchyInput !== null, artifactPath: path.join(ROOT, runId, 'field-resolution.json'), artifactSha256: sha(bytes), records: run.records.length, items, requests });
  }

  records.sort((a, b) => cmp(`${a.runId}\x1f${String(a.page).padStart(6, '0')}\x1f${String(a.logicalRowIndex).padStart(6, '0')}`, `${b.runId}\x1f${String(b.page).padStart(6, '0')}\x1f${String(b.logicalRowIndex).padStart(6, '0')}`));
  const locator = (r: Record<string, unknown>) => `${r.runId}#${r.page}:${r.logicalRowIndex}`;
  const sourceLoc = (r: Record<string, unknown>) => `${r.canonicalUrl}#${r.page}:${r.logicalRowIndex}`;
  const count = (rows: Record<string, unknown>[], f: (r: Record<string, unknown>) => string) => { const m = new Map<string, number>(); rows.forEach(r => m.set(f(r), (m.get(f(r)) ?? 0) + 1)); return Object.fromEntries([...m.entries()].sort(([a], [b]) => cmp(a, b))); };
  const dupBy = (f: (r: Record<string, unknown>) => string) => { const m = new Map<string, number>(); records.forEach(r => m.set(f(r), (m.get(f(r)) ?? 0) + 1)); return [...m.entries()].filter(([, n]) => n > 1).map(([k, n]) => ({ key: k, count: n })); };
  const items = records.filter(r => r.recordKind === 'item');
  const requests = records.filter(r => r.recordKind === 'request');
  const sameName = (rows: Record<string, unknown>[]) => { const m = new Map<string, number>(); rows.forEach(r => { const n = (r.name as { raw: string } | null)?.raw; if (n) m.set(n, (m.get(n) ?? 0) + 1); }); return [...m.values()].filter(v => v > 1).length; };
  const out = {
    schema: 'budget-request-mof-reconciliation-p1-pdf-population/v0',
    scope: '既存の FieldResolver 抽出 artifact（新しい PDF 抽出はしない）。recordKind=item / request。MOF 側とのマッチ結果は含まない',
    generator: 'scripts/pipeline-v2/build-budget-request-mof-recon-population.ts',
    runs: runSummaries,
    counts: {
      runsTotal: runs.length, runsWithItemOrRequest: runSummaries.filter(r => (r.items as number) + (r.requests as number) > 0).length,
      items: items.length, requests: requests.length,
      bySource: count(records, r => `${r.sourceAuthority}|${r.recordKind}`),
      byRun: count(records, r => `${r.runId}|${r.recordKind}`),
      byAccountType: count(records, r => `${r.accountType}|${r.recordKind}`),
      nameStatus: count(records, r => `${r.recordKind}|${r.nameStatus}`),
      parentOrganizationStatus: count(records, r => `${r.recordKind}|${(r.parentOrganization as { status: string }).status}`),
      requestParentItemStatus: count(requests, r => (r.parentItem as { status: string }).status),
      itemWithoutParentOrganizationName: items.filter(r => !(r.parentOrganization as { name: unknown }).name).length,
      requestWithoutParentItemName: requests.filter(r => !(r.parentItem as { name: unknown }).name).length,
      duplicateRunLocators: dupBy(locator), duplicateSourceLocators: dupBy(sourceLoc),
      sameResolvedNameMoreThanOnce: { items: sameName(items), requests: sameName(requests) },
    },
    records,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const text = `${JSON.stringify(out, null, 2)}\n`;
  fs.writeFileSync(OUT, text);
  console.log(JSON.stringify({ sha256: sha(text), counts: out.counts }, null, 1).slice(0, 3500));
}

main();
