/**
 * H1 independent human validation — reviewer package の manifest 生成と staging。
 * 入力は凍結済み worklist（+ reviewer protocol）と原本 PDF の identity のみ。AI GT・P4 result・provenance は読まない。PDF 本文は開かない（hash の計算のみ）。
 * 使い方: npx tsx scripts/pipeline-v2/stage-budget-request-h1-human-review-package.ts [--stage=<repo 外の出力 dir>]
 * manifest 出力: tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/h1-human-validation-package-manifest.json（決定的）
 * staging: repo 外の dir に worklist・protocol・manifest・原本 PDF のコピーを組む（コミットしない。外部送付はしない）
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';

const DIR = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0');
const WORKLIST = path.join(DIR, 'h1-human-validation-worklist.json');
const WORKLIST_SHA = '3546e523b8982c863dad51b889d0cb07dd978a529e20bcc70a12ef5eb8226c69';
const PROTOCOL = 'docs/tasks/20261003_2048_FieldResolver_v0_H1_Human_Reviewer_Protocol.md';
const MANIFEST = path.join(DIR, 'h1-human-validation-package-manifest.json');
const sha256 = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const stop = (m: string) => { console.error(`STOP: ${m}`); process.exitCode = 1; };

function main() {
  if (sha256(WORKLIST) !== WORKLIST_SHA) return stop('worklist hash 不一致');
  const wl = JSON.parse(fs.readFileSync(WORKLIST, 'utf8')) as { sources: { canonicalUrl: string; localPath: string; sha256: string; pageCount: number; unitCount: number }[] };
  const names = wl.sources.map(s => path.basename(s.localPath));
  if (wl.sources.length !== 7 || new Set(names).size !== 7) return stop('原本 7 本を一意に参照できない');
  for (const s of wl.sources) if (!fs.existsSync(s.localPath) || sha256(s.localPath) !== s.sha256) return stop(`原本の hash 不一致: ${s.localPath}`);

  const manifest = {
    schema: 'budget-request-incomplete-name-guard-h1-human-validation-package-manifest/v0',
    packageVersion: 1,
    worklist: { path: WORKLIST, sha256: WORKLIST_SHA },
    protocol: { path: PROTOCOL, sha256: sha256(PROTOCOL) },
    sources: wl.sources.map(s => ({ canonicalUrl: s.canonicalUrl, reviewerFilename: path.basename(s.localPath), sha256: s.sha256, pageCount: s.pageCount, unitCount: s.unitCount })),
  };
  nodeBudgetRequestFs.writeAtomic(MANIFEST, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));

  const stage = process.argv.find(a => a.startsWith('--stage='))?.slice('--stage='.length);
  if (stage) {
    const abs = path.resolve(stage);
    if (abs.startsWith(path.resolve('.') + path.sep)) return stop('staging dir は repository の外に指定する');
    fs.mkdirSync(path.join(abs, 'sources'), { recursive: true });
    fs.copyFileSync(WORKLIST, path.join(abs, path.basename(WORKLIST)));
    fs.copyFileSync(PROTOCOL, path.join(abs, path.basename(PROTOCOL)));
    fs.copyFileSync(MANIFEST, path.join(abs, path.basename(MANIFEST)));
    for (const s of wl.sources) fs.copyFileSync(s.localPath, path.join(abs, 'sources', path.basename(s.localPath)));
    console.log(`staged: ${abs}`);
  }
  console.log(`manifest sha256=${sha256(MANIFEST)}`);
}

main();
