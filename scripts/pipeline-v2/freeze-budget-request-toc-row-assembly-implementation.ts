/**
 * parser implementation freeze manifest を生成する（implementation commit・source hash・rule/config hash・frozen 入力の identity を固定）。
 * 使い方: IMPL_COMMIT=<sha> BASE_MAIN_SHA=<sha> npx tsx scripts/pipeline-v2/freeze-budget-request-toc-row-assembly-implementation.ts --freeze-fixture
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { ruleConfigSha256 } from './lib/budget-request-toc-row-assembly';

const ASM = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const OUT_DIR = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-parser', '2024');
const fileSha = (f: string) => sha256Hex(fs.readFileSync(f));
const gtm = JSON.parse(fs.readFileSync(path.join(ASM, 'gt-freeze-manifest.json'), 'utf8'));
const dev = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'development-regression.json'), 'utf8'));
if (!process.env.IMPL_COMMIT || !process.env.BASE_MAIN_SHA) throw new Error('IMPL_COMMIT / BASE_MAIN_SHA required');
const sources = ['scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts', 'scripts/pipeline-v2/lib/budget-request-toc-row-assembly.test.ts', 'scripts/pipeline-v2/run-budget-request-toc-row-assembly-development.ts'];
const manifest = {
  schema: 'budget-request-toc-row-assembly-implementation-freeze/v0',
  status: 'IMPLEMENTATION_FROZEN',
  createdAt: process.env.FREEZE_CREATED_AT ?? new Date().toISOString(),
  baseMainSha: process.env.BASE_MAIN_SHA,
  implementationCommit: process.env.IMPL_COMMIT,
  dependency: { pr391: 'preregistration', pr392: 'visual GT freeze（内容は未読）' },
  sourceSha256: Object.fromEntries(sources.map(s => [s, fileSha(s)])),
  ruleConfigSha256: ruleConfigSha256(),
  preregistrationSha256: fileSha(path.join(ASM, 'preregistration.json')),
  gtFreezeManifest: { path: path.join(ASM, 'gt-freeze-manifest.json'), sha256: fileSha(path.join(ASM, 'gt-freeze-manifest.json')), status: gtm.status, groundTruthSha256: gtm.sha256.groundTruth },
  membershipDigestSha256: gtm.membershipDigestSha256,
  developmentRegressionSha256: fileSha(path.join(OUT_DIR, 'development-regression.json')),
  developmentSummary: { pages: dev.developmentPages, heldoutPagesExecuted: dev.heldoutPagesExecuted, ...dev.summary },
  environment: { node: process.version, vitest: '4.1.10' },
  claimBoundary: '実装 freeze のみ。held-out 評価・accuracy・coverage・severe error は未実施。数値基準（UNRESOLVED_ACCEPTANCE_THRESHOLD）は未決。次 unit は本 implementation を変更せず frozen evaluation を行う',
  judgment: 'READY_FOR_TOC_ROW_ASSEMBLY_FROZEN_EVALUATION',
};
if (process.argv.includes('--freeze-fixture')) fs.writeFileSync(path.join(OUT_DIR, 'implementation-freeze-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(JSON.stringify({ implementationCommit: manifest.implementationCommit, ruleConfigSha256: manifest.ruleConfigSha256 }, null, 1));
