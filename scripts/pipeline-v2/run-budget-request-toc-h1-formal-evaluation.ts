/**
 * H1 の one-shot formal frozen evaluation runner（新 held-out 25 page）。
 *   --write-launch-manifest : evaluator 等の hash を固定（H1 は実行しない）
 *   --execute               : 25 page 全件に assembleTocPageH1 を一度だけ実行し、保存した出力を #395 の evaluator で評価する
 * 評価規則は #395 を機械化した budget-request-toc-row-assembly-evaluator.ts をそのまま使う（再定義しない）。execution-started.json があれば再実行を拒否する。失敗しても retry しない。
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { assembleTocPageH1 } from './lib/budget-request-toc-row-assembly-h1';
import { ruleConfigSha256, type PageOut, type TocPageInput } from './lib/budget-request-toc-row-assembly';
import { aggregate, evaluatePage, type GtPage } from './lib/budget-request-toc-row-assembly-evaluator';
import { h1FinalJudgment, h1TriggerCensus } from './lib/budget-request-toc-h1-formal-evaluation';

const H1D = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const ASM = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const OUT = path.join('tests', 'fixtures', 'budget-request-toc-h1-formal-evaluation', '2024');
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const fileSha = (f: string) => sha256Hex(fs.readFileSync(f));
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;

export const FROZEN = {
  h1SourceSha256: 'ea6af6debefc6c092c3725fc5e37f8ea7a53658fb24d876c2f725e33c6178343',
  membershipDigestSha256: '06c2e68d7ac178e7e0561d16976c47936ab9d52b59d91710cab145fa8822ab28',
  membershipFileSha256: '7c238b9b6c756ebc9baec46f47f33db1706fee8ca40d87b1eb6d87bcf6538d06',
  groundTruthSha256: '693ce90d0f289139d96771da1737c762a05c616c2a3afd8103a0f4979063705f',
  annotationLedgerSha256: '49d48e46ad2b1428ce5719e78fcdde4adb443c3f41283618523fb44d63d881f1',
  renderManifestSha256: '9ed0844b5a394472b96194e6a827ed0ea892f543ed358b1d173ed6d33ec0ec81',
  visualGtFreezeManifestSha256: 'c41b6b51202ba61a980197b02745c8f78c710acdcbf0081d4f02f6889ab6c1f0',
  implementationFreezeManifestSha256: 'ce80c5bb9c0e86a1cce278236afd86f34afe4615e90c5e8de17cf1582ec8f7cf',
  membershipFreezeManifestSha256: '635a236cce52cf8ec7a038c02f650713b84e6894146ca9385481e9605dd625b5',
  h1PreregistrationSha256: '0c3a377ba9d32ec55701f8d0982ff9a48e8cd9f16ba8c81927fcedffcdec1b27',
  parser393SourceSha256: 'f3b726f8054340422eeb838187fed91b3435f7201dc39abfd4d40f382c9636dd',
  amendment395Sha256: '958985cc7d895071bb77ad6d57a45de0e82c65677ea45828fb3e916389933f00',
  ruleConfigSha256: '6a0565e61162dd76c702ef0c997cb6f9aec79f1a6f17e9f2c872ecd2e5014251',
};
const EVALUATOR_FILES = [
  'scripts/pipeline-v2/lib/budget-request-toc-row-assembly-evaluator.ts',
  'scripts/pipeline-v2/lib/budget-request-toc-row-assembly-evaluator.test.ts',
  'scripts/pipeline-v2/lib/budget-request-toc-h1-formal-evaluation.ts',
  'scripts/pipeline-v2/lib/budget-request-toc-h1-formal-evaluation.test.ts',
  'scripts/pipeline-v2/run-budget-request-toc-h1-formal-evaluation.ts',
];
const COMMAND = 'npx tsx scripts/pipeline-v2/run-budget-request-toc-h1-formal-evaluation.ts --execute';

function verifyFrozen(): string[] {
  const bad: string[] = [];
  const chk = (n: string, a: string, e: string) => { if (a !== e) bad.push(`${n}: ${a} != ${e}`); };
  chk('h1Source', fileSha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts'), FROZEN.h1SourceSha256);
  chk('membershipFile', fileSha(path.join(H1D, 'new-heldout-membership.json')), FROZEN.membershipFileSha256);
  chk('groundTruth', fileSha(path.join(H1D, 'new-heldout-ground-truth.json')), FROZEN.groundTruthSha256);
  chk('ledger', fileSha(path.join(H1D, 'new-heldout-annotation-ledger.json')), FROZEN.annotationLedgerSha256);
  chk('renderManifest', fileSha(path.join(H1D, 'new-heldout-render-manifest.json')), FROZEN.renderManifestSha256);
  chk('visualGtFreezeManifest', fileSha(path.join(H1D, 'new-heldout-visual-gt-freeze-manifest.json')), FROZEN.visualGtFreezeManifestSha256);
  chk('implementationFreezeManifest', fileSha(path.join(H1D, 'implementation-freeze-manifest.json')), FROZEN.implementationFreezeManifestSha256);
  chk('membershipFreezeManifest', fileSha(path.join(H1D, 'new-heldout-membership-freeze-manifest.json')), FROZEN.membershipFreezeManifestSha256);
  chk('h1Prereg', fileSha(path.join(H1D, 'preregistration.json')), FROZEN.h1PreregistrationSha256);
  chk('parser393', fileSha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts'), FROZEN.parser393SourceSha256);
  chk('amendment395', fileSha(path.join(ASM, 'evaluation-protocol-amendment.json')), FROZEN.amendment395Sha256);
  chk('ruleConfig', ruleConfigSha256(), FROZEN.ruleConfigSha256);
  const mem = read<{ digestSha256: string; members: unknown[] }>(path.join(H1D, 'new-heldout-membership.json'));
  chk('membershipDigest', mem.digestSha256, FROZEN.membershipDigestSha256);
  if (mem.members.length !== 25) bad.push('membership count');
  const gm = read<{ status: string; hashes: Record<string, string>; firewall: Record<string, unknown> }>(path.join(H1D, 'new-heldout-visual-gt-freeze-manifest.json'));
  if (gm.status !== 'NEW_HELDOUT_VISUAL_GT_FROZEN') bad.push('GT status');
  chk('freezeManifest.groundTruth', gm.hashes.groundTruthSha256, FROZEN.groundTruthSha256);
  chk('freezeManifest.ledger', gm.hashes.annotationLedgerSha256, FROZEN.annotationLedgerSha256);
  chk('freezeManifest.render', gm.hashes.renderManifestSha256, FROZEN.renderManifestSha256);
  chk('freezeManifest.membership', gm.hashes.membershipFileSha256, FROZEN.membershipFileSha256);
  if (gm.firewall.h1ExecutionsOnNewHeldout !== 0 || gm.firewall.parser393ExecutionsOnNewHeldout !== 0 || gm.firewall.triggerCensus !== 0 || gm.firewall.parserOutputViewed !== false) bad.push('GT firewall');
  const ev = read<{ formalExecutionCount: number }>(path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-evaluation', '2024', 'evaluation-result.json'));
  if (ev.formalExecutionCount !== 1) bad.push('#396 execution count');
  return bad;
}

function writeLaunchManifest() {
  const bad = verifyFrozen();
  if (bad.length) throw new Error(`STOP_PROTOCOL: ${bad.join('; ')}`);
  if (fs.existsSync(path.join(OUT, 'execution-started.json')) || fs.existsSync(path.join(OUT, 'new-heldout-h1-output.json'))) throw new Error('STOP_PROTOCOL: execution artifact already exists');
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {
    schema: 'budget-request-toc-h1-formal-evaluation-launch-manifest/v0', status: 'EVALUATOR_FROZEN_BEFORE_LAUNCH',
    createdAt: process.env.LAUNCH_CREATED_AT ?? new Date().toISOString(), baseMainSha: process.env.BASE_MAIN_SHA ?? null, evaluatorCommit: process.env.EVALUATOR_COMMIT ?? null,
    frozenDependencyHashes: FROZEN, evaluatorSha256: Object.fromEntries(EVALUATOR_FILES.map(f => [f, fileSha(f)])),
    evaluationRules: '#395 を機械化した budget-request-toc-row-assembly-evaluator.ts を変更せず使用（#396 で使用したものと同一）',
    executionCommand: COMMAND, h1ExecutionsOnNewHeldoutBefore: 0, parser393ExecutionsOnNewHeldoutBefore: 0, triggerCensusBefore: 0,
    protocolClaim: '新 held-out 25 page への H1 formal execution は exactly once。実行後の出力を immutable に保存し SHA-256 固定。評価・集計は保存済み出力の read-only。H1 / GT / membership / 評価規則 / threshold を変更しない。retry しない',
  };
  fs.writeFileSync(path.join(OUT, 'evaluation-launch-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(JSON.stringify({ launchManifestSha256: fileSha(path.join(OUT, 'evaluation-launch-manifest.json')) }));
}

function execute() {
  const bad = verifyFrozen();
  const lm = read<{ evaluatorSha256: Record<string, string>; h1ExecutionsOnNewHeldoutBefore: number }>(path.join(OUT, 'evaluation-launch-manifest.json'));
  for (const f of EVALUATOR_FILES) if (fileSha(f) !== lm.evaluatorSha256[f]) bad.push(`evaluator changed after freeze: ${f}`);
  if (lm.h1ExecutionsOnNewHeldoutBefore !== 0) bad.push('execution count before != 0');
  for (const f of ['execution-started.json', 'new-heldout-h1-output.json', 'formal-evaluation-result.json']) if (fs.existsSync(path.join(OUT, f))) bad.push(`pre-existing ${f}`);
  if (bad.length) throw new Error(`STOP_PROTOCOL (H1 未実行): ${bad.join('; ')}`);
  const launchManifestSha256 = fileSha(path.join(OUT, 'evaluation-launch-manifest.json'));
  const startedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'execution-started.json'), `${JSON.stringify({ startedAt, launchManifestSha256, formalExecutionCount: 1, note: 'このファイルが存在する限り再実行しない' }, null, 1)}\n`);
  try {
    const mem = read<{ members: { localPdfPath: string; physicalPage: number; classifierSource: 'DIRECT' | 'INHERITED' }[] }>(path.join(H1D, 'new-heldout-membership.json'));
    const rawManifest = read<{ documents: { localPdfPath: string; pdfSha256: string; artifactPath: string; pageTextSha256: string[] }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
    const docs = new Map(rawManifest.documents.map(d => [d.localPdfPath, d]));
    const cache = new Map<string, { text: string; textSha256: string; nonEmptyLines: { lineIndex: number; text: string }[] }[]>();
    const pageOf = (p: string, n: number) => { let r = cache.get(p); if (!r) { r = fs.readFileSync(path.join('data', 'work', 'budget-request-raw-text', '2024', docs.get(p)!.artifactPath), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); cache.set(p, r); } return r[n - 1]; };
    const inputs: TocPageInput[] = mem.members.map(m => {
      const d = docs.get(m.localPdfPath)!; const rp = pageOf(m.localPdfPath, m.physicalPage);
      if (rp.textSha256 !== d.pageTextSha256[m.physicalPage - 1]) throw new Error(`STOP_PROTOCOL: text hash mismatch ${key(m)}`);
      return { localPdfPath: m.localPdfPath, pdfSha256: d.pdfSha256, physicalPage: m.physicalPage, textSha256: rp.textSha256, classifierSource: m.classifierSource, text: rp.text, nonEmptyLines: rp.nonEmptyLines };
    });
    // ---- formal execution（25 page 全件・一度だけ）----
    const outputs: PageOut[] = inputs.map(i => assembleTocPageH1(i));
    const outputText = `${JSON.stringify({ schema: 'budget-request-toc-h1-new-heldout-h1-output/v0', note: 'H1（#399 / #400 frozen）の raw output。加工しない', formalExecutionCount: 1, pages: outputs }, null, 1)}\n`;
    fs.writeFileSync(path.join(OUT, 'new-heldout-h1-output.json'), outputText);
    const h1OutputSha256 = sha256Hex(outputText);
    // ---- 以後は保存済み出力のみ read-only ----
    const saved = (JSON.parse(fs.readFileSync(path.join(OUT, 'new-heldout-h1-output.json'), 'utf8')) as { pages: PageOut[] }).pages;
    const gt = read<{ pages: GtPage[] }>(path.join(H1D, 'new-heldout-ground-truth.json'));
    const results = inputs.map((inp, i) => {
      const g = gt.pages.find(x => key(x) === key(inp));
      if (!g) throw new Error(`STOP_PROTOCOL: GT page missing ${key(inp)}`);
      return evaluatePage(g, saved[i], { pdfSha256: inp.pdfSha256, textSha256: inp.textSha256, lines: inp.nonEmptyLines }, []);
    });
    const agg = aggregate(results);
    // ---- H1 trigger 集計（formal output 生成後に初めて）----
    const censusPages = inputs.map((inp, i) => ({ localPdfPath: inp.localPdfPath, physicalPage: inp.physicalPage, ...h1TriggerCensus(inp.nonEmptyLines, saved[i]) }));
    const trig = { positiveTriggerLines: censusPages.reduce((a, c) => a + c.triggerLines.length, 0), positiveTriggerPages: censusPages.filter(c => c.triggerLines.length > 0).length, splitLines: censusPages.reduce((a, c) => a + c.splitLines.length, 0), tokenTypes: { REQUEST: censusPages.reduce((a, c) => a + c.tokenTypes.REQUEST, 0), MARKER: censusPages.reduce((a, c) => a + c.tokenTypes.MARKER, 0), OTHER_CODE: censusPages.reduce((a, c) => a + c.tokenTypes.OTHER_CODE, 0) }, negativeControlLines: censusPages.reduce((a, c) => a + c.negativeControlLines.length, 0), byPage: censusPages.filter(c => c.triggerLines.length > 0 || c.splitLines.length > 0).map(c => ({ localPdfPath: c.localPdfPath, physicalPage: c.physicalPage, triggerLines: c.triggerLines, splitLines: c.splitLines })) };
    const postBad = [...verifyFrozen(), ...EVALUATOR_FILES.filter(f => fileSha(f) !== lm.evaluatorSha256[f]).map(f => `evaluator changed: ${f}`)];
    const compliant = postBad.length === 0;
    const judgment = h1FinalJudgment(compliant, agg.severe.total, trig.positiveTriggerLines, agg.blockingUnresolved.count);
    const result = {
      schema: 'budget-request-toc-h1-formal-evaluation-result/v0',
      note: 'raw result（解釈を含まない）。評価後の追加解析・rule 変更・retry をしない。#396 は旧 parser・別 population であり paired comparison ではない',
      formalExecutionCount: 1, startedAt, completedAt: new Date().toISOString(), launchManifestSha256, h1OutputSha256,
      protocolCompliance: { frozenHashesMatched: compliant, mismatches: postBad, retries: 0, candidateDropOrReplacement: 0, evaluatorChangedAfterLaunch: postBad.some(x => x.startsWith('evaluator')), compliant },
      h1Trigger: trig, summary: agg, pages: results, finalJudgment: judgment,
    };
    fs.writeFileSync(path.join(OUT, 'formal-evaluation-result.json'), `${JSON.stringify(result, null, 1)}\n`);
    console.log(JSON.stringify({ finalJudgment: judgment, severeTotal: agg.severe.total, positiveTriggerLines: trig.positiveTriggerLines, positiveTriggerPages: trig.positiveTriggerPages, blockingUnresolved: agg.blockingUnresolved.count, h1OutputSha256, resultSha256: fileSha(path.join(OUT, 'formal-evaluation-result.json')) }, null, 1));
  } catch (e) {
    fs.writeFileSync(path.join(OUT, 'execution-failure.json'), `${JSON.stringify({ failedAt: new Date().toISOString(), error: String(e), note: 'retry しない。STOP_PROTOCOL または実行障害として保存' }, null, 1)}\n`);
    throw e;
  }
}

if (process.argv.includes('--write-launch-manifest')) writeLaunchManifest();
else if (process.argv.includes('--execute')) execute();
else console.log('usage: --write-launch-manifest | --execute');
