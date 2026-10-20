/**
 * 概算要求書 PDF の「文字層のない頁」を目視で確認するための、ローカル用の HTML を作る（リポジトリには出力を入れない）。
 *   npx tsx scripts/pipeline-v2/inspect-budget-request-textless-pages.ts --year=2027 [--include-blank] [--dpi=60] [--out=<dir>]
 * 入力: data/work/budget-request-plain-text/{year}/*.txt（頁は \f 区切り。空の頁が文字層なし）、凍結 PDF コーパス（PDF の場所）、
 *       tests/fixtures/budget-request-trend/kou.csv（その頁にリンクされる年度推移の項。任意）
 * 判定: `pdfimages -list` で画像のある頁を「画像」（黒塗り・スキャンの可能性）、無い頁を「空白」とする。既定は画像の頁だけをサムネイルにする。
 * 出力: <out>/index.html と <out>/thumbs/*.png（既定 data/work/budget-request-textless-pages/{year}）。PDF へのリンクは file:// の `#page=N`。
 * 必要なコマンド: pdfimages / pdftoppm（poppler）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { readCsv } from './lib/mof-budget-request-match';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const YEAR = Number(arg('year') ?? '2027');
const DPI = Number(arg('dpi') ?? '60');
const INCLUDE_BLANK = process.argv.includes('--include-blank');
const OUT = arg('out') ?? path.join('data', 'work', 'budget-request-textless-pages', String(YEAR));
const TEXT_DIR = path.join('data', 'work', 'budget-request-plain-text', String(YEAR));
const slugOf = (localPdfPath: string) => localPdfPath.replace(/^data\/download\//, '').replace(/\.pdf$/i, '').replace(/\//g, '__');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const freeze = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-pdf-corpus', String(YEAR), 'pdf-corpus-freeze.json'), 'utf8')) as { documents: { localPdfPath: string; sourceUrl: string }[] };
const pdfOf = new Map(freeze.documents.map(d => [slugOf(d.localPdfPath), d]));

// 年度推移の項: その頁（PDF頁）にリンクされるもの
const trendByPage = new Map<string, string[]>();
const trendCsv = path.join('tests', 'fixtures', 'budget-request-trend', 'kou.csv');
if (fs.existsSync(trendCsv)) {
  for (const r of readCsv(fs.readFileSync(trendCsv, 'utf8'))) {
    if (r['年度'] !== String(YEAR) || !r['PDF頁']) continue;
    const key = `${r['PDFの要求書']}#${r['PDF頁']}`;
    (trendByPage.get(key) ?? trendByPage.set(key, []).get(key)!).push(`${r['項名']}（${r['PDF頁の根拠']}）`);
  }
}

fs.mkdirSync(path.join(OUT, 'thumbs'), { recursive: true });
type Item = { slug: string; page: number; pages: number; kind: '画像' | '空白'; thumb: string | null };
const items: Item[] = [];
for (const file of fs.readdirSync(TEXT_DIR).filter(f => f.endsWith('.txt')).sort()) {
  const slug = file.slice(0, -4);
  const pages = fs.readFileSync(path.join(TEXT_DIR, file), 'utf8').split('\f'); if (pages[pages.length - 1] === '') pages.pop();
  const empty = pages.map((p, i) => (p.trim() === '' ? i + 1 : 0)).filter(Boolean);
  const doc = pdfOf.get(slug) ?? pdfOf.get(slug.replace(/%24/g, '$'));
  if (empty.length === 0 || !doc || !fs.existsSync(doc.localPdfPath)) continue;
  const withImage = new Set<number>();
  for (const line of execFileSync('pdfimages', ['-list', doc.localPdfPath], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').slice(2)) {
    const p = Number(line.trim().split(/\s+/)[0]); if (Number.isInteger(p)) withImage.add(p);
  }
  for (const page of empty) {
    const kind = withImage.has(page) ? '画像' : '空白';
    let thumb: string | null = null;
    if (kind === '画像' || INCLUDE_BLANK) {
      thumb = `thumbs/${slug.replace(/[^A-Za-z0-9._-]/g, '_')}_p${page}`;
      execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', String(DPI), '-png', '-singlefile', doc.localPdfPath, path.join(OUT, thumb)]);
      thumb += '.png';
    }
    items.push({ slug, page, pages: pages.length, kind, thumb });
  }
}

const count = { 画像: items.filter(i => i.kind === '画像').length, 空白: items.filter(i => i.kind === '空白').length };
const bySlug = new Map<string, Item[]>(); for (const i of items) (bySlug.get(i.slug) ?? bySlug.set(i.slug, []).get(i.slug)!).push(i);
const sections = [...bySlug].sort((a, b) => b[1].filter(i => i.kind === '画像').length - a[1].filter(i => i.kind === '画像').length || (a[0] < b[0] ? -1 : 1)).map(([slug, list]) => {
  const doc = pdfOf.get(slug) ?? pdfOf.get(slug.replace(/%24/g, '$'))!;
  const abs = path.resolve(doc.localPdfPath);
  const cards = list.map(i => {
    const linked = trendByPage.get(`${slug}#${i.page}`) ?? [];
    return `<figure class="${i.kind === '画像' ? 'img' : 'blank'}">
  <a href="file://${encodeURI(abs)}#page=${i.page}" target="_blank">${i.thumb ? `<img src="${esc(i.thumb)}" loading="lazy" alt="p${i.page}">` : '<div class="ph">サムネイルなし</div>'}</a>
  <figcaption><b>p${i.page}</b> / ${i.pages} 頁 <span class="k">${i.kind}</span>${linked.length ? `<div class="t">リンクされる項: ${esc(linked.join('、'))}</div>` : ''}</figcaption>
</figure>`;
  }).join('\n');
  return `<section><h2>${esc(slug)} <small>画像 ${list.filter(i => i.kind === '画像').length} / 空白 ${list.filter(i => i.kind === '空白').length}（${list[0].pages} 頁）</small></h2>
<p><a href="${esc(doc.sourceUrl)}" target="_blank">元の URL</a> · <a href="file://${encodeURI(abs)}" target="_blank">ローカルの PDF</a></p>
<div class="grid">${cards}</div></section>`;
}).join('\n');

fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>FY${YEAR} 文字層のない頁</title>
<style>body{font:14px/1.5 sans-serif;margin:16px}h2{font-size:15px;margin:24px 0 2px}small{color:#666;font-weight:normal}.grid{display:flex;flex-wrap:wrap;gap:10px}
figure{margin:0;border:1px solid #ccc;padding:4px;width:260px}figure.img{border-color:#d33}figure.blank{opacity:.6}img{width:100%;display:block}.ph{height:60px;color:#888;display:flex;align-items:center;justify-content:center}
figcaption{font-size:12px}.k{margin-left:4px;color:#d33}.blank .k{color:#666}.t{color:#06c}</style>
<h1>FY${YEAR} 文字層のない頁</h1>
<p>画像 ${count.画像} 頁（黒塗り・スキャンの可能性。赤枠）/ 空白 ${count.空白} 頁${INCLUDE_BLANK ? '' : '（サムネイルなし。--include-blank で作る）'}。サムネイルをクリックすると、その頁の PDF が開く（ローカルの PDF）。</p>
${sections}`);
console.log(JSON.stringify({ year: YEAR, ...count, out: path.join(OUT, 'index.html') }));
