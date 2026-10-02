/**
 * FieldResolver v0 held-out — POST-HOC の参考集計（正式な held-out 結果ではない）。
 * 初回評価の後に、GT の visual locator（y 座標）の転記ミスが 2 件見つかった。GT fixture は凍結済みで変更しない。
 * ここでは評価の呼び出し側でだけ locator を差し替え、同じ出力に対して再集計する（値・規則は変えない）。初回結果を置き換えない。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-field-resolver-heldout-posthoc.ts
 * 出力: data/work/budget-request-field-resolver/heldout-v0/posthoc-locator-corrected.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { evaluateHeldout } from './lib/budget-request-field-resolver-heldout-evaluator';
import type { HeldoutManifest } from './lib/budget-request-field-resolver-heldout-manifest';
import type { HeldoutGolden } from './lib/budget-request-field-resolver-heldout-gt';
import type { FieldResolverResult } from './lib/budget-request-field-resolver';
import { FIELD_RESOLVER_WORK_DIR } from './lib/budget-request-field-resolver-paths';

const HELDOUT_WORK_DIR = path.join(FIELD_RESOLVER_WORK_DIR, 'heldout-v0');

// 110 dpi の画像上の行位置を pt に換算するときの転記ミス（approxYPt の単位を取り違えた／隣の行の位置を使った）
const LOCATOR_CORRECTIONS: Record<string, number> = {
  'maff-p12-req69-total-sheet': Math.round(((185 * 72) / 110) * 10) / 10, // 要求番号 69 の行（210 px 付近でなく 185 px 付近）
  'mlit-p120-line-1010-chohi': Math.round(((546 * 72) / 110) * 10) / 10, // 546 px の行（pt の 357 をそのまま px として換算していた）
};

const dir = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'heldout-v0');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as HeldoutManifest;
const golden = JSON.parse(fs.readFileSync(path.join(dir, 'golden.json'), 'utf8')) as HeldoutGolden & { samples: { targets: { id: string; visualLocator: { approxYPt: number } }[] }[] };
for (const s of golden.samples) for (const t of s.targets) if (t.id in LOCATOR_CORRECTIONS) t.visualLocator.approxYPt = LOCATOR_CORRECTIONS[t.id];
const report = evaluateHeldout(golden as never, sample => {
  const s = sample as unknown as { sourcePage: number; document: { canonicalUrl: string } };
  const d = manifest.documents.find(x => x.canonicalUrl === s.document.canonicalUrl);
  const f = d && path.join(HELDOUT_WORK_DIR, `${d.documentId}-p${s.sourcePage}`, 'field-resolution.json');
  return f && fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as FieldResolverResult) : null;
});
const out = { label: 'POST-HOC (locator-corrected). Not the formal held-out result.', corrections: LOCATOR_CORRECTIONS, overall: report.overall, byLayout: report.byLayout, recordNotFound: report.recordNotFound, falseResolved: report.failures.filter(f => f.outcome === 'false_resolved'), blank: report.blank, explicitZero: report.explicitZero, confusion: report.confusion };
nodeBudgetRequestFs.writeAtomic(path.join(HELDOUT_WORK_DIR, 'posthoc-locator-corrected.json'), Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
console.log(JSON.stringify({ overall: report.overall, notFound: report.recordNotFound, falseResolved: out.falseResolved.map(f => `${f.targetId}.${f.field}`) }));
