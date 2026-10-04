/**
 * hierarchy ON/OFF paired diagnostic の runner（orchestration のみ）。paired_evaluable の PDF の hierarchy 区間を、既存関数を baseline runner と同じ順序・同じオプションで呼ぶ。
 * --phase=control: hierarchy ON（baseline と同条件）。baseline の records artifact とバイト単位で一致しなければ non-zero で終了する（OFF へ進まない）。
 * --phase=off    : 同一ページ範囲を hierarchy=null（既存の optional な入力）で 1 区間として実行する。control の全件一致が記録されていなければ実行しない。
 * recordKind・親・名称の補正、hierarchy の生成、結果の書き換えはしない。
 * 使い方: node --max-old-space-size=16384 --import tsx scripts/pipeline-v2/run-budget-request-hierarchy-paired-diagnostic.ts --phase=control|off
 * 出力: data/work/budget-request-hierarchy-failure-isolation/2024/<phase>/<slug>/（git 管理外）と tests/fixtures/budget-request-hierarchy-failure-isolation/2024/{on-control,off-diagnostic}.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { observeDocumentHierarchyV2 } from './lib/budget-request-document-hierarchy-v2';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { resolveFields, type FieldResolverPageInput } from './lib/budget-request-field-resolver';
import { HIERARCHY_B_ONLY_OPTIONS } from './lib/budget-request-field-resolver-runs';

const FIX = path.join('tests', 'fixtures', 'budget-request-hierarchy-failure-isolation', '2024');
const PAIRED = path.join(FIX, 'paired-manifest.json');
const WORK = path.join('data', 'work', 'budget-request-hierarchy-failure-isolation', '2024');
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const gunzip = (f: string) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');

interface PDoc { localPath: string; sourceSha256: string; class: string; hierarchySegment: [number, number]; baselineOnRecordsSha256: string | null }
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');

async function main() {
  const phase = process.argv.find(a => a.startsWith('--phase='))?.slice(8);
  if (phase !== 'control' && phase !== 'off') throw new Error('--phase=control|off が必要');
  const pairedBytes = fs.readFileSync(PAIRED);
  const docs = (JSON.parse(pairedBytes.toString('utf8')) as { documents: PDoc[] }).documents.filter(d => d.class === 'paired_evaluable');
  if (phase === 'off') {
    const c = path.join(FIX, 'on-control.json');
    if (!fs.existsSync(c) || (JSON.parse(fs.readFileSync(c, 'utf8')) as { allMatched: boolean }).allMatched !== true) throw new Error('ON control が全件一致していない。OFF は実行しない（STOP）');
  }
  const per: Record<string, unknown>[] = [];
  let allMatched = true;
  for (const d of docs) {
    if (sha(fs.readFileSync(d.localPath)) !== d.sourceSha256) throw new Error(`原本の hash が manifest と一致しない: ${d.localPath}`);
    const [from, to] = d.hierarchySegment;
    const pages: FieldResolverPageInput[] = [];
    for (let n = from; n <= to; n++) {
      const ex = await extractPageTokens(d.localPath, n);
      const geometry = buildTableGeometry(ex.tokens, ex.page);
      pages.push({ meta: ex.page, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.page, geometry) });
    }
    const hierarchy = phase === 'control' ? observeDocumentHierarchyV2('detail', pages.map(p => ({ meta: p.meta, tokens: p.tokens, geometry: p.geometry, logical: p.logical })), HIERARCHY_B_ONLY_OPTIONS) : null;
    const result = resolveFields({ pages, hierarchy });
    const lines = result.records.map(r => JSON.stringify(r, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))).join('\n');
    const gz = zlib.gzipSync(Buffer.from(lines + '\n', 'utf8'), { level: 9 });
    const outDir = path.join(WORK, phase, slugOf(d.localPath));
    fs.mkdirSync(outDir, { recursive: true });
    const recPath = path.join(outDir, `seg-${from}-${to}.records.jsonl.gz`);
    fs.writeFileSync(recPath, gz);
    const row: Record<string, unknown> = { localPath: d.localPath, hierarchySegment: d.hierarchySegment, records: result.records.length, recordsSha256: sha(gz), contentSha256: sha(lines + '\n') };
    if (phase === 'control') {
      const basePath = path.join(BASE_WORK, slugOf(d.localPath), `seg-${from}-${to}.records.jsonl.gz`);
      const baseText = gunzip(basePath);
      const matched = sha(baseText) === row.contentSha256 && sha(fs.readFileSync(basePath)) === d.baselineOnRecordsSha256;
      const field = (t: string) => t.split('\n').filter(Boolean).map(l => { const r = JSON.parse(l) as { anchor: { page: number; logicalRowIndex: number }; recordKind: string; rowLocal: { name: { status: string; reasonCode: string | null } }; hierarchyDependent: { parentItemAssociation: { status: string } } }; return `${r.anchor.page}:${r.anchor.logicalRowIndex}|${r.recordKind}|${r.rowLocal.name.status}/${r.rowLocal.name.reasonCode}|${r.hierarchyDependent.parentItemAssociation.status}`; });
      const a = field(baseText), b = field(lines);
      const fieldMatched = a.length === b.length && a.every((x, i) => x === b[i]);
      Object.assign(row, { baselineRecords: a.length, byteExactMatch: matched, recordCountKindLocatorNameParentMatch: fieldMatched });
      if (!matched || !fieldMatched) allMatched = false;
    }
    per.push(row);
    console.log(`${phase} ${path.basename(d.localPath)} p${from}-${to}: records=${result.records.length}${phase === 'control' ? ` match=${row.byteExactMatch}` : ''}`);
  }
  const out = { schema: `budget-request-hierarchy-paired-${phase}/v0`, pairedManifestSha256: sha(pairedBytes), ...(phase === 'control' ? { allMatched } : {}), documents: per };
  fs.writeFileSync(path.join(FIX, phase === 'control' ? 'on-control.json' : 'off-diagnostic.json'), `${JSON.stringify(out, null, 2)}\n`);
  if (phase === 'control' && !allMatched) { console.error('ON control が baseline と一致しない（STOP）'); process.exitCode = 1; }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
