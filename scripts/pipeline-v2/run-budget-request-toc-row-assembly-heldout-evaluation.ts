/**
 * TOC A 層 row assembly の one-shot frozen held-out evaluation runner。
 *   --write-launch-manifest : evaluator の hash 等を固定する（parser は実行しない）
 *   --execute               : 23 held-out page 全件に parser を一度だけ実行し、評価する（formal execution count = 1）
 * evaluator は #391 / #392 / #393 / #395 の frozen artifact を消費するだけ。評価規則を独自に再定義しない。
 * 実行は一度きり: execution-started.json が存在すれば拒否する。失敗しても retry しない。
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { assembleTocPage, ruleConfigSha256, type PageOut, type TocPageInput } from './lib/budget-request-toc-row-assembly';
import { aggregate, evaluatePage, finalJudgment, type GtPage } from './lib/budget-request-toc-row-assembly-evaluator';

const ASM = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const PAR = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-parser', '2024');
const OUT = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-evaluation', '2024');
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const fileSha = (f: string) => sha256Hex(fs.readFileSync(f));
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

export const FROZEN = {
  preregistrationSha256: '0cfec657698f699bc3686a7944439db918e7515e439c74457d9c6458e6b42ac8',
  gtFreezeManifestSha256: 'ea924b89f3d5a140a9361b96544bfdbc33e7bea42966e3c39fda59bf98294949',
  groundTruthSha256: '2e18ecd39fc471256f1a2a70a4e75ad24e958ca4f82cfd233e958f2cdf7c4444',
  implementationFreezeManifestSha256: '9d5edca2f902779d18f7c95c3d48e8f4272ea92999f3140b564abb2cb52c05a0',
  parserSourceSha256: 'f3b726f8054340422eeb838187fed91b3435f7201dc39abfd4d40f382c9636dd',
  ruleConfigSha256: '6a0565e61162dd76c702ef0c997cb6f9aec79f1a6f17e9f2c872ecd2e5014251',
  amendmentSha256: '958985cc7d895071bb77ad6d57a45de0e82c65677ea45828fb3e916389933f00',
  stopArtifact394Sha256: 'bd85b5137de0643dc48f224c6bb7bdb8171d96b50de22ed32c8a14710c9bba54',
  membershipDigestSha256: '8fa5a8a8444be31a637fae618235b0a77c6b37745441edc06534fe63c5a44156',
  rawTextCorpusDigestSha256: '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052',
  pageClassificationCorpusDigestSha256: '39464fc76b1b83272d5852d3db1db776e22bb570ee0f6b7ca4d1da64de4a5ecc',
};
const EVALUATOR_FILES = [
  'scripts/pipeline-v2/lib/budget-request-toc-row-assembly-evaluator.ts',
  'scripts/pipeline-v2/lib/budget-request-toc-row-assembly-evaluator.test.ts',
  'scripts/pipeline-v2/run-budget-request-toc-row-assembly-heldout-evaluation.ts',
];
const COMMAND = 'npx tsx scripts/pipeline-v2/run-budget-request-toc-row-assembly-heldout-evaluation.ts --execute';

function verifyFrozen(): string[] {
  const bad: string[] = [];
  const chk = (name: string, actual: string, expected: string) => { if (actual !== expected) bad.push(`${name}: ${actual} != ${expected}`); };
  chk('preregistration', fileSha(path.join(ASM, 'preregistration.json')), FROZEN.preregistrationSha256);
  chk('gtFreezeManifest', fileSha(path.join(ASM, 'gt-freeze-manifest.json')), FROZEN.gtFreezeManifestSha256);
  chk('groundTruth', fileSha(path.join(ASM, 'ground-truth.json')), FROZEN.groundTruthSha256);
  chk('implementationFreezeManifest', fileSha(path.join(PAR, 'implementation-freeze-manifest.json')), FROZEN.implementationFreezeManifestSha256);
  chk('parserSource', fileSha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts'), FROZEN.parserSourceSha256);
  chk('ruleConfig', ruleConfigSha256(), FROZEN.ruleConfigSha256);
  chk('amendment', fileSha(path.join(ASM, 'evaluation-protocol-amendment.json')), FROZEN.amendmentSha256);
  chk('stopArtifact394', fileSha(path.join(ASM, 'evaluation-protocol-clarification.json')), FROZEN.stopArtifact394Sha256);
  const held = readJson<{ membershipDigestSha256: string; pages: unknown[]; byClassifierSource: { DIRECT: number; INHERITED: number } }>(path.join(ASM, 'heldout-candidates.json'));
  chk('membershipDigest', held.membershipDigestSha256, FROZEN.membershipDigestSha256);
  if (held.pages.length !== 23 || held.byClassifierSource.DIRECT !== 14 || held.byClassifierSource.INHERITED !== 9) bad.push('held-out population mismatch');
  const amendment = readJson<{ status: string }>(path.join(ASM, 'evaluation-protocol-amendment.json'));
  if (amendment.status !== 'EVALUATION_PROTOCOL_AMENDMENT_FROZEN') bad.push('amendment status');
  const impl = readJson<{ status: string }>(path.join(PAR, 'implementation-freeze-manifest.json'));
  if (impl.status !== 'IMPLEMENTATION_FROZEN') bad.push('implementation status');
  if (readJson<{ status: string }>(path.join(ASM, 'gt-freeze-manifest.json')).status !== 'GT_FROZEN') bad.push('GT status');
  const raw = readJson<{ frozenInput: { corpusDigestSha256: string } }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
  chk('rawTextDigest', raw.frozenInput.corpusDigestSha256, FROZEN.rawTextCorpusDigestSha256);
  return bad;
}

function writeLaunchManifest() {
  const bad = verifyFrozen();
  if (bad.length) throw new Error(`STOP_PROTOCOL: ${bad.join('; ')}`);
  if (fs.existsSync(path.join(OUT, 'execution-started.json')) || fs.existsSync(path.join(OUT, 'heldout-parser-output.json'))) throw new Error('STOP_PROTOCOL: held-out execution artifact already exists');
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {
    schema: 'budget-request-toc-row-assembly-evaluation-launch-manifest/v0',
    status: 'EVALUATOR_FROZEN_BEFORE_LAUNCH',
    createdAt: process.env.LAUNCH_CREATED_AT ?? new Date().toISOString(),
    baseMainSha: process.env.BASE_MAIN_SHA ?? null,
    evaluatorCommit: process.env.EVALUATOR_COMMIT ?? null,
    frozenDependencyHashes: FROZEN,
    evaluatorSha256: Object.fromEntries(EVALUATOR_FILES.map(f => [f, fileSha(f)])),
    evaluatorConfigSha256: null,
    executionCommand: COMMAND,
    formalExecutionCountBefore: 0,
    heldoutParserOutputPreexisting: false,
    protocolClaim: '23 held-out page 全件への一回限りの formal execution。評価中・評価後に parser / GT / preregistration / amendment / membership / matching rule / metric を変更しない。retry しない',
  };
  fs.writeFileSync(path.join(OUT, 'evaluation-launch-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(JSON.stringify({ launchManifestSha256: fileSha(path.join(OUT, 'evaluation-launch-manifest.json')) }));
}

function execute() {
  // ---- pre-launch checks（parser 実行前）----
  const bad = verifyFrozen();
  const lm = readJson<{ evaluatorSha256: Record<string, string>; formalExecutionCountBefore: number; frozenDependencyHashes: unknown }>(path.join(OUT, 'evaluation-launch-manifest.json'));
  for (const f of EVALUATOR_FILES) if (fileSha(f) !== lm.evaluatorSha256[f]) bad.push(`evaluator changed after freeze: ${f}`);
  if (lm.formalExecutionCountBefore !== 0) bad.push('execution count before != 0');
  for (const f of ['execution-started.json', 'heldout-parser-output.json', 'evaluation-result.json']) if (fs.existsSync(path.join(OUT, f))) bad.push(`pre-existing ${f}`);
  if (bad.length) throw new Error(`STOP_PROTOCOL (parser 未実行): ${bad.join('; ')}`);
  const launchManifestSha256 = fileSha(path.join(OUT, 'evaluation-launch-manifest.json'));
  const startedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'execution-started.json'), `${JSON.stringify({ startedAt, launchManifestSha256, formalExecutionCount: 1, note: 'このファイルが存在する限り再実行しない' }, null, 1)}\n`);

  try {
    // ---- formal execution（23 page 全件）----
    const held = readJson<{ pages: (TocPageInput & { selectionStratum: string[] })[] }>(path.join(ASM, 'heldout-candidates.json'));
    const rawManifest = readJson<{ documents: { localPdfPath: string; pdfSha256: string; artifactPath: string; pageTextSha256: string[] }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
    const docs = new Map(rawManifest.documents.map(d => [d.localPdfPath, d]));
    const cache = new Map<string, { text: string; textSha256: string; nonEmptyLines: { lineIndex: number; text: string }[] }[]>();
    const pageOf = (p: string, n: number) => { let r = cache.get(p); if (!r) { r = fs.readFileSync(path.join('data', 'work', 'budget-request-raw-text', '2024', docs.get(p)!.artifactPath), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); cache.set(p, r); } return r[n - 1]; };
    const outputs: PageOut[] = []; const raws: { pdfSha256: string; textSha256: string; lines: { lineIndex: number; text: string }[] }[] = [];
    for (const p of held.pages) {
      const rp = pageOf(p.localPdfPath, p.physicalPage);
      if (docs.get(p.localPdfPath)!.pdfSha256 !== p.pdfSha256 || rp.textSha256 !== p.textSha256) throw new Error(`STOP_PROTOCOL: page hash mismatch ${key(p)}`);
      const input: TocPageInput = { localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierSource: p.classifierSource, text: rp.text, nonEmptyLines: rp.nonEmptyLines };
      outputs.push(assembleTocPage(input));
      raws.push({ pdfSha256: p.pdfSha256, textSha256: p.textSha256, lines: rp.nonEmptyLines });
    }
    const outputText = `${JSON.stringify({ schema: 'budget-request-toc-row-assembly-heldout-parser-output/v0', note: '#393 frozen parser の raw output。加工しない', formalExecutionCount: 1, pages: outputs }, null, 1)}\n`;
    fs.writeFileSync(path.join(OUT, 'heldout-parser-output.json'), outputText);
    const parserOutputSha256 = sha256Hex(outputText);

    // ---- evaluation ----
    const gt = readJson<{ pages: GtPage[] }>(path.join(ASM, 'ground-truth.json'));
    const results = held.pages.map((p, i) => {
      const g = gt.pages.find(x => key(x) === key(p));
      if (!g) throw new Error(`STOP_PROTOCOL: GT page missing ${key(p)}`);
      return evaluatePage(g, outputs[i], raws[i], p.selectionStratum);
    });
    const agg = aggregate(results);
    const postBad = [...verifyFrozen(), ...EVALUATOR_FILES.filter(f => fileSha(f) !== lm.evaluatorSha256[f]).map(f => `evaluator changed: ${f}`)];
    const compliant = postBad.length === 0;
    const judgment = finalJudgment(compliant, agg.severe.total, agg.blockingUnresolved.count);
    const result = {
      schema: 'budget-request-toc-row-assembly-evaluation-result/v0',
      note: 'raw result（解釈を含まない）。評価後の追加解析・rule 変更・retry をしない',
      formalExecutionCount: 1, startedAt, completedAt: new Date().toISOString(),
      launchManifestSha256, parserOutputSha256,
      protocolCompliance: { frozenHashesMatched: compliant, mismatches: postBad, membershipUnchanged: true, retries: 0, candidateDropOrReplacement: 0, evaluatorChangedAfterLaunch: postBad.some(x => x.startsWith('evaluator')), compliant },
      summary: agg,
      pages: results,
      finalJudgment: judgment,
    };
    fs.writeFileSync(path.join(OUT, 'evaluation-result.json'), `${JSON.stringify(result, null, 1)}\n`);
    console.log(JSON.stringify({ finalJudgment: judgment, severeTotal: agg.severe.total, blockingUnresolved: agg.blockingUnresolved.count, parserOutputSha256, evaluationResultSha256: fileSha(path.join(OUT, 'evaluation-result.json')) }, null, 1));
  } catch (e) {
    fs.writeFileSync(path.join(OUT, 'execution-failure.json'), `${JSON.stringify({ failedAt: new Date().toISOString(), error: String(e), note: 'retry しない。STOP_PROTOCOL または実行障害として保存' }, null, 1)}\n`);
    throw e;
  }
}

if (process.argv.includes('--write-launch-manifest')) writeLaunchManifest();
else if (process.argv.includes('--execute')) execute();
else console.log('usage: --write-launch-manifest | --execute');
