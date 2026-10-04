/**
 * MOF 予算書XML 事項 parser v0 — hand-checked fixture（代表例）の凍結 script（research。production parser ではない）。
 * 選択は事後に都合よく選べない deterministic 規則で、reference projection と raw XML だけから行う。各行に raw XML の clm 断片（原文そのまま）を添える。
 * 使い方: npx tsx scripts/pipeline-v2/freeze-mof-budget-xml-hand-fixture.ts [--check]
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join('data', 'download', 'mof.go.jp', 'archive', '2024', '2024', 'xml');
const DIR = path.join('tests', 'fixtures', 'mof-budget-xml-parser-v0', '2024');
const OUT = path.join(DIR, '202411001-hand-checked-fixture.json');
type Rec = { file: string; row: string; page: number; itemStartsInThisRow: boolean; requestNameLines: string[]; requestQtCount: number; requestGaiji: unknown[]; amountsRaw: { col6: string; col8: string; col10: string } } & Record<string, unknown>;

function main() {
  const check = process.argv.includes('--check');
  const proj = JSON.parse(fs.readFileSync(path.join(DIR, '202411001-reference-projection.json'), 'utf8')) as { records: Rec[] };
  const set = JSON.parse(fs.readFileSync(path.join(DIR, '202411001-source-set.json'), 'utf8')) as { targets: { file: string; fingerprint: string }[] };
  const recs = proj.records;
  const picked = new Map<string, { rec: Rec; reasons: string[] }>();
  const pick = (r: Rec | undefined, reason: string) => {
    if (!r) throw new Error(`選択規則に該当する行が無い: ${reason}`);
    const k = `${r.file}#${r.row}`;
    const e = picked.get(k) ?? { rec: r, reasons: [] };
    e.reasons.push(reason);
    picked.set(k, e);
  };
  recs.filter(r => r.requestGaiji.length > 0).forEach(r => pick(r, 'gaiji（全件）'));
  recs.filter(r => r.requestQtCount > 0).forEach(r => pick(r, 'qt（全件）'));
  // structural fingerprint ごとに、ファイル名辞書順で先頭のファイルの先頭の事項行
  const fpFirstFile = new Map<string, string>();
  for (const t of [...set.targets].sort((a, b) => (a.file < b.file ? -1 : 1))) if (!fpFirstFile.has(t.fingerprint)) fpFirstFile.set(t.fingerprint, t.file);
  [...fpFirstFile.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).forEach(([fp, f]) => pick(recs.find(r => r.file === f), `structural fingerprint ${fp} の先頭ファイル先頭行`));
  // carry-forward の頁境界: 頁が変わった最初の行が項の開始行でない事項行（出現順で先頭 3 件）
  let prev: Rec | null = null; let boundary = 0;
  for (const r of recs) { if (prev && prev.file === r.file && prev.page !== r.page && !r.itemStartsInThisRow && boundary < 3) { boundary++; pick(r, `頁境界で項が再掲されない行（出現順 ${boundary}）`); } prev = r; }
  // ファイル境界（currentItem の初期化）: 2 つ目のファイルの先頭行
  const files = [...new Set(recs.map(r => r.file))];
  pick(recs.find(r => r.file === files[1]), 'ファイル先頭行（currentItem の初期化）');
  pick(recs.find(r => r.requestNameLines.length > 1), '複数行の事項名（先頭）');
  pick(recs.find(r => r.requestNameLines.length === 1), '1 行の事項名（先頭）');
  pick(recs.find(r => r.amountsRaw.col10.startsWith('△')), 'col10 が △（先頭）');
  pick(recs.find(r => r.amountsRaw.col10 === '0'), 'col10 が 0（先頭）');
  pick(recs.find(r => r.amountsRaw.col6 === '0'), 'col6 が 0（先頭）');
  pick(recs.find(r => r.amountsRaw.col8 === '0'), 'col8 が 0（先頭）');

  const decoded = new Map<string, string>();
  const dec = (f: string) => { if (!decoded.has(f)) decoded.set(f, new TextDecoder('shift_jis', { fatal: true }).decode(fs.readFileSync(path.join(ROOT, f)))); return decoded.get(f)!; };
  const rows = [...picked.values()].sort((a, b) => (a.rec.file + a.rec.row < b.rec.file + b.rec.row ? -1 : 1)).map(({ rec, reasons }) => {
    const text = dec(rec.file);
    const frags = [...text.matchAll(new RegExp(`<clm id="${rec.row.replace('.', '\\.')}-[0-9.]+">[\\s\\S]*?</clm>`, 'g'))].map(m => m[0].replace(/\s*\n\s*/g, ''));
    if (frags.length === 0) throw new Error(`raw 断片が見つからない ${rec.file} ${rec.row}`);
    return { file: rec.file, row: rec.row, reasons, rawClmFragments: frags, expected: rec };
  });
  const out = {
    schema: 'mof-budget-xml-parser-v0-hand-checked-fixture/v0',
    note: '代表例の fixture。選択規則は事後に選べない deterministic 規則（下記 selectionRules）。rawClmFragments は raw XML の clm 要素の原文（改行・インデントのみ除去）。expected は reference projection と同じ値で、AI による原文との目視照合を経ている（independent human GT ではない）。',
    selectionRules: ['gaiji 全件', 'qt 全件', 'structural fingerprint ごとに辞書順先頭ファイルの先頭行', '頁境界で項が再掲されない行の先頭 3 件', '2 つ目のファイルの先頭行', '複数行の事項名の先頭 / 1 行の事項名の先頭', 'col10 が △ / 0 の先頭、col6 が 0 の先頭、col8 が 0 の先頭'],
    rowCount: rows.length,
    rows,
  };
  const s = `${JSON.stringify(out, null, 2)}\n`;
  if (check) { if (fs.readFileSync(OUT, 'utf8') !== s) throw new Error('再生成が commit 済み fixture と一致しない'); } else fs.writeFileSync(OUT, s);
  console.log(JSON.stringify({ rows: rows.length, reasons: rows.map(r => r.reasons.join('/')) }, null, 0).slice(0, 1500));
}

main();
