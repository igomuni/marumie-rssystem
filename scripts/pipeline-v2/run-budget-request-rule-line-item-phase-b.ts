/**
 * Phase B（Phase A freeze 後のみ MOF を読む）: 一般会計 candidate と MOF 項の code + 名称 exact 突合、distance × MOF 一致表、MOF 側 unmatched inventory、secondary 比較。
 * protocol: docs/tasks/20261005_1930_Budget_Request_RuleLine_Item_Population_Inventory_Protocol.md
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/run-budget-request-rule-line-item-phase-b.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { readJsonl } from './lib/jsonl';
import type { MofBudgetJikouRecord } from './types';

const FX = 'tests/fixtures';
const A = `${FX}/budget-request-rule-line-item-population/2024`;
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const ISO = `${FX}/budget-request-hierarchy-failure-isolation/2024`, BASE_FIX = `${FX}/budget-request-full-corpus-baseline/2024`;
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const FROZEN: Record<string, string> = {
  [JIKOU]: 'a63f50504c821ad7aff9fe1c96c80635dda978ea0870976d15f9bc9735d3ef7e', [`${FX}/mof-jikou-normalized/2024/202411001-integration-evaluation.json`]: '066dc9cd35e7ab301b409491206c48b4de9a582bb72a0c48c045e65a7cf2973e',
  [`${FX}/budget-request-pdf-item-candidate-count/2024/candidate-count.json`]: '35ffc096496ff9af7ab62ac5848b2ddef19ae0211f441193bf05598e7990d508', [`${FX}/budget-request-pdf-item-candidate-count/2024/mof-exact-name-diagnostic.json`]: '3a731169b4e826faab10d0110c622e95fa5942c06181c9c5cda2dd18a296855d',
  [`${BASE_FIX}/corpus-manifest.json`]: '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a', 'scripts/pipeline-v2/lib/budget-request-mof-reconciliation.ts': 'da08b37713ecee53b642f74a0098a129de6a1e1e7ccebfb822228309acb8c19a',
  'docs/tasks/20261005_1930_Budget_Request_RuleLine_Item_Population_Inventory_Protocol.md': '3b04ce00a8f1d991077d94fe740efff06c0d03819e24ac1a1e528e4f4ff9f0c0',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');

interface Cand { candidateId: string; localPath: string; account: string; ministry: string; page: number; logicalRowIndex: number; codeNormalized: string; nameNormalized: string | null; nameStatus: string; amountPattern: string; ruleStatus: string; ruleToCodeDistance01: string | null; ruleToCodeDistance001: string | null }
interface Sec { id: string; code: string; name: string; norm: string; ministry: string; organization: string }
type Cls = 'name_unavailable' | 'code_name_exact_unique' | 'code_name_exact_ambiguous' | 'name_exact_ambiguous' | 'name_exact_code_mismatch' | 'code_exact_name_mismatch' | 'no_exact_match' | 'special_account_not_evaluated';

function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const freeze = readJson<{ artifacts: Record<string, string> }>(`${A}/phaseA-freeze-manifest.json`);
  for (const [p, h] of Object.entries(freeze.artifacts)) if (fileSha(p) !== h) throw new Error(`Phase A の artifact / script が freeze と不一致（STOP）: ${p}`);
  const cands = zlib.gunzipSync(fs.readFileSync(`${A}/phaseA-candidates.jsonl.gz`)).toString('utf8').trim().split('\n').map(l => JSON.parse(l) as Cand);

  // MOF 項（一般会計）: distinct parentSectionId
  const secMap = new Map<string, Sec>();
  for (const j of readJsonl<MofBudgetJikouRecord>(JIKOU)) if (j.accountType === 'general' && !secMap.has(j.parentSectionId)) secMap.set(j.parentSectionId, { id: j.parentSectionId, code: j.sectionCode, name: j.sectionName, norm: normalizeKey(j.sectionName), ministry: j.ministry, organization: j.organization });
  if (secMap.size !== 784) throw new Error(`MOF 一般会計の項が 784 でない（STOP）: ${secMap.size}`);
  const secs = [...secMap.values()].sort((a, b) => cmp(a.id, b.id));
  const idx = (f: (s: Sec) => string) => { const m = new Map<string, Sec[]>(); for (const s of secs) { const k = f(s); if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); } return m; };
  const byCodeName = idx(s => `${s.code}|${s.norm}`), byName = idx(s => s.norm), byCode = idx(s => s.code);

  const classify = (c: Cand): { cls: Cls; ids: string[] } => {
    if (c.account !== 'general') return { cls: 'special_account_not_evaluated', ids: [] };
    if (c.nameStatus !== 'resolved' || c.nameNormalized === null) return { cls: 'name_unavailable', ids: [] };
    const cn = byCodeName.get(`${c.codeNormalized}|${normalizeKey(c.nameNormalized)}`) ?? [];
    if (cn.length === 1) return { cls: 'code_name_exact_unique', ids: [cn[0].id] };
    if (cn.length >= 2) return { cls: 'code_name_exact_ambiguous', ids: cn.map(s => s.id) };
    const n = byName.get(normalizeKey(c.nameNormalized)) ?? [];
    if (n.length >= 2) return { cls: 'name_exact_ambiguous', ids: n.map(s => s.id) };
    if (n.length === 1) return { cls: 'name_exact_code_mismatch', ids: [n[0].id] };
    if ((byCode.get(c.codeNormalized) ?? []).length >= 1) return { cls: 'code_exact_name_mismatch', ids: (byCode.get(c.codeNormalized) ?? []).map(s => s.id) };
    return { cls: 'no_exact_match', ids: [] };
  };
  const results = cands.map(c => ({ c, ...classify(c) }));
  const clsCounts: Record<string, number> = {}; for (const r of results) inc(clsCounts, r.cls);

  // distinct MOF coverage
  const coveredAny = new Set<string>(), coveredUnique = new Set<string>();
  for (const r of results) { if (r.cls === 'code_name_exact_unique') { coveredAny.add(r.ids[0]); coveredUnique.add(r.ids[0]); } if (r.cls === 'code_name_exact_ambiguous') for (const i of r.ids) coveredAny.add(i); }

  // distance × MOF 表（0.1pt bucket。unavailable 系は別行）
  const bucketOf = (c: Cand) => c.ruleToCodeDistance01 ?? c.ruleStatus;
  const table = new Map<string, { candidates: number; general: number; exactRows: number; distinct: Set<string>; distinctUnique: Set<string>; pdfs: Set<string>; ministries: Set<string>; classes: Record<string, number>; patterns: Record<string, number>; exactPatterns: Record<string, number> }>();
  for (const r of results) {
    const k = bucketOf(r.c);
    const e = table.get(k) ?? { candidates: 0, general: 0, exactRows: 0, distinct: new Set(), distinctUnique: new Set(), pdfs: new Set(), ministries: new Set(), classes: {}, patterns: {}, exactPatterns: {} };
    e.candidates++; e.pdfs.add(r.c.localPath); e.ministries.add(r.c.ministry); inc(e.patterns, r.c.amountPattern);
    if (r.c.account === 'general') { e.general++; inc(e.classes, r.cls); }
    if (r.cls === 'code_name_exact_unique' || r.cls === 'code_name_exact_ambiguous') { e.exactRows++; inc(e.exactPatterns, r.c.amountPattern); for (const i of r.ids) e.distinct.add(i); if (r.cls === 'code_name_exact_unique') e.distinctUnique.add(r.ids[0]); }
    table.set(k, e);
  }
  const tableOut = [...table.entries()].sort((a, b) => (isNaN(Number(a[0])) ? 1 : 0) - (isNaN(Number(b[0])) ? 1 : 0) || (Number(a[0]) - Number(b[0])) || cmp(a[0], b[0])).map(([k, e]) => ({ bucket01: k, candidateRows: e.candidates, generalRows: e.general, codeNameExactRows: e.exactRows, distinctMofItems: e.distinct.size, distinctMofItemsFromUniqueRows: e.distinctUnique.size, exactOverlapShare: Math.round((e.distinct.size / 784) * 1e6) / 1e6, pdfs: e.pdfs.size, ministries: e.ministries.size, generalClassCounts: e.classes, amountPatternsAllRows: e.patterns, amountPatternsExactRows: e.exactPatterns }));

  // MOF 側 unmatched inventory
  const generalCands = results.filter(r => r.c.account === 'general');
  const nameSet = new Set(generalCands.filter(r => r.c.nameStatus === 'resolved' && r.c.nameNormalized !== null).map(r => normalizeKey(r.c.nameNormalized!)));
  const codeSet = new Set(generalCands.map(r => r.c.codeNormalized));
  const bucketsOfSec = new Map<string, Set<string>>();
  for (const r of results) if (r.cls === 'code_name_exact_unique' || r.cls === 'code_name_exact_ambiguous') for (const i of r.ids) { if (!bucketsOfSec.has(i)) bucketsOfSec.set(i, new Set()); bucketsOfSec.get(i)!.add(bucketOf(r.c)); }
  const mofSide: Record<string, number> = {}; const mofRows: unknown[] = [];
  for (const s of secs) {
    const cls = coveredAny.has(s.id) ? 'code_name_exact_candidate' : nameSet.has(s.norm) ? 'name_exact_only' : codeSet.has(s.code) ? 'code_exact_only' : 'no_candidate_in_universe';
    inc(mofSide, cls);
    mofRows.push({ id: s.id, code: s.code, name: s.name, ministry: s.ministry, organization: s.organization, account: 'general', class: cls, matchedBuckets: [...(bucketsOfSec.get(s.id) ?? [])].sort() });
  }

  // secondary
  const candById = new Map(cands.map(c => [c.candidateId, c]));
  const resById = new Map(results.map(r => [r.c.candidateId, r]));
  const idOf = (lp: string, p: number, r: number) => `${lp}|p${p}|r${r}`;
  const docs = readJson<{ documents: { localPath: string }[] }>(`${BASE_FIX}/corpus-manifest.json`).documents;
  const items97: { lp: string; page: number; row: number; rec: Record<string, unknown> }[] = [];
  for (const d of docs) {
    const f = path.join(BASE_WORK, slugOf(d.localPath), 'result.json'); if (!fs.existsSync(f)) continue;
    const res = readJson<{ status: string; segments: { mode: string; outputs: { records: { path: string } } | null }[] }>(f);
    if (res.status !== 'success') continue;
    for (const s of res.segments) if (s.mode === 'hierarchy_enabled' && s.outputs) for (const l of zlib.gunzipSync(fs.readFileSync(s.outputs.records.path)).toString('utf8').split('\n').filter(Boolean)) { const j = JSON.parse(l) as { recordKind: string; anchor: { page: number; logicalRowIndex: number }; rowLocal: Record<string, { status: string; value: { raw: string } | null }> }; if (j.recordKind === 'item') items97.push({ lp: d.localPath, page: j.anchor.page, row: j.anchor.logicalRowIndex, rec: j as unknown as Record<string, unknown> }); }
  }
  const prev = readJson<{ candidates: { localPath: string; accountType: string; page: number; logicalRowIndex: number; code: string; key: string | null }[] }>(`${FX}/budget-request-pdf-item-candidate-count/2024/candidate-count.json`).candidates;
  const compare = (name: string, old: { lp: string; page: number; row: number; general: boolean }[]) => {
    const oldIds = new Set(old.map(o => idOf(o.lp, o.page, o.row)));
    const both = old.filter(o => candById.has(idOf(o.lp, o.page, o.row))), oldOnly = old.filter(o => !candById.has(idOf(o.lp, o.page, o.row)));
    const newOnly = cands.filter(c => !oldIds.has(c.candidateId));
    const bothDist: Record<string, number> = {}, newDist: Record<string, number> = {}, newMof: Record<string, number> = {};
    for (const o of both) inc(bothDist, bucketOf(candById.get(idOf(o.lp, o.page, o.row))!));
    for (const c of newOnly) { inc(newDist, bucketOf(c)); inc(newMof, resById.get(c.candidateId)!.cls); }
    return { name, oldTotal: old.length, both: both.length, oldOnly: oldOnly.length, newOnly: newOnly.length, bothByDistance: bothDist, newOnlyByDistance: newDist, newOnlyMofClass: newMof, oldOnlyIds: oldOnly.slice(0, 5).map(o => idOf(o.lp, o.page, o.row)) };
  };
  const prevGeneral = prev.filter(p => p.accountType === 'general');
  // old-only の失敗理由（structural 条件のどれを満たさないか）は records を引いて分類
  const need = new Set<string>(); const secondary = {
    existingItem97: compare('existing_hierarchy_item_97', items97.map(i => ({ lp: i.lp, page: i.page, row: i.row, general: true }))),
    previousCandidatesAll: compare('previous_candidates_all', prev.map(p => ({ lp: p.localPath, page: p.page, row: p.logicalRowIndex, general: p.accountType === 'general' }))),
    previousCandidatesGeneral: compare('previous_candidates_general', prevGeneral.map(p => ({ lp: p.localPath, page: p.page, row: p.logicalRowIndex, general: true }))),
  };
  void need;
  const prevMof = readJson<{ generalAccount: { candidateRows: number; all: Record<string, number> } }>(`${FX}/budget-request-pdf-item-candidate-count/2024/mof-exact-name-diagnostic.json`).generalAccount;
  // old-only の理由: 既存 item 97 / previous candidates について、structural 条件のうち満たさないものを records から再判定
  const reasonOf = (rec: { recordKind: string; rowLocal: Record<string, { status: string; value: unknown }> }): string => {
    if (rec.recordKind === 'request') return 'request_shaped';
    const code = rec.rowLocal.code; const raw = (code.value as { raw: string } | null)?.raw ?? null;
    if (code.status !== 'resolved' || !raw || !/^\d{3}$/.test(raw)) return 'code_not_plain3';
    const ok = ['previousBudget', 'requestedBudget', 'difference'].some(k => rec.rowLocal[k].status === 'resolved' && rec.rowLocal[k].value != null);
    return ok ? 'structural_row_but_not_in_phaseA_universe' : 'no_amount_evidence';
  };
  const itemReasons: Record<string, number> = {};
  for (const i of items97) if (!candById.has(idOf(i.lp, i.page, i.row))) inc(itemReasons, reasonOf(i.rec as never));
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-rule-line-item-population-phaseB/v0',
    note: 'Phase A freeze 後の MOF diagnostic。MOF は candidate 生成・distance bucket・rule 選択に使っていない。recall ではなく distinct MOF item exact-overlap count / 784',
    frozen: Object.fromEntries(Object.keys(FROZEN).map(p => [p, fileSha(p)])), phaseAFreeze: freeze.artifacts,
    mof: { generalSections: secMap.size, distinctNormalizedNames: byName.size, distinctCodes: byCode.size },
    candidateClassCounts: clsCounts, generalCandidates: generalCands.length, specialCandidates: cands.length - generalCands.length,
    distinctMofExactOverlap: { anyUniqueOrAmbiguous: coveredAny.size, uniqueRowsOnly: coveredUnique.size, denominator: 784 },
    distanceByMof: tableOut, mofSideInventory: mofSide, mofSideRows: mofRows,
    secondary: { ...secondary, existingItem97NotInUniverseReasons: itemReasons, previousMofExactNameDiagnosticGeneral: prevMof },
  }), null, 1)}\n`;
  fs.writeFileSync(`${A}/phaseB-diagnostic.json`, text);
  const rowsGz = zlib.gzipSync(Buffer.from(results.map(r => JSON.stringify({ candidateId: r.c.candidateId, bucket01: bucketOf(r.c), class: r.cls, mofSectionIds: r.ids })).join('\n') + '\n', 'utf8'), { level: 9 });
  fs.writeFileSync(`${A}/phaseB-candidate-mof-status.jsonl.gz`, rowsGz);
  console.log(JSON.stringify({ sha: sha(text), rowsGz: sha(rowsGz), clsCounts, distinct: [coveredAny.size, coveredUnique.size], mofSide, table: tableOut.map(t => [t.bucket01, t.candidateRows, t.generalRows, t.codeNameExactRows, t.distinctMofItems]), secondary: Object.values(secondary).map(s => [s.name, s.oldTotal, s.both, s.oldOnly, s.newOnly]), itemReasons }, null, 1));
}
main();
