/**
 * H1 independent human validation — HV-P0/P1: frozen P3 guard-fire population 65 unit（H = L27 ∪ U38 = F）の blind worklist を作る。
 * 入力は凍結済み artifact のみ（PDF 本文の解析・resolver 再推論なし）。PDF は filename・hash・page count の inventory だけに触れる。
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-h1-human-validation-worklist.ts
 * 出力: h1-human-validation-worklist.json（human-facing・label なし）/ h1-human-validation-provenance.json（machine 用）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { listExtractionTargets } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const OUT_WL = path.join(DIR, 'h1-human-validation-worklist.json');
const OUT_PROV = path.join(DIR, 'h1-human-validation-provenance.json');
const P4_SHA = '015ded4173b3f03b6fb69d43053c447d10f79b5219490fa395fe5cca3ee3e767';
const sha256 = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const stop = (m: string) => { console.error(`STOP: ${m}`); process.exitCode = 1; };
interface Loc { unitId: string; canonicalUrl: string; physicalPage: number; code: string; anchorYPt: [number, number] }

function main() {
  const p4Path = path.join(DIR, 'h1-scope-completion-p4-evaluation.json');
  if (sha256(p4Path) !== P4_SHA) return stop('P4 evaluation hash 不一致');
  const p4 = readJson<{ primary: { populationSize: number; N_complete: number; N_incomplete: number; N_unclear: number }; secondary: { frozenGuardFirePopulationSize: number; complete_total: number; incomplete_total: number; unclear_total: number } }>(p4Path);
  // 対象定義の確認のみ。結果は worklist に書かない
  if (p4.primary.populationSize !== 38 || p4.primary.N_complete !== 0 || p4.primary.N_incomplete !== 38 || p4.primary.N_unclear !== 0 || p4.secondary.frozenGuardFirePopulationSize !== 65 || p4.secondary.complete_total !== 0 || p4.secondary.incomplete_total !== 65 || p4.secondary.unclear_total !== 0) return stop('P4 result が報告値と一致しない');

  const p3Path = path.join(DIR, 'p3-evaluation.json'), gtwlPath = path.join(DIR, 'gt-worklist.json'), h1wlPath = path.join(DIR, 'h1-scope-completion-worklist.json');
  const p3 = readJson<{ units: { unitId: string; guardFired: boolean }[]; differential: { fired: number } }>(p3Path);
  const l27ids = p3.units.filter(u => u.guardFired).map(u => u.unitId);
  const gtLoc = new Map(readJson<{ units: Loc[] }>(gtwlPath).units.map(u => [u.unitId, u]));
  const u38 = readJson<{ units: Loc[] }>(h1wlPath).units;
  const l27 = l27ids.map(id => gtLoc.get(id));
  if (l27.some(x => !x)) return stop('L27 の locator を既存 gt-worklist から canonical unitId で引けない');
  const all = [...(l27 as Loc[]), ...u38];
  const ids = all.map(u => u.unitId);
  const dups = ids.length - new Set(ids).size;
  const inter = l27ids.filter(i => u38.some(u => u.unitId === i));
  if (l27ids.length !== 27 || u38.length !== 38 || ids.length !== 65 || dups || inter.length || p3.differential.fired !== 65) return stop(`集合 invariant 不成立（L27=${l27ids.length}, U38=${u38.length}, H=${ids.length}, dup=${dups}, inter=${inter.length}, F=${p3.differential.fired}）`);

  const units = all.map(u => ({ unitId: u.unitId, documentKey: u.unitId.split(':')[0], canonicalUrl: u.canonicalUrl, physicalPage: u.physicalPage, code: u.code, anchorYPt: u.anchorYPt }))
    .sort((a, b) => (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));

  const targets = listExtractionTargets(getBudgetRequestManifest(2024));
  const sources = [...new Set(units.map(u => u.canonicalUrl))].sort().map(url => {
    const t = targets.filter(x => x.canonicalUrl === url);
    if (t.length !== 1 || !fs.existsSync(t[0].localPath)) throw new Error(`source PDF を一意に特定できない: ${url}`);
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [t[0].localPath], { encoding: 'utf8' }))?.[1]);
    return { canonicalUrl: url, localPath: t[0].localPath, sha256: sha256(t[0].localPath), pageCount: pages, unitCount: units.filter(u => u.canonicalUrl === url).length };
  });
  if (sources.reduce((s, x) => s + x.unitCount, 0) !== 65) return stop('source inventory が 65 unit を覆わない');

  const wl = {
    schema: 'budget-request-incomplete-name-guard-h1-human-validation-worklist/v0',
    purpose: '凍結済み 65 unit を、事前登録された visual-only 3 ラベル規則で独立に分類する（locator と原本 PDF のみを使う）',
    populationSize: 65,
    canonicalOrdering: 'unitId の辞書順（昇順・内容に依存しない）',
    sources, units,
  };
  nodeBudgetRequestFs.writeAtomic(OUT_WL, Buffer.from(`${JSON.stringify(wl, null, 2)}\n`, 'utf8'));
  const prov = {
    schema: 'budget-request-incomplete-name-guard-h1-human-validation-provenance/v0',
    researchPurpose: 'independent human validation of frozen AI Visual GT',
    populationDefinition: 'complete frozen #367 P3 guard-fire population', populationSize: 65,
    derivation: 'H = L27 ∪ U38 = F（L27 = P3 評価で guard 発火した labeled unit、U38 = H1 worklist）。identity は unitId の完全一致のみ',
    sourceCommits: { p3Freeze: '587a477', h1Worklist: 'caefc6206f85bf9217b307797ea7ae01b7c83bd3', h1Preregistration: '4ad66c4bbb915d5d8385d02a61702d5ad0b812df', h1Supplement: '2e7656e0e822b14083c3ac8165d151b8e6de8fcc', h1AiGtFreeze: '3d00e16c9da64b79ddf6a4f0304972f1cde6a358', h1P4ResultFreeze: 'b8c71b2743d22b36c4476121e7db91788f2acfc6' },
    sourceArtifacts: Object.fromEntries([['p3Evaluation', p3Path], ['gtWorklist', gtwlPath], ['h1Worklist', h1wlPath], ['h1P4Evaluation', p4Path]].map(([k, p]) => [k, { path: p, sha256: sha256(p) }])),
    canonicalIdentityRule: 'unitId = documentKey:page:logicalRowIndex の完全一致（名称・code・目視による照合は禁止）',
    canonicalOrderingRule: 'unitId の辞書順',
    excludedAnchoringFields: ['AI label', 'existing visual GT label', 'H1 visual GT label', 'baselineName', 'baselineValue', 'guard output', 'predicate values', 'reasonCode', 'continuation candidate', 'stratum', 'knownFailure', 'agreement', 'machine prediction'],
    humanFacingWorklist: { path: OUT_WL, sha256: sha256(OUT_WL) },
  };
  nodeBudgetRequestFs.writeAtomic(OUT_PROV, Buffer.from(`${JSON.stringify(prov, null, 2)}\n`, 'utf8'));
  console.log(JSON.stringify({ F: 65, L27: 27, U38: 38, H: 65, sources: sources.map(s => [s.canonicalUrl, s.unitCount, s.pageCount]) }));
  console.log(`worklist sha256=${sha256(OUT_WL)} provenance sha256=${sha256(OUT_PROV)}`);
}

main();
