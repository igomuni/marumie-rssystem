/**
 * 任意の診断（候補件数の freeze 後のみ）: 一般会計の item-shaped 候補名と MOF section 名の名称単独 exact 一致（P1 と同じ normalizeKey）。
 * 組織を安全に得られないため diagnostic only。MOF の一致有無で候補を増減しない。fuzzy・substring は使わない。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-item-candidate-mof-name-diagnostic.ts
 * 出力: tests/fixtures/budget-request-pdf-item-candidate-count/2024/mof-exact-name-diagnostic.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { readJsonl } from './lib/jsonl';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import type { MofBudgetJikouRecord } from './types';

const DIR = path.join('tests', 'fixtures', 'budget-request-pdf-item-candidate-count', '2024');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

interface Cand { localPath: string; accountType: string; nameRaw: string | null; key: string | null }
const countBytes = fs.readFileSync(path.join(DIR, 'candidate-count.json'));
const CANDIDATE_COUNT_SHA = '35ffc096496ff9af7ab62ac5848b2ddef19ae0211f441193bf05598e7990d508';
if (sha(countBytes) !== CANDIDATE_COUNT_SHA) throw new Error('candidate-count.json が freeze 値と一致しない（STOP）');
const count = JSON.parse(countBytes.toString('utf8')) as { candidates: Cand[]; perPdf: { localPath: string; group: string }[] };
const groupOf = new Map(count.perPdf.map(p => [p.localPath, p.group]));
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const jikouSha = sha(fs.readFileSync(JIKOU));
if (jikouSha !== (JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'mof-jikou-normalized', '2024', '202411001-integration-evaluation.json'), 'utf8')) as { output: { sha256: string } }).output.sha256) throw new Error('budget-jikou.jsonl が #371 の記録と一致しない（STOP）');

const sections = new Map<string, { id: string; name: string }>();
for (const j of readJsonl<MofBudgetJikouRecord>(JIKOU)) if (!sections.has(j.parentSectionId)) sections.set(j.parentSectionId, { id: j.parentSectionId, name: j.sectionName });
const byName = new Map<string, Set<string>>();
for (const s of sections.values()) { const k = normalizeKey(s.name); if (!byName.has(k)) byName.set(k, new Set()); byName.get(k)!.add(s.id); }

const tally = (rows: Cand[]) => {
  const o: Record<string, number> = { rowsWithName: 0, unique_exact_name: 0, ambiguous_exact_name: 0, no_exact_name: 0 };
  for (const c of rows) { if (!c.nameRaw) continue; o.rowsWithName++; const m = byName.get(normalizeKey(c.nameRaw)); inc(o, !m ? 'no_exact_name' : m.size === 1 ? 'unique_exact_name' : 'ambiguous_exact_name'); }
  o.no_exact_name ??= 0;
  return o;
};
const gen = count.candidates.filter(c => c.accountType === 'general');
const result = {
  schema: 'budget-request-item-candidate-mof-exact-name-diagnostic/v0',
  scope: 'diagnostic only。名称単独 exact（組織なし）。候補の増減・正式照合には使わない',
  frozen: { candidateCountSha256: CANDIDATE_COUNT_SHA, mofJikouSha256: jikouSha }, mofSections: sections.size, mofDistinctNormalizedSectionNames: byName.size,
  generalAccount: { candidateRows: gen.length, all: tally(gen), hierarchyContractPdfs: tally(gen.filter(c => groupOf.get(c.localPath) === 'hierarchy_contract_pdf')), hierarchyLessPdfs: tally(gen.filter(c => groupOf.get(c.localPath) === 'hierarchy_less_pdf')) },
  referenceFormalReconciliation: { note: 'baseline の正式照合（hierarchy 付き population、組織 + 項名）', itemsComparable: 79, exactUnique: 77 },
};
const text = `${JSON.stringify(result, null, 2)}\n`;
fs.writeFileSync(path.join(DIR, 'mof-exact-name-diagnostic.json'), text);
console.log(JSON.stringify({ sha256: sha(text), ...result }, null, 1));
