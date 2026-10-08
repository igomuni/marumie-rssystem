/**
 * H1 implementation freeze manifest を生成する（H1 source は変更しない。hash を固定するだけ）。
 * 使い方: BASE_MAIN_SHA=<sha> FREEZE_CREATED_AT=<iso> npx tsx scripts/pipeline-v2/freeze-budget-request-toc-h1-implementation.ts --freeze-fixture
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import * as h1 from './lib/budget-request-toc-row-assembly-h1';

const H1D = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const sha = (f: string) => sha256Hex(fs.readFileSync(f));
const EXPECT = { h1Source: 'ea6af6debefc6c092c3725fc5e37f8ea7a53658fb24d876c2f725e33c6178343', prereg: '0c3a377ba9d32ec55701f8d0982ff9a48e8cd9f16ba8c81927fcedffcdec1b27', parser393: 'f3b726f8054340422eeb838187fed91b3435f7201dc39abfd4d40f382c9636dd' };
if (sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts') !== EXPECT.h1Source) throw new Error('STOP_FROZEN_ARTIFACT_INTEGRITY: H1 source');
if (sha(path.join(H1D, 'preregistration.json')) !== EXPECT.prereg) throw new Error('STOP_FROZEN_ARTIFACT_INTEGRITY: H1 prereg');
if (sha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts') !== EXPECT.parser393) throw new Error('STOP_FROZEN_ARTIFACT_INTEGRITY: #393 source');
if (typeof h1.assembleTocPageH1 !== 'function') throw new Error('STOP_H1_IMPLEMENTATION_NOT_FREEZABLE: entry point');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { devDependencies: Record<string, string>; dependencies?: Record<string, string> };
const dev = JSON.parse(fs.readFileSync(path.join(H1D, 'development-result.json'), 'utf8'));
const files = ['scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.test.ts', 'scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1-differential.ts', 'scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1-development-result.test.ts', 'scripts/pipeline-v2/run-budget-request-toc-header-zone-h1-development.ts', 'scripts/pipeline-v2/build-budget-request-toc-header-zone-h1-synthetic.ts'];
const manifest = {
  schema: 'budget-request-toc-row-assembly-h1-implementation-freeze/v0',
  status: 'H1_IMPLEMENTATION_FROZEN',
  createdAt: process.env.FREEZE_CREATED_AT ?? new Date().toISOString(),
  baseMainSha: process.env.BASE_MAIN_SHA ?? null,
  implementationMergedInCommit: '1dab76b5aa5fae3453744936491ac2e4864f978f',
  freezeCommit: 'この manifest を追加する git commit（自己参照を避けるため hash は本文に埋め込まない）',
  h1: { sourcePath: 'scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts', sourceSha256: EXPECT.h1Source, entryPoint: 'assembleTocPageH1', changedAfterDevelopmentEvaluation: false },
  dependencies: {
    h1PreregistrationSha256: EXPECT.prereg, parser393SourceSha256: EXPECT.parser393,
    preregistration391Sha256: '0cfec657698f699bc3686a7944439db918e7515e439c74457d9c6458e6b42ac8', amendment395Sha256: '958985cc7d895071bb77ad6d57a45de0e82c65677ea45828fb3e916389933f00',
    evaluationResult396Sha256: 'fcb1e40cc25969748516c4bbe1673d15418051a5d01d912310118abba4d05f66', heldoutParserOutput396Sha256: 'd95abb76ea63e660189167d6d8d6f8f34e9234cb879be18854b44c8b375b6f6b',
    isolationObservations397Sha256: 'ec58bbb2564a5068d9feb21044f5097dfc6c88bcdb63de828ef5a9da6ebe27ad', isolationFamilies397Sha256: '000857fad4f2ef1328b037ac2e73d7b72c5b839cb67815c236344dd9d87782b5',
  },
  developmentArtifacts: { resultSha256: sha(path.join(H1D, 'development-result.json')), syntheticSha256: sha(path.join(H1D, 'development-synthetic.json')), differentialSha256: sha(path.join(H1D, 'development-differential.json')) },
  developmentJudgment: dev.judgment,
  developmentSummary: { pages: dev.population.developmentPages, triggerLines: dev.census.triggerLines, triggerPages: dev.census.triggerPages, falsification: dev.falsification, devSyntheticOnly: dev.devSyntheticOnly },
  fileSha256: Object.fromEntries(files.map(f => [f, sha(f)])),
  runtime: { node: process.version, vitest: pkg.devDependencies.vitest, typescript: pkg.devDependencies.typescript, tsx: pkg.devDependencies.tsx ?? pkg.dependencies?.tsx ?? null },
  heldoutExecutions: { total396Only: 1, h1On396Heldout23: 0, h1OnNewHeldout: 0 },
  claimBoundary: 'H1 の implementation identity を固定しただけ。H1 の安全性・有効性は新 held-out の formal evaluation まで主張しない。#396 の severe が直るかは未確認',
};
if (process.argv.includes('--freeze-fixture')) fs.writeFileSync(path.join(H1D, 'implementation-freeze-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(JSON.stringify({ status: manifest.status, h1Source: manifest.h1.sourceSha256 }));
