/**
 * Family B header-zone tokenless visual failure-isolation review sample の freeze（analysis-only・PDF は開かない）。
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-header-tokenless-visual-sample.ts [--write-manifest] [--locators <out.json> --raw-text-root <dir>]
 * --write-manifest: tests/fixtures/budget-request-toc-header-tokenless-visual-failure-isolation/2024/review-sample-manifest.json を書く
 * --locators: reviewer 用 blind locator（stratum / anchor / trigger 情報を含めない。repo に入れない）。選定の後にだけ実行し選定には使わない
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { buildManifest, loadCensus, pageKey, selectSample } from './lib/budget-request-toc-header-tokenless-visual-sample';

const argv = process.argv;
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const CENSUS = path.join('tests', 'fixtures', 'budget-request-toc-header-tokenless-failure-isolation', '2024', 'census.json');
const EXPECTED_CENSUS_SHA256 = 'd2c3f9b0878614466a3f69034164c86f60050c4783633e31a4b7fbaf2ceda5e7';
const OUT = path.join('tests', 'fixtures', 'budget-request-toc-header-tokenless-visual-failure-isolation', '2024', 'review-sample-manifest.json');

const { census, sha256 } = loadCensus(CENSUS);
if (sha256 !== EXPECTED_CENSUS_SHA256) throw new Error(`STOP: census sha256 mismatch ${sha256}`);
const selected = selectSample(census);
const manifest = buildManifest(census, sha256, selected);
const text = `${JSON.stringify(manifest, null, 1)}\n`;
if (argv.includes('--write-manifest')) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, text); }

const countBy = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map(k => [k, xs.filter(x => x === k).length]));
console.log(JSON.stringify({
  manifestSha256: sha256Hex(text),
  anchors: selected.filter(s => s.role === 'ANCHOR').length, controls: selected.filter(s => s.role === 'CONTROL').length,
  strata: countBy(selected.map(s => `${s.role}:${s.stratum}`)), partitions: countBy(selected.map(s => `${s.role}:${s.page.partition}`)),
  distinctPages: new Set(selected.map(s => pageKey(s.page))).size,
}));

const locOut = argOf('--locators');
if (locOut) {
  const root = argOf('--raw-text-root') ?? stop('--raw-text-root required');
  const rawManifest = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'), 'utf8')) as { documents: { localPdfPath: string; artifactPath: string; artifactSha256: string }[] };
  const cps = (s: string) => Array.from(s);
  const sheet = manifest.samples.map(s => {
    const d = rawManifest.documents.find(x => x.localPdfPath === s.localPdfPath) ?? stop(`no raw manifest doc ${s.localPdfPath}`);
    const buf = fs.readFileSync(path.join(root, d.artifactPath));
    if (sha256Hex(buf) !== d.artifactSha256) stop(`artifact sha256 mismatch ${d.artifactPath}`);
    const pg = JSON.parse(buf.toString('utf8').split('\n').filter(Boolean)[s.physicalPage - 1]) as { nonEmptyLines: { lineIndex: number; text: string }[] };
    const pos = pg.nonEmptyLines.findIndex(l => l.lineIndex === s.lineIndex);
    if (pos < 0) stop(`line not found ${s.sampleId}`);
    const E = s.censusFeatures.edge as number;
    const right = cps(pg.nonEmptyLines[pos].text).slice(E).join('').trim();
    if (sha256Hex(right) !== s.censusFeatures.rightTextSha256) stop(`rightText sha mismatch ${s.sampleId}`);
    const at = (p: number) => (p >= 0 && p < pg.nonEmptyLines.length ? { lineIndex: pg.nonEmptyLines[p].lineIndex, text: pg.nonEmptyLines[p].text } : null);
    return { sampleId: s.sampleId, localPdfPath: s.localPdfPath, physicalPage: s.physicalPage, lineIndex: s.lineIndex, charStart: s.charStart, rightText: right, before: [at(pos - 2), at(pos - 1)], after: [at(pos + 1), at(pos + 2)] };
  });
  fs.writeFileSync(locOut, `${JSON.stringify(sheet, null, 1)}\n`);
  console.log(JSON.stringify({ locators: sheet.length }));
}
function stop(m: string): never { throw new Error(`STOP: ${m}`); }
