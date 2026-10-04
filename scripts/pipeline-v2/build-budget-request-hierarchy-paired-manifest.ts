/**
 * hierarchy ON/OFF paired diagnostic の population manifest（Phase B）。paired の単位は、既存 hierarchy 契約を持つ PDF の hierarchy 区間（そのページ範囲）。
 * 分類規則は結果（OFF）を見る前に固定する（preregistration §B）。入力は凍結済みの corpus manifest と baseline の ON 側 artifact のみ。OFF は実行しない。
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-hierarchy-paired-manifest.ts
 * 出力: tests/fixtures/budget-request-hierarchy-failure-isolation/2024/paired-manifest.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { hierarchyContractFor, planCorpusDocument } from './lib/budget-request-corpus-plan';

const MANIFEST = path.join('tests', 'fixtures', 'budget-request-full-corpus-baseline', '2024', 'corpus-manifest.json');
const MANIFEST_SHA = '4a2a10ec46d75cf90d11b441a7a162654daefb008bb92edf3d264f8d118dde7a';
const WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const OUT = path.join('tests', 'fixtures', 'budget-request-hierarchy-failure-isolation', '2024', 'paired-manifest.json');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type PairedClass = 'paired_evaluable' | 'excluded_independent_hard_failure' | 'excluded_contract_mismatch' | 'excluded_other';
interface Seg { pages: [number, number]; mode: string; experimentId: string | null }
interface Doc { canonicalUrl: string; publisherAuthority: string; accountType: string; localPath: string; sha256: string; pages: number; state: string; plan: { segments: Seg[] } }
interface SegRes { pages: [number, number]; mode: string; status: string; summary: { pages: { attempted: number; processed: number }; stageCounts: { logicalRowCandidates: number }; records: number } | null; outputs: { records: { sha256: string } } | null }
interface DocRes { sha256: string; status: string; segments: SegRes[] }

/** 分類規則（事前固定。上から順に最初に当たったもの）。入力の欠落は fail-closed で excluded_other */
export function classify(doc: Doc, res: DocRes | null): { cls: PairedClass; reason: string } {
  const hier = doc.plan.segments.filter(s => s.mode === 'hierarchy_enabled');
  if (hier.length === 0) return { cls: 'excluded_contract_mismatch', reason: '凍結 manifest に hierarchy_enabled 区間が無い（hierarchy 契約なし。paired の対象外）' };
  const contract = hierarchyContractFor(doc.canonicalUrl);
  const replan = planCorpusDocument(doc.canonicalUrl, doc.pages, 'FOUND').segments.filter(s => s.mode === 'hierarchy_enabled');
  if (hier.length !== 1 || !contract || replan.length !== 1 || replan[0].experimentId !== hier[0].experimentId || replan[0].pages[0] !== hier[0].pages[0] || replan[0].pages[1] !== hier[0].pages[1] || contract.id !== hier[0].experimentId) {
    return { cls: 'excluded_contract_mismatch', reason: '凍結 manifest の hierarchy 区間が、既存 contract（A2 実験の view=detail 最広範囲）から再計算した区間と一致しない' };
  }
  if (!res) return { cls: 'excluded_other', reason: 'baseline の ON 側 artifact（result.json）が無い' };
  if (res.sha256 !== doc.sha256) return { cls: 'excluded_other', reason: 'baseline result の原本 hash が manifest と一致しない' };
  const hs = res.segments.find(s => s.mode === 'hierarchy_enabled' && s.pages[0] === hier[0].pages[0] && s.pages[1] === hier[0].pages[1]);
  if (!hs) return { cls: 'excluded_other', reason: 'baseline result に当該 hierarchy 区間が無い' };
  if (res.status === 'hard_failure' || hs.status === 'hard_failure') return { cls: 'excluded_independent_hard_failure', reason: 'baseline で SourceToken 前段などの独立した hard_failure（rotate=90 等）。hierarchy 仮説と独立の failure' };
  if (hs.status !== 'success' || !hs.summary || !hs.outputs) return { cls: 'excluded_other', reason: `hierarchy 区間の baseline status が success でない（${hs.status}）` };
  if (hs.summary.pages.processed !== hs.summary.pages.attempted || hs.summary.pages.attempted !== hier[0].pages[1] - hier[0].pages[0] + 1) return { cls: 'excluded_other', reason: 'hierarchy 区間のページ数が processed / attempted / 範囲で一致しない' };
  return { cls: 'paired_evaluable', reason: 'hierarchy 契約あり・baseline の ON 区間が success・同一ページ範囲を OFF（null hierarchy、既存の optional な入力）でも実行できる' };
}

function main() {
  const bytes = fs.readFileSync(MANIFEST);
  if (sha(bytes) !== MANIFEST_SHA) throw new Error('corpus manifest が frozen 値と一致しない（STOP）');
  const docs = (JSON.parse(bytes.toString('utf8')) as { documents: Doc[] }).documents;
  const rows = docs.filter(d => d.plan.segments.some(s => s.mode === 'hierarchy_enabled')).map(d => {
    const slug = d.localPath.replace(/^data\/download\//, '').replace(/[/]/g, '__');
    const f = path.join(WORK, slug, 'result.json');
    const res = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as DocRes) : null;
    const { cls, reason } = classify(d, res);
    const seg = d.plan.segments.find(s => s.mode === 'hierarchy_enabled')!;
    const hs = res?.segments.find(s => s.mode === 'hierarchy_enabled');
    return {
      localPath: d.localPath, canonicalUrl: d.canonicalUrl, sourceSha256: d.sha256, publisherAuthority: d.publisherAuthority, accountType: d.accountType, totalPages: d.pages,
      hierarchySegment: seg.pages, experimentId: seg.experimentId, class: cls, reason,
      pagesInSegment: seg.pages[1] - seg.pages[0] + 1, logicalRowCandidates: hs?.summary?.stageCounts.logicalRowCandidates ?? null, onRecords: hs?.summary?.records ?? null,
      baselineOnRecordsSha256: hs?.outputs?.records.sha256 ?? null,
    };
  }).sort((a, b) => cmp(a.localPath, b.localPath));
  const tally: Record<string, { pdfs: number; pages: number; logicalRows: number }> = {};
  for (const c of ['paired_evaluable', 'excluded_independent_hard_failure', 'excluded_contract_mismatch', 'excluded_other']) tally[c] = { pdfs: 0, pages: 0, logicalRows: 0 };
  for (const r of rows) { tally[r.class].pdfs++; tally[r.class].pages += r.pagesInSegment; tally[r.class].logicalRows += r.logicalRowCandidates ?? 0; }
  const out = {
    schema: 'budget-request-hierarchy-paired-manifest/v0',
    scope: 'hierarchy 契約を持つ PDF の hierarchy 区間。ON は baseline と同じ入力、OFF は同一ページ範囲を hierarchy=null（既存の optional な入力）で 1 区間として実行する',
    frozenCorpusManifestSha256: MANIFEST_SHA, corpusDocuments: docs.length,
    pairedUnit: '同一 PDF・同一ページ範囲・logical row（anchor = page + logicalRowIndex。上流 provenance。新しい ID は作らない）',
    classificationRules: ['hierarchy_enabled 区間が無い、または contract から再計算した区間と不一致 → excluded_contract_mismatch', 'baseline の ON artifact 欠落・原本 hash 不一致・区間欠落・ページ数不一致・status が失敗以外で success でない → excluded_other', 'baseline で hard_failure → excluded_independent_hard_failure', 'それ以外 → paired_evaluable'],
    summary: tally, documents: rows,
  };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log(JSON.stringify({ sha256: sha(text), summary: tally, docs: rows.map(r => [r.localPath.split('/').pop(), r.class, r.hierarchySegment.join('-'), r.logicalRowCandidates, r.onRecords]) }, null, 1));
}

if (process.argv[1]?.endsWith('build-budget-request-hierarchy-paired-manifest.ts')) main();
