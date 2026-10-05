/**
 * Alternative title projection の frozen population manifest（C1〜C5）を、Phase A（title ordering source-only inventory）の frozen artifact から決定的に作る。
 * membership は alternative projection の結果を見る前に固定する。件数が事前登録と一致しなければ STOP。
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-alt-title-population.ts
 * 出力: tests/fixtures/budget-request-alt-title-projection/2024/population-manifest.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const FX = 'tests/fixtures';
const INV = `${FX}/budget-request-title-ordering/2024/page-ordering-inventory.json`;
const INV_SHA = '9eb910a876fb3c807fa957f9b9ca65879187f55b1d338c6e4180ea8a544fddc3';
const OUT = path.join(FX, 'budget-request-alt-title-projection', '2024', 'population-manifest.json');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
interface Ev { p: number; st: string; cls: string; br: string | null }
const buf = fs.readFileSync(INV);
if (sha(buf) !== INV_SHA) throw new Error('Phase A inventory が frozen 値と一致しない（STOP）');
const pdfs = (JSON.parse(buf.toString('utf8')) as { perPdf: { localPath: string; evidence: Ev[] }[] }).perPdf;
const cls = (e: Ev): string | null => {
  if (e.st === 'observed_nonblank') return 'C1_current_nonblank';
  if (e.st !== 'observed_blank') return null;
  if (e.br === 'projection_cutoff_before_label') return e.cls === 'label_and_code_same_row' ? 'C2_target_same_row' : 'C3_cutoff_other';
  if (e.br === 'source_label_absent') return 'C4_source_label_absent';
  if (e.br === 'label_shape_unrecognized') return 'C5_label_shape_unrecognized';
  return 'OTHER_UNEXPECTED';
};
const members: Record<string, Record<string, number[]>> = {};
const counts: Record<string, number> = {};
for (const p of pdfs) for (const e of p.evidence) { const c = cls(e); if (!c) continue; ((members[c] ??= {})[p.localPath] ??= []).push(e.p); counts[c] = (counts[c] ?? 0) + 1; }
const expected: Record<string, number> = { C1_current_nonblank: 6195, C2_target_same_row: 2537, C3_cutoff_other: 70, C4_source_label_absent: 194, C5_label_shape_unrecognized: 149 };
for (const [k, v] of Object.entries(expected)) if (counts[k] !== v) throw new Error(`population が事前登録と一致しない（STOP）: ${k}=${counts[k]} (期待 ${v})`);
if (counts.OTHER_UNEXPECTED) throw new Error('想定外の blank reason（STOP）');
const text = `${JSON.stringify({ schema: 'budget-request-alt-title-population/v0', note: 'membership は alternative projection の結果を見る前に Phase A の frozen artifact から決定。変更しない', source: { inventory: INV, sha256: INV_SHA }, counts, members }, null, 0)}\n`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log(JSON.stringify({ sha256: sha(text), counts }));
