/**
 * MOF XML 事項 parser v0 — first full frozen evaluation（implementation freeze 後に実行）。
 * raw frozen XML → frozen production parser → actual → frozen reference projection → exact comparison。
 * preregistration（commit 2305be0）の判定規則を機械的に適用する。parser・oracle は変更しない。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-mof-budget-xml-items-v0.ts
 * 出力: tests/fixtures/mof-budget-xml-parser-v0/2024/202411001-frozen-evaluation-hardened.json（初回評価の 202411001-frozen-evaluation.json は保持）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { checkSourceSetCompleteness, failClosedTestsPassed, type VitestSummary } from './lib/mof-budget-xml-items-evaluation-rules';
import { MofXmlParseError, parseMofBudgetXmlItemFile, readMenuAncestorChains, MOF_ITEM_PARSER_V0_DOCUMENT_ID, type MofXmlItemRecord, type ParseOutcome } from './lib/mof-budget-xml-items';

const XML_DIR = path.join('data', 'download', 'mof.go.jp', 'archive', '2024', '2024', 'xml');
const MENU = path.join('data', 'download', 'mof.go.jp', 'archive', '2024', '2024', 'html', '202411001menu.html');
const DIR = path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024');
/** 初回評価の artifact（保持）。厳密化した evaluator の再実行は別 file に保存する */
const FIRST_RUN = path.join(DIR, '202411001-frozen-evaluation.json');
const OUT = path.join(DIR, '202411001-frozen-evaluation-hardened.json');
const FAIL_CLOSED_TESTS = 'scripts/pipeline-v2/lib/mof-budget-xml-items.test.ts';
const FAIL_CLOSED_MIN_TESTS = 44;
const FROZEN: Record<string, string> = {
  [path.join(DIR, '202411001-source-set.json')]: '62df90fb32caf5997ecb2772eb0c84da66789b635eb1bc024743cf6a8da2afe3',
  [path.join(DIR, '202411001-reference-projection.json')]: 'e6335aceb0c7d69888206cada038dcb03db5e25f7c2a10a8d5ae6104c2d615d9',
  [path.join(DIR, '202411001-hand-checked-fixture.json')]: '664f0fbee2470311831db9dfbe53cd6e315a0e1f549767612d159b862d408fd1',
  'scripts/pipeline-v2/lib/mof-budget-xml-items.ts': '1d52634ba40bcfabd6fcdae477417daaf309ce8f2c8decf3c9ca251e6e041a79',
  'scripts/pipeline-v2/lib/mof-budget-xml-items.test.ts': 'c65006546cc9bbdbc14b07a3c6c492fb109052a00a1a1c37873d55ad09db316a',
};
const IMPLEMENTATION_COMMIT = 'b890e748462ac126f784576227351df1da2a65af';
const PREREGISTRATION_COMMIT = '2305be0ef217e76af484b646c732c6ce3578a7fd';
const sha = (b: Buffer | Uint8Array | string) => crypto.createHash('sha256').update(b).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface RefRec extends MofXmlItemRecord { }
async function main() {
  // 凍結入力の integrity（不一致なら INCONCLUSIVE 扱いで評価しない）
  const hashChecks = Object.entries(FROZEN).map(([p, h]) => ({ path: p, expected: h, actual: sha(fs.readFileSync(p)), match: sha(fs.readFileSync(p)) === h }));
  if (hashChecks.some(h => !h.match)) { console.error('INCONCLUSIVE: frozen artifact の hash 不一致', hashChecks.filter(h => !h.match)); process.exitCode = 1; return; }

  const set = JSON.parse(fs.readFileSync(path.join(DIR, '202411001-source-set.json'), 'utf8')) as { targets: { file: string; sha256: string; fingerprint: string; itemStartRows: number; requestRows: number; subtotalRows: number; descriptionOnlyRows: number }[]; nonTargets: { file: string; sha256: string }[]; expected: Record<string, number> };
  const ref = (JSON.parse(fs.readFileSync(path.join(DIR, '202411001-reference-projection.json'), 'utf8')) as { records: RefRec[] }).records;
  const sourceSet = new Map<string, string>([...set.targets, ...set.nonTargets].map(t => [t.file, t.sha256]));
  const targetFiles = new Set(set.targets.map(t => t.file));
  const chains = readMenuAncestorChains(new TextDecoder('euc-jp', { fatal: true }).decode(fs.readFileSync(MENU)));
  const files = fs.readdirSync(XML_DIR).filter(f => f.endsWith('.xml')).sort(cmp);

  // ---- preregistration §16 の機械適用に必要な追加確認 ----
  const completeness = checkSourceSetCompleteness(files, set.targets.map(t => t.file), set.nonTargets.map(t => t.file));
  const vt = spawnSync('npx', ['vitest', 'run', FAIL_CLOSED_TESTS, '--reporter=json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const jsonStart = vt.stdout.indexOf('{');
  const vitestSummary = (jsonStart >= 0 ? JSON.parse(vt.stdout.slice(jsonStart)) : { numTotalTests: 0, numPassedTests: 0, numFailedTests: 1 }) as VitestSummary;

  // ---- 全 328 XML を frozen parser に通す ----
  const outcomes = new Map<string, ParseOutcome>();
  const failures: { file: string; code: string; message: string }[] = [];
  for (const f of files) {
    try {
      outcomes.set(f, parseMofBudgetXmlItemFile({ filename: f, bytes: fs.readFileSync(path.join(XML_DIR, f)), documentId: MOF_ITEM_PARSER_V0_DOCUMENT_ID, menuChain: chains.get(f), sourceSet }));
    } catch (e) {
      if (!(e instanceof MofXmlParseError)) throw e;
      failures.push({ file: f, code: e.code, message: e.message });
    }
  }
  const status = (s: string) => files.filter(f => outcomes.get(f)?.status === s);
  const recognized = status('recognized');
  const notTarget = status('not_target');
  const unsupported = status('unsupported');
  const structural = {
    xmlFiles: files.length,
    expectedTargetFiles: set.targets.length, expectedNonTargetFiles: set.nonTargets.length,
    recognizedTargetFiles: recognized.filter(f => targetFiles.has(f)).length,
    targetFilesNotRecognized: set.targets.filter(t => outcomes.get(t.file)?.status !== 'recognized').map(t => t.file),
    nonTargetFilesCorrectlyNotTarget: notTarget.filter(f => !targetFiles.has(f)).length,
    nonTargetFilesMisclassified: files.filter(f => !targetFiles.has(f) && outcomes.get(f)?.status !== 'not_target'),
    recognizedButNotTarget: recognized.filter(f => !targetFiles.has(f)),
    structuralFailures: failures.length, failures,
    unsupported: unsupported.length,
    unexpectedSilentSkip: files.length - (outcomes.size + failures.length),
  };

  // ---- coverage ----
  const actual: MofXmlItemRecord[] = recognized.flatMap(f => (outcomes.get(f) as Extract<ParseOutcome, { status: 'recognized' }>).records);
  const key = (r: { file: string; row: string }) => `${r.file}#${r.row}`;
  const refKeys = new Map<string, RefRec>();
  const refDup: string[] = [];
  for (const r of ref) { if (refKeys.has(key(r))) refDup.push(key(r)); refKeys.set(key(r), r); }
  const actKeys = new Map<string, MofXmlItemRecord>();
  const actDup: string[] = [];
  for (const r of actual) { if (actKeys.has(key(r))) actDup.push(key(r)); actKeys.set(key(r), r); }
  const missing = [...refKeys.keys()].filter(k => !actKeys.has(k));
  const extra = [...actKeys.keys()].filter(k => !refKeys.has(k));
  const coverage = { expected: ref.length, actual: actual.length, missing: missing.length, extra: extra.length, duplicate: actDup.length, missingKeys: missing, extraKeys: extra, duplicateKeys: actDup };

  // ---- field exactness（対応する record 同士） ----
  const fields: Record<string, (a: MofXmlItemRecord) => unknown> = {
    organization: a => a.organization, itemCode: a => a.itemCode, itemName: a => a.itemName, itemNameLines: a => a.itemNameLines,
    requestName: a => a.requestName, requestNameLines: a => a.requestNameLines,
    'amountsRaw.col6': a => a.amountsRaw.col6, 'amountsRaw.col8': a => a.amountsRaw.col8, 'amountsRaw.col10': a => a.amountsRaw.col10,
    'amountsThousandYen.col6': a => a.amountsThousandYen.col6, 'amountsThousandYen.col8': a => a.amountsThousandYen.col8, 'amountsThousandYen.col10': a => a.amountsThousandYen.col10,
    col4Raw: a => a.col4Raw, itemStartsInThisRow: a => a.itemStartsInThisRow,
    'provenance.file': a => a.file, 'provenance.row': a => a.row, 'provenance.page': a => a.page, 'provenance.rowNo': a => a.rowNo,
    requestQtCount: a => a.requestQtCount, requestGaiji: a => a.requestGaiji, itemQtCount: a => a.itemQtCount, itemGaiji: a => a.itemGaiji,
  };
  const dig = (r: MofXmlItemRecord, name: string) => fields[name](r);
  const fieldExactness: Record<string, { exact: number; mismatch: number }> = {};
  const mismatches: { file: string; row: string; field: string; expected: unknown; actual: unknown }[] = [];
  for (const name of Object.keys(fields)) {
    let exact = 0, mismatch = 0;
    for (const [k, r] of refKeys) {
      const a = actKeys.get(k);
      if (!a) continue;
      const e = dig(r, name), v = dig(a, name);
      if (JSON.stringify(e) === JSON.stringify(v)) exact++; else { mismatch++; mismatches.push({ file: r.file, row: r.row, field: name, expected: e, actual: v }); }
    }
    fieldExactness[name] = { exact, mismatch };
  }
  // provenance: record 側に file の SHA-256 は持たせず、recognized outcome の sourceSha256 と source set の SHA-256 を比較する
  const sourceShaMismatch = set.targets.filter(t => { const o = outcomes.get(t.file); return o?.status === 'recognized' && o.sourceSha256 !== t.sha256; }).map(t => t.file);
  fieldExactness['provenance.sourceSha256'] = { exact: set.targets.length - sourceShaMismatch.length, mismatch: sourceShaMismatch.length };

  // ---- hierarchy / special / counts ----
  const hierarchy = {
    itemAssignmentExact: [...refKeys].filter(([k, r]) => { const a = actKeys.get(k); return a && a.itemCode === r.itemCode && a.itemName === r.itemName; }).length,
    itemAssignmentMismatch: [...refKeys].filter(([k, r]) => { const a = actKeys.get(k); return a && !(a.itemCode === r.itemCode && a.itemName === r.itemName); }).length,
    orphan: failures.filter(f => f.code === 'orphan').length,
    ambiguous: 0,
  };
  const rowCountMismatch = set.targets.filter(t => { const o = outcomes.get(t.file); return !(o?.status === 'recognized' && o.counts.itemStartRows === t.itemStartRows && o.counts.requestRows === t.requestRows && o.counts.subtotalRows === t.subtotalRows && o.counts.descriptionOnlyRows === t.descriptionOnlyRows); }).map(t => t.file);
  const specialKeys = (pred: (r: RefRec) => boolean) => ref.filter(pred).map(key);
  const exactAt = (keys: string[]) => keys.filter(k => { const r = refKeys.get(k)!, a = actKeys.get(k); return a && JSON.stringify([a.requestQtCount, a.requestGaiji, a.itemQtCount, a.itemGaiji, a.requestName, a.itemName]) === JSON.stringify([r.requestQtCount, r.requestGaiji, r.itemQtCount, r.itemGaiji, r.requestName, r.itemName]); }).length;
  const gaijiKeys = specialKeys(r => r.requestGaiji.length > 0 || r.itemGaiji.length > 0);
  const qtKeys = specialKeys(r => r.requestQtCount > 0 || r.itemQtCount > 0);
  const fingerprints = [...new Set(set.targets.map(t => t.fingerprint))].sort(cmp).map(fp => { const ts = set.targets.filter(t => t.fingerprint === fp); return { fingerprint: fp, files: ts.length, recognized: ts.filter(t => outcomes.get(t.file)?.status === 'recognized').length }; });
  const special = {
    gaiji: { expectedRows: gaijiKeys.length, exact: exactAt(gaijiKeys) },
    qt: { expectedRows: qtKeys.length, exact: exactAt(qtKeys) },
    knownTargetFingerprints: fingerprints, rowCountMismatchFiles: rowCountMismatch,
  };

  // ---- 判定（preregistration §16 を機械適用）。fail-closed test の通過は別途 vitest で確認し、test file の hash を記録 ----
  const fieldMismatchTotal = Object.values(fieldExactness).reduce((n, f) => n + f.mismatch, 0);
  const conditions = {
    sourceSetIntegrity: hashChecks.every(h => h.match),
    sourceSetComplete328: completeness.complete && files.length === 328,
    nonTarget234of234: structural.nonTargetFilesCorrectlyNotTarget === set.nonTargets.length,
    targets94of94: structural.recognizedTargetFiles === set.targets.length && structural.targetFilesNotRecognized.length === 0,
    nonTargetMisclassifiedZero: structural.nonTargetFilesMisclassified.length === 0 && structural.recognizedButNotTarget.length === 0,
    noStructuralFailureOrUnsupported: structural.structuralFailures === 0 && structural.unsupported === 0,
    records1256: coverage.expected === 1256 && coverage.actual === 1256,
    missingExtraDuplicateZero: coverage.missing === 0 && coverage.extra === 0 && coverage.duplicate === 0 && refDup.length === 0,
    orphanAmbiguousZero: hierarchy.orphan === 0 && hierarchy.ambiguous === 0 && hierarchy.itemAssignmentMismatch === 0,
    requiredFieldsExact: fieldMismatchTotal === 0 && rowCountMismatch.length === 0,
    failClosedTestsPass: failClosedTestsPassed(vitestSummary, FAIL_CLOSED_MIN_TESTS),
    specialStructuresExact: special.gaiji.expectedRows === special.gaiji.exact && special.qt.expectedRows === special.qt.exact && fingerprints.every(f => f.files === f.recognized),
  };
  const decision = Object.values(conditions).every(Boolean) ? 'GO' : 'STOP';

  const result = {
    schema: 'mof-budget-xml-item-parser-v0-frozen-evaluation/v0',
    scope: 'FY2024 一般会計 当初予算 202411001（frozen XML source set）。first full frozen evaluation（implementation freeze 後に初めて実行）',
    implementation: { commit: IMPLEMENTATION_COMMIT, parserPath: 'scripts/pipeline-v2/lib/mof-budget-xml-items.ts', parserSha256: FROZEN['scripts/pipeline-v2/lib/mof-budget-xml-items.ts'], testPath: 'scripts/pipeline-v2/lib/mof-budget-xml-items.test.ts', testSha256: FROZEN['scripts/pipeline-v2/lib/mof-budget-xml-items.test.ts'], preregistrationCommit: PREREGISTRATION_COMMIT },
    frozenInputs: hashChecks,
    supersedes: { note: '初回評価の artifact は保持。本 run は evaluator の GO 条件を厳密化（source set の完全性・non-target 234/234・fail-closed test 通過）して再実行した結果', firstRunArtifact: FIRST_RUN, firstRunSha256: sha(fs.readFileSync(FIRST_RUN)), firstRunDecision: (JSON.parse(fs.readFileSync(FIRST_RUN, 'utf8')) as { decision: string }).decision },
    sourceSetCompleteness: completeness, failClosedTests: { path: FAIL_CLOSED_TESTS, minimumTests: FAIL_CLOSED_MIN_TESTS, ...vitestSummary },
    structural, coverage, fieldExactness, hierarchy, specialStructures: special, sourceShaMismatch,
    conditions, decision,
    rule: 'preregistration §16: GO は全 condition が真。1 件でも偽なら STOP（oracle/source の不備で評価不能なら INCONCLUSIVE）',
    mismatches,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ decision, structural: { recognizedTargetFiles: structural.recognizedTargetFiles, notTarget: structural.nonTargetFilesCorrectlyNotTarget, failures: structural.structuralFailures, unsupported: structural.unsupported }, coverage: { expected: coverage.expected, actual: coverage.actual, missing: coverage.missing, extra: coverage.extra, duplicate: coverage.duplicate }, hierarchy, fieldExactness, special: { gaiji: special.gaiji, qt: special.qt }, conditions }, null, 1));
  console.log(`wrote ${OUT} sha256=${sha(fs.readFileSync(OUT))}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
