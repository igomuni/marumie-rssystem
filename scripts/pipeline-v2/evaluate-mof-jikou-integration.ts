/**
 * MOF 事項 normalized output 統合の production generation 評価（FY2024 一般会計 当初予算 202411001）。
 * 生成済みの budget-jikou.jsonl を、frozen reference projection（#370）・既存 output の不変・決定的な再実行と照合し、GO/STOP を機械的に適用する。
 * 期待値に合わせて出力を補正しない。使い方: npx tsx scripts/pipeline-v2/evaluate-mof-jikou-integration.ts
 * 出力: tests/fixtures/mof-jikou-normalized/2024/202411001-integration-evaluation.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { readJsonl } from './lib/jsonl';
import type { MofXmlItemRecord } from './lib/mof-budget-xml-items';
import type { MofBudgetJikouRecord } from './types';

const OUT = path.join('tests', 'fixtures', 'mof-jikou-normalized', '2024', '202411001-integration-evaluation.json');
const JIKOU = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou.jsonl');
const MANIFEST = path.join('data', 'normalized', 'mof', 'fy2024', 'budget-jikou-manifest.json');
const REFERENCE = path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024', '202411001-reference-projection.json');
const REFERENCE_SHA = 'e6335aceb0c7d69888206cada038dcb03db5e25f7c2a10a8d5ae6104c2d615d9';
/** production generation の実行前に記録した既存 output の SHA-256（generation 前に取得。generation は既存 output を読むだけ） */
const EXISTING_BEFORE: Record<string, string> = {
  'data/normalized/mof/fy2024/budget-items.jsonl': '56b82f5aefcad43848b9f21994ca90ea49e024b56168ebd28f5559333f4c7c93',
  'data/normalized/mof/fy2024/manifest.json': 'f23071f33481d8d1cfdd8c195b3f03a903bb2bcfc207e9def8301876a47ae531',
  'data/derived/mof/fy2024/sections.jsonl': 'a5881f4d7a91d4da21229dfd6048a2b238af4be9f55950fefeb57f21cc52db62',
  'data/derived/mof/fy2024/budget-events.jsonl': '0f4e8e5f1643b809f172ec143210159bb9b6d18db7edccc80f208b59be30b489',
};
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function main() {
  if (sha(REFERENCE) !== REFERENCE_SHA) throw new Error('reference projection の hash 不一致（INCONCLUSIVE）');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as { recordCount: number; counts: Record<string, number>; parentResolution: Record<string, number>; parser: { sha256: string } };
  const rows = readJsonl<MofBudgetJikouRecord>(JIKOU);
  const ref = (JSON.parse(fs.readFileSync(REFERENCE, 'utf8')) as { records: MofXmlItemRecord[] }).records;

  // 決定的な再実行: 同じ入力で生成し直し、出力の SHA-256 が一致すること
  const first = { jikou: sha(JIKOU), manifest: sha(MANIFEST) };
  const rerun = spawnSync('npx', ['tsx', 'scripts/pipeline-v2/normalize-mof-jikou.ts'], { encoding: 'utf8' });
  const second = { jikou: sha(JIKOU), manifest: sha(MANIFEST) };
  const deterministicRerun = rerun.status === 0 && first.jikou === second.jikou && first.manifest === second.manifest;

  // 既存 output の不変
  const existing = Object.entries(EXISTING_BEFORE).map(([p, before]) => ({ path: p, before, after: sha(p), unchanged: sha(p) === before }));

  // frozen parser の population との一致（file + row で対応づけ）
  const key = (f: string, r: string) => `${f}#${r}`;
  const byKey = new Map<string, MofBudgetJikouRecord>();
  const dup: string[] = [];
  for (const r of rows) { const k = key(r.source.file, r.sourceLocator.row); if (byKey.has(k)) dup.push(k); byKey.set(k, r); }
  const refKeys = new Set(ref.map(r => key(r.file, r.row)));
  const missing = ref.filter(r => !byKey.has(key(r.file, r.row))).map(r => key(r.file, r.row));
  const extra = [...byKey.keys()].filter(k => !refKeys.has(k));
  const fieldCheck = { organization: 0, sectionCode: 0, sectionName: 0, jikouName: 0, jikouNameLines: 0, col4Raw: 0, amountYen: 0, previousAmountYen: 0, differenceYen: 0, amountsRawThousand: 0, nameQtCount: 0, nameGaiji: 0, locator: 0 };
  const mism: { key: string; field: string }[] = [];
  for (const e of ref) {
    const a = byKey.get(key(e.file, e.row));
    if (!a) continue;
    const pairs: [keyof typeof fieldCheck, unknown, unknown][] = [
      ['organization', a.organization, e.organization], ['sectionCode', a.sectionCode, e.itemCode], ['sectionName', a.sectionName, e.itemName],
      ['jikouName', a.jikouName, e.requestName], ['jikouNameLines', a.jikouNameLines, e.requestNameLines], ['col4Raw', a.col4Raw, e.col4Raw],
      ['amountYen', a.amountYen, e.amountsThousandYen.col6 * 1000], ['previousAmountYen', a.previousAmountYen, e.amountsThousandYen.col8 * 1000], ['differenceYen', a.differenceYen, e.amountsThousandYen.col10 * 1000],
      ['amountsRawThousand', a.amountsRawThousand, { current: e.amountsRaw.col6, previous: e.amountsRaw.col8, difference: e.amountsRaw.col10 }],
      ['nameQtCount', a.nameQtCount, e.requestQtCount], ['nameGaiji', a.nameGaiji, e.requestGaiji],
      ['locator', [a.source.file, a.sourceLocator.row, a.sourceLocator.page, a.sourceLocator.rowNo], [e.file, e.row, e.page, e.rowNo]],
    ];
    for (const [f, x, y] of pairs) { if (JSON.stringify(x) === JSON.stringify(y)) fieldCheck[f]++; else mism.push({ key: key(e.file, e.row), field: f }); }
  }
  const uniqueIds = new Set(rows.map(r => r.recordId)).size;
  const conditions = {
    productionGenerated: rows.length > 0 && rerun.status === 0,
    records1256: rows.length === 1256 && manifest.recordCount === 1256 && ref.length === 1256,
    missingExtraDuplicateZero: missing.length === 0 && extra.length === 0 && dup.length === 0 && uniqueIds === rows.length,
    requiredProvenanceAll: rows.every(r => r.source.file && r.source.path && r.source.sourceUrl && r.sourceLocator.sourceSha256 && r.sourceLocator.documentId),
    amountSemanticsPreserved: mism.length === 0,
    parentAllResolved: manifest.parentResolution.both === rows.length && manifest.parentResolution.orphan === 0 && manifest.parentResolution.ambiguous === 0,
    existingOutputsUnchanged: existing.every(e => e.unchanged),
    deterministicRerun,
    parserUnchangedFromFreeze: manifest.parser.sha256 === '1d52634ba40bcfabd6fcdae477417daaf309ce8f2c8decf3c9ca251e6e041a79',
  };
  const decision = Object.values(conditions).every(Boolean) ? 'GO' : 'STOP';
  const result = {
    schema: 'mof-jikou-normalized-integration-evaluation/v0',
    scope: 'FY2024 一般会計 当初予算 202411001（production generation）。tsc・lint・full vitest は別途確認',
    output: { path: JIKOU, sha256: first.jikou, manifestPath: MANIFEST, manifestSha256: first.manifest },
    population: { records: rows.length, uniqueRecordIds: uniqueIds, duplicateRecordIds: rows.length - uniqueIds, missing, extra, duplicateLocators: dup, counts: manifest.counts, parentResolution: manifest.parentResolution },
    frozenReference: { path: REFERENCE, sha256: REFERENCE_SHA, fieldExact: fieldCheck, mismatches: mism },
    existingOutputs: existing, deterministicRerun: { first, second, rerunExit: rerun.status },
    conditions, decision,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ decision, population: { records: rows.length, uniqueIds, missing: missing.length, extra: extra.length, dup: dup.length, parent: manifest.parentResolution, counts: manifest.counts }, fieldExact: fieldCheck, mismatches: mism.length, conditions, existingUnchanged: existing.map(e => e.unchanged) }, null, 1));
}

main();
