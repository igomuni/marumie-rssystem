/**
 * MOF 予算書【XML版】の source set（目次が列挙する XML の SHA-256 の一覧）を、取得済みの原本から作る。
 * parser の入力の境界（これと一致しない XML は読まない）として、builder が定数の SHA-256 で固定する。
 * target ＝ 事項表のタイトルを持つファイル（一般会計 `〔組織別事項別内訳〕`、特別会計 `歳出事項別内訳`。空白を除いて比べる）。
 *
 * 使い方: npx tsx scripts/pipeline-v2/make-mof-xml-source-set.ts <general|special> <archive-subdir 例: 2023/2023> <帳票ID 例: 202311001> <out.json>
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { decodeEucJpMenu, parseMenuXmlFileNames } from './lib/mof-archive-download';
import { children, isEl, readXml, type Tx } from './lib/mof-budget-xml-items-general';

const [kind, sub, doc, out] = process.argv.slice(2);
const TITLE: Record<string, string> = { general: '〔組織別事項別内訳〕', special: '歳出事項別内訳' };
if (!TITLE[kind ?? ''] || !sub || !doc || !out) throw new Error('usage: make-mof-xml-source-set.ts <general|special> <archive-subdir> <doc-id> <out.json>');
const root = path.join('data', 'download', 'mof.go.jp', 'archive', sub);
const menu = decodeEucJpMenu(fs.readFileSync(path.join(root, 'html', `${doc}menu.html`)));
const files = parseMenuXmlFileNames(menu.text);
const ws = (s: string) => s.replace(/[\s　]+/g, '');
const targets: { file: string; sha256: string }[] = [], nonTargets: { file: string; sha256: string }[] = [];
for (const f of [...files].sort()) {
  const bytes = fs.readFileSync(path.join(root, 'xml', f));
  const d = readXml(new TextDecoder('shift_jis', { fatal: true }).decode(bytes), f);
  const t = children(d.root, 'title_for_list')[0];
  const title = t ? ws(t.kids.filter((k): k is Tx => !isEl(k) && k.cdata).map(k => k.text).join('')) : '';
  (title === TITLE[kind] ? targets : nonTargets).push({ file: f, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ schema: 'mof-xml-source-set/v1', document: doc, source: `${sub}/xml`, menuReplacementChars: menu.replacementChars, xmlFiles: files.length, targetTableFiles: targets.length, nonTargetFiles: nonTargets.length, targets, nonTargets }, null, 1) + '\n');
console.log(JSON.stringify({ doc, xmlFiles: files.length, targets: targets.length, nonTargets: nonTargets.length }));
