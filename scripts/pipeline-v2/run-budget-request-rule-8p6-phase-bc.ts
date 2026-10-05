/**
 * Phase B（MOF 名称 only exact）と Phase C（band 外などの未一致診断）。Phase A freeze 後にのみ MOF を読む。candidate rule・band は変更しない。
 * protocol: docs/tasks/20261005_2040_Budget_Request_8p6pt_Item_Candidate_Full_Corpus_Protocol.md
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/run-budget-request-rule-8p6-phase-bc.ts --phase=b|c
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { universeRow } from './lib/budget-request-rule-8p6-candidate';
import type { SourceRecord } from './lib/budget-request-rule-line-item-population';
import { readJsonl } from './lib/jsonl';
import type { MofBudgetJikouRecord } from './types';

const FX = 'tests/fixtures';
const A = `${FX}/budget-request-rule-8p6-item-candidate/2024`;
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const ISO = `${FX}/budget-request-hierarchy-failure-isolation/2024`, BASE_FIX = `${FX}/budget-request-full-corpus-baseline/2024`;
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const OFF_WORK = path.join('data', 'work', 'budget-request-hierarchy-failure-isolation', '2024', 'off');
const FROZEN: Record<string, string> = {
  [JIKOU]: 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e', [`${BASE_FIX}/corpus-manifest.json`]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', [`${ISO}/paired-manifest.json`]: '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1', [`${ISO}/off-diagnostic.json`]: '9b0a9273778320a42252d12073689c4d1bd690e1a0e2ac1d68aaabdb41ea2562',
  'scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts': 'da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a',
  'docs/tasks/20261005_2040_Budget_Request_8p6pt_Item_Candidate_Full_Corpus_Protocol.md': 'ad022eeb14a763da4a61cd159fab078461a640bbc56619bbf71500318857b21a',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);

interface Row { candidateId: string; isCandidate: boolean; localPath: string; account: string; page: number; logicalRowIndex: number; code: string; codeX: number; nameRaw: string | null; nameNormalized: string | null; nameComplete: boolean; nameClass: string; ruleStatus: string; ruleX: number | null; deltaX: number | null }
interface Sec { id: string; code: string; name: string; norm: string; ministry: string; organization: string }

function loadMof(): Sec[] {
  const m = new Map<string, Sec>();
  for (const j of readJsonl<MofBudgetJikouRecord>(JIKOU)) if (j.accountType === 'general' && !m.has(j.parentSectionId)) m.set(j.parentSectionId, { id: j.parentSectionId, code: j.sectionCode, name: j.sectionName, norm: normalizeKey(j.sectionName), ministry: j.ministry, organization: j.organization });
  if (m.size !== 784) throw new Error(`MOF 一般会計の項が 784 でない（STOP）: ${m.size}`);
  return [...m.values()].sort((a, b) => cmp(a.id, b.id));
}
function guard() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const freeze = readJson<{ artifacts: Record<string, string> }>(`${A}/phaseA-freeze-manifest.json`);
  for (const [p, h] of Object.entries(freeze.artifacts)) if (fileSha(p) !== h) throw new Error(`Phase A の artifact / script が freeze と不一致（STOP）: ${p}`);
  return freeze;
}

function phaseB() {
  const freeze = guard();
  const secs = loadMof();
  const byNorm = new Map<string, Sec[]>();
  for (const s of secs) { if (!byNorm.has(s.norm)) byNorm.set(s.norm, []); byNorm.get(s.norm)!.push(s); }
  const rows = readGz<Row>(`${A}/phaseA-universe.jsonl.gz`);
  const cands = rows.filter(r => r.isCandidate && r.account === 'general');
  const cls: Record<string, number> = {}, perPdf: Record<string, { candidates: number; exactRows: number; distinctMofRows: Set<string> }> = {};
  const matches: string[] = [], coveredRows = new Set<string>(), coveredNorms = new Set<string>();
  for (const c of cands) {
    const p = (perPdf[c.localPath] ??= { candidates: 0, exactRows: 0, distinctMofRows: new Set() });
    p.candidates++;
    if (!c.nameComplete || c.nameNormalized === null) { inc(cls, 'name_unavailable'); continue; }
    const m = byNorm.get(normalizeKey(c.nameNormalized)) ?? [];
    if (m.length === 0) { inc(cls, 'no_exact_name_match'); continue; }
    inc(cls, m.length === 1 ? 'name_exact_unique' : 'name_exact_ambiguous');
    p.exactRows++;
    for (const s of m) { coveredRows.add(s.id); coveredNorms.add(s.norm); p.distinctMofRows.add(s.id); matches.push(JSON.stringify({ mofSectionId: s.id, mofCode: s.code, mofName: s.name, mofMinistry: s.ministry, localPath: c.localPath, page: c.page, logicalRowIndex: c.logicalRowIndex, pdfCode: c.code, pdfRawName: c.nameRaw, normalizedName: c.nameNormalized, ruleX: c.ruleX, codeX: c.codeX, deltaX: c.deltaX, candidateNameClass: m.length === 1 ? 'name_exact_unique' : 'name_exact_ambiguous' })); }
  }
  const absent = secs.filter(s => !coveredRows.has(s.id));
  const gz = zlib.gzipSync(Buffer.from(matches.join('\n') + '\n', 'utf8'), { level: 9 });
  fs.writeFileSync(`${A}/phaseB-exact-matches.jsonl.gz`, gz);
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-rule-8p6-item-candidate-phaseB/v0',
    note: 'Phase A freeze 後の MOF 名称 only exact diagnostic。MOF は candidate 生成・band に使っていない。precision / recall ではなく name-only exact overlap / coverage',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), phaseAFreeze: freeze.artifacts, exactMatchesGzSha256: sha(gz),
    mof: { generalRows: secs.length, distinctNormalizedNames: byNorm.size },
    candidates: { generalCandidateRows: cands.length, classCounts: cls },
    coverage: { mofRowsWithExactNameCandidate: coveredRows.size, mofRowDenominator: secs.length, distinctNormalizedNamesCovered: coveredNorms.size, distinctNormalizedNameDenominator: byNorm.size },
    unmatchedMofRows: absent.length, unmatchedMofRowIds: absent.map(s => s.id), perPdfExact: Object.fromEntries(Object.entries(perPdf).filter(([, v]) => v.exactRows > 0).sort().map(([k, v]) => [k, { candidates: v.candidates, exactRows: v.exactRows, distinctMofRows: v.distinctMofRows.size }])),
  }), null, 1)}\n`;
  fs.writeFileSync(`${A}/phaseB-diagnostic.json`, text);
  console.log(JSON.stringify({ sha: sha(text), cls, coverage: [coveredRows.size, secs.length, coveredNorms.size, byNorm.size], absent: absent.length, pdfsWithExact: Object.values(perPdf).filter(v => v.exactRows > 0).length }, null, 1));
}

async function phaseC() {
  const freeze = guard();
  const b = readJson<{ exactMatchesGzSha256: string; unmatchedMofRowIds: string[] }>(`${A}/phaseB-diagnostic.json`);
  if (fileSha(`${A}/phaseB-exact-matches.jsonl.gz`) !== b.exactMatchesGzSha256) throw new Error('Phase B の artifact が freeze と不一致（STOP）');
  const secs = loadMof(), secById = new Map(secs.map(s => [s.id, s]));
  const absent = b.unmatchedMofRowIds.map(id => secById.get(id)!), absentNorms = new Map<string, Sec[]>();
  for (const s of absent) { if (!absentNorms.has(s.norm)) absentNorms.set(s.norm, []); absentNorms.get(s.norm)!.push(s); }
  const rows = readGz<Row>(`${A}/phaseA-universe.jsonl.gz`).filter(r => r.account === 'general');
  const inUniverse = new Set(rows.map(r => r.candidateId));
  const found = new Map<string, { universe: Row[]; other: { localPath: string; page: number; row: number; reason: string; code: string | null }[] }>();
  for (const n of absentNorms.keys()) found.set(n, { universe: [], other: [] });
  for (const r of rows) if (r.nameComplete && r.nameNormalized !== null) { const e = found.get(normalizeKey(r.nameNormalized)); if (e) e.universe.push(r); }
  // universe 外の row（code が plain 3 桁でない・request-shaped など）で名称 exact のもの: records を引く
  const docs = readJson<{ documents: { localPath: string; accountType: string; sha256: string }[] }>(`${BASE_FIX}/corpus-manifest.json`).documents.filter(d => d.accountType === 'general');
  const paired = new Set(readJson<{ documents: { localPath: string; class: string }[] }>(`${ISO}/paired-manifest.json`).documents.filter(d => d.class === 'paired_evaluable').map(d => d.localPath));
  const off = readJson<{ documents: { localPath: string; recordsSha256: string }[] }>(`${ISO}/off-diagnostic.json`);
  let scannedPdfs = 0;
  for (const d of docs) {
    const f = path.join(BASE_WORK, slugOf(d.localPath), 'result.json');
    if (!fs.existsSync(f)) continue;
    const res = readJson<{ status: string; segments: { pages: [number, number]; mode: string; outputs: { records: { path: string; sha256: string } } | null }[] }>(f);
    if (res.status !== 'success') continue;
    scannedPdfs++;
    for (const s of res.segments) {
      let file = s.outputs!.records.path;
      if (s.mode === 'hierarchy_enabled' && paired.has(d.localPath)) { file = path.join(OFF_WORK, slugOf(d.localPath), `seg-${s.pages[0]}-${s.pages[1]}.records.jsonl.gz`); if (fileSha(file) !== off.documents.find(x => x.localPath === d.localPath)?.recordsSha256) throw new Error(`OFF artifact の hash 不一致: ${file}`); }
      else if (fileSha(file) !== s.outputs!.records.sha256) throw new Error(`baseline artifact の hash 不一致: ${file}`);
      for (const r of readGz<SourceRecord>(file)) {
        const nm = r.rowLocal.name;
        if (nm.status !== 'resolved' || !nm.value) continue;
        const e = found.get(normalizeKey(nm.value.raw)); if (!e) continue;
        const id = `${d.localPath}|p${r.anchor.page}|r${r.anchor.logicalRowIndex}`;
        if (inUniverse.has(id) || universeRow(r) !== null) continue;
        const code = r.rowLocal.code.value?.raw ?? null;
        e.other.push({ localPath: d.localPath, page: r.anchor.page, row: r.anchor.logicalRowIndex, reason: r.recordKind === 'request' ? 'request_shaped' : code === null ? 'no_code' : /^\d{3}$/.test(code) ? 'plain3_but_not_universe' : 'code_not_plain3', code });
      }
    }
  }
  const classes: Record<string, number> = {}, perMof: unknown[] = [], outside: unknown[] = [];
  for (const s of absent) {
    const e = found.get(s.norm)!;
    const linked = e.universe.filter(r => r.ruleStatus === 'rule_linked');
    const cl = linked.length > 0 ? 'exact_name_found_outside_8p6_band' : e.universe.length > 0 ? 'exact_name_found_but_rule_unavailable' : e.other.length > 0 ? 'exact_name_found_but_not_plain_3digit_structure' : 'no_exact_name_found_in_source_universe';
    inc(classes, cl);
    for (const r of linked) outside.push({ mofSectionId: s.id, mofCode: s.code, mofName: s.name, localPath: r.localPath, page: r.page, logicalRowIndex: r.logicalRowIndex, pdfCode: r.code, ruleX: r.ruleX, codeX: r.codeX, deltaX: r.deltaX });
    perMof.push({ mofSectionId: s.id, mofCode: s.code, mofName: s.name, ministry: s.ministry, class: cl, universeRowCount: e.universe.length, linkedOutsideBandRowCount: linked.length, ruleUnavailableRowCount: e.universe.length - linked.length, otherStructureReasons: Object.fromEntries(Object.entries(e.other.reduce((m: Record<string, number>, o) => { inc(m, o.reason); return m; }, {})).sort()) });
  }
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-rule-8p6-item-candidate-phaseC/v0',
    note: 'Phase A/B freeze 後の diagnostic。band を広げる・別クラスタを足す根拠にはしない。一般会計 PDF のみ（特別会計 PDF と評価不能 PDF は対象外）',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), phaseAFreeze: freeze.artifacts, phaseBExactMatchesGzSha256: b.exactMatchesGzSha256,
    searchedGeneralEvaluablePdfs: scannedPdfs, absentMofRows: absent.length, classCounts: classes, outsideBandDeltaXAllRows: outside, perMofRow: perMof,
    deltaXOfOutsideBandByValue01: Object.fromEntries(Object.entries((outside as { deltaX: number }[]).reduce((m: Record<string, number>, o) => { inc(m, (Math.round(o.deltaX * 10) / 10).toFixed(1)); return m; }, {})).sort((a, c) => Number(a[0]) - Number(c[0]))),
  }), null, 1)}\n`;
  fs.writeFileSync(`${A}/phaseC-diagnostic.json`, text);
  console.log(JSON.stringify({ sha: sha(text), classes, absent: absent.length, outsideRows: outside.length }, null, 1));
}

async function main() {
  const phase = process.argv.find(a => a.startsWith('--phase='))?.slice(8);
  if (phase === 'b') phaseB(); else if (phase === 'c') await phaseC(); else throw new Error('--phase=b|c が必要');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
