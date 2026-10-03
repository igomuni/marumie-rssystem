/**
 * FieldResolver v0 — incomplete-name safety guard の評価標本の選定（選定専用。FieldResolver / LogicalRow は変更しない）。
 * 入力: current FieldResolver v0（baseline）の出力 artifact と、原本 PDF の幾何（SourceToken / TableGeometry / LogicalRow）。
 * 出力: tests/fixtures/budget-request-field-resolver/incomplete-name-guard-v0/sample.json（unit の識別子と層だけ。視覚 GT は含まない）。
 * 層の定義は事前登録文書の §7・§10 に固定した predicate（A〜D）で、閾値は LogicalRow の既存定数（行間 0.75〜1.5 倍・x 許容 0.25 倍）をそのまま使う。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { listExtractionTargets } from './lib/budget-request-extraction';
import { getBudgetRequestManifest } from './lib/budget-request-manifest';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { extractPageTokens } from './lib/budget-request-pdf-page';
import { buildTableGeometry } from './lib/budget-request-table-geometry';
import { resolveFields } from './lib/budget-request-field-resolver';
import { FIELD_RESOLVER_RUNS } from './lib/budget-request-field-resolver-runs';
import { FIELD_RESOLVER_WORK_DIR } from './lib/budget-request-field-resolver-paths';
import type { FieldResolverResult } from './lib/budget-request-field-resolver';
import type { HeldoutManifest } from './lib/budget-request-field-resolver-heldout-manifest';

const OUT = path.join('tests', 'fixtures', 'budget-request-field-resolver', 'incomplete-name-guard-v0', 'sample.json');
const CODE = /^\d{2,5}(-\d{2,5})*$/;
const isCodeLike = (f: string, second?: string): boolean => (/^\d{1,3}$/.test(f) && second !== undefined && /^\d{2}-\d{2,5}$/.test(second)) || (CODE.test(f) && (f.length >= 3 || f.includes('-')));

type Stratum = 'G' | 'NB' | 'NC' | 'ND' | 'P';
interface Unit { group: string; documentKey: string; canonicalUrl: string; page: number; logicalRowIndex: number; code: string; baselineName: string; yPt: [number, number]; stratum: Stratum; source: 'development' | 'heldout-v0-pages' | 'additional'; allBlankAmounts: boolean }

const hash = (u: Unit) => crypto.createHash('sha1').update(`${u.documentKey}:${u.page}:${u.logicalRowIndex}`).digest('hex');
const groupOfUrl = (url: string): string => (url.match(/(meti|mhlw|mext|cfa|mod|env|maff|mlit)\.go\.jp/)?.[1] ?? 'other').replace('env', 'moe');

async function unitsOf(documentKey: string, canonicalUrl: string, localPath: string, source: Unit['source'], result: FieldResolverResult): Promise<Unit[]> {
  const out: Unit[] = [];
  const pages = [...new Set(result.records.map(r => r.anchor.page))];
  for (const page of pages) {
    const diag = result.pageDiagnostics.find(p => p.page === page);
    const nameRight = diag?.columnLayout?.regions.name[1];
    const layout = diag?.columnLayout;
    if (nameRight === undefined || nameRight === null || !layout) continue;
    const ex = await extractPageTokens(localPath, page);
    const g = buildTableGeometry(ex.tokens, ex.page);
    const l = resolveLogicalRows(ex.tokens, ex.page, g);
    const ref = g.parameters.rowClustering.referenceFontSize;
    const dyMin = 0.75 * ref, dyMax = 1.5 * ref, tolA = 0.25 * ref;
    const amountRegion = (cx: number) => cx >= layout.regions.previousBudget[0] && cx < layout.regions.difference[1];
    for (const rec of result.records.filter(r => r.anchor.page === page)) {
      if (rec.rowLocal.name.status !== 'resolved') continue;
      const L = l.logicalRowCandidates[rec.anchor.logicalRowIndex];
      const S = l.logicalRowCandidates[rec.anchor.logicalRowIndex + 1];
      const codeRefs = new Set(rec.rowLocal.code.evidence?.sourceTokenRefs ?? []);
      let stratum: Stratum = 'P';
      if (S) {
        const lastL = g.physicalRows[L.physicalRowIndexes[L.physicalRowIndexes.length - 1]];
        const firstS = g.physicalRows[S.physicalRowIndexes[0]];
        const dy = firstS.baselineY - lastL.baselineY;
        const A = dy >= dyMin - 1e-9 && dy <= dyMax + 1e-9;
        const sTokens = firstS.visualTokenIndexes.map(i => ex.tokens[i]).filter(t => t.rawText.trim() !== '');
        const F = sTokens[0];
        const nameXs = L.rawTokenIndexes.map(i => ex.tokens[i]).filter(t => t.rawText.trim() !== '' && !codeRefs.has(t.index) && (t.bbox.xMin + t.bbox.xMax) / 2 < nameRight).map(t => t.bbox.xMin);
        const B = !!F && (F.bbox.xMin + F.bbox.xMax) / 2 < nameRight && nameXs.some(x => Math.abs(F.bbox.xMin - x) <= tolA);
        const C = !!F && !isCodeLike(F.rawText.trim(), sTokens[1]?.rawText.trim());
        const D = !S.rawTokenIndexes.some(i => ex.tokens[i].rawText.trim() !== '' && amountRegion((ex.tokens[i].bbox.xMin + ex.tokens[i].bbox.xMax) / 2));
        stratum = !A ? 'P' : !B ? 'NB' : !C ? 'NC' : !D ? 'ND' : 'G';
      }
      const rl = rec.rowLocal;
      out.push({ group: groupOfUrl(canonicalUrl), documentKey, canonicalUrl, page, logicalRowIndex: rec.anchor.logicalRowIndex, code: rec.rowLocal.code.value?.raw ?? '', baselineName: rec.rowLocal.name.value?.raw ?? '', yPt: [Math.round(rec.anchorBBox.yMin * 10) / 10, Math.round(rec.anchorBBox.yMax * 10) / 10], stratum, source,
        allBlankAmounts: [rl.previousBudget, rl.requestedBudget, rl.difference].every(f => f.status === 'blank') });
    }
  }
  return out;
}

async function main() {
  const targets = listExtractionTargets(getBudgetRequestManifest(2024));
  const pathOf = (url: string) => targets.find(t => t.canonicalUrl === url)!.localPath;
  const units: Unit[] = [];
  for (const run of FIELD_RESOLVER_RUNS) {
    const r = JSON.parse(fs.readFileSync(path.join(FIELD_RESOLVER_WORK_DIR, run.documentKey, 'field-resolution.json'), 'utf8')) as FieldResolverResult;
    units.push(...(await unitsOf(run.documentKey, run.canonicalUrl, pathOf(run.canonicalUrl), 'development', r)));
  }
  const man = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'budget-request-field-resolver', 'heldout-v0', 'manifest.json'), 'utf8')) as HeldoutManifest;
  for (const d of man.documents) for (const p of d.pages) {
    const r = JSON.parse(fs.readFileSync(path.join(FIELD_RESOLVER_WORK_DIR, 'heldout-v0', `${d.documentId}-p${p.physicalPage}`, 'field-resolution.json'), 'utf8')) as FieldResolverResult;
    units.push(...(await unitsOf(d.documentId, d.canonicalUrl, pathOf(d.canonicalUrl), 'heldout-v0-pages', r)));
  }
  // additional: FieldResolver をまだ実行していない 4 省庁（防衛省・環境省・農林水産省・国土交通省）の PDF のページ（held-out の 16 ページを除く）。baseline の出力から unit を作る
  const heldPages = new Set(man.documents.flatMap(d => d.pages.map(p => `${d.canonicalUrl}#${p.physicalPage}`)));
  const ADDITIONAL: [string, string, number, number][] = [
    ['mod-additional', 'https://www.mod.go.jp/j/budget/gaisan/r6/gaisanyoukyu.pdf', 9, 540],
    ['moe-additional', 'https://www.env.go.jp/content/000157010.pdf', 21, 193],
    ['maff-additional', 'https://www.maff.go.jp/j/budget/attach/pdf/230901-2.pdf', 7, 378],
    ['mlit-additional', 'https://www.mlit.go.jp/page/content/001630995.pdf', 19, 1097],
  ];
  for (const [documentKey, url, a, b] of ADDITIONAL) {
    const records: FieldResolverResult['records'] = [];
    const pageDiagnostics: FieldResolverResult['pageDiagnostics'] = [];
    for (let n = a; n <= b; n++) {
      if (heldPages.has(`${url}#${n}`)) continue;
      const ex = await extractPageTokens(pathOf(url), n);
      const geometry = buildTableGeometry(ex.tokens, ex.page);
      const logical = resolveLogicalRows(ex.tokens, ex.page, geometry);
      const r = resolveFields({ pages: [{ meta: ex.page, tokens: ex.tokens, geometry, logical }], hierarchy: null });
      records.push(...r.records);
      pageDiagnostics.push(...r.pageDiagnostics);
    }
    units.push(...(await unitsOf(documentKey, url, pathOf(url), 'additional', { records, pageDiagnostics } as unknown as FieldResolverResult)));
  }
  const groups = ['meti', 'mhlw', 'mext', 'cfa', 'mod', 'moe', 'maff', 'mlit'];
  const known = new Set(['moe-ippan:75:7', 'moe-ippan:75:27', 'moe-ippan:75:31']);
  const isKnown = (u: Unit) => known.has(`${u.documentKey}:${u.page}:${u.logicalRowIndex}`);
  const pool: Record<string, Record<string, number>> = {};
  for (const u of units) { pool[u.stratum] ??= {}; pool[u.stratum][u.group] = (pool[u.stratum][u.group] ?? 0) + 1; }
  // 標本: 既知 failure 3 + G（群ごと 3）+ NB（群ごと最大 2 → 計 12 目安: 先頭から 12）+ NC 12 + ND（全件・最大 4）+ P 12。いずれも sha1 の昇順で決定的に選ぶ
  const byHash = (a: Unit, b: Unit) => hash(a).localeCompare(hash(b));
  const pick = (s: Stratum, perGroup: number, cap: number): Unit[] => {
    const res: Unit[] = [];
    for (const g of groups) res.push(...units.filter(u => u.stratum === s && u.group === g && !isKnown(u)).sort(byHash).slice(0, perGroup));
    return res.sort(byHash).slice(0, cap);
  };
  const sample: (Unit & { selectedAs: string })[] = [
    ...units.filter(isKnown).map(u => ({ ...u, selectedAs: 'known-failure' })),
    ...pick('G', 4, 40).map(u => ({ ...u, selectedAs: 'G-guard-fires' })),
    ...pick('NB', 1, 8).map(u => ({ ...u, selectedAs: 'NB-below-not-name-aligned' })),
    ...pick('NC', 1, 4).map(u => ({ ...u, selectedAs: 'NC-below-aligned-with-code' })),
    ...pick('ND', 1, 4).map(u => ({ ...u, selectedAs: 'ND-below-aligned-no-code-with-amounts' })),
    ...pick('P', 1, 8).map(u => ({ ...u, selectedAs: 'P-no-adjacent-successor' })),
  ];
  // 金額がすべて空欄の見出し行（amount なしの見出し）を最低 6 件含める（上で選ばれたものを数え、足りない分を sha1 昇順で補う）
  const chosen = new Set(sample.map(u => `${u.documentKey}:${u.page}:${u.logicalRowIndex}`));
  const have = sample.filter(u => u.allBlankAmounts).length;
  const heads = units.filter(u => u.stratum !== 'G' && u.allBlankAmounts && !chosen.has(`${u.documentKey}:${u.page}:${u.logicalRowIndex}`)).sort(byHash);
  const perGroup = new Map<string, number>();
  for (const u of heads) {
    if (sample.filter(x => x.allBlankAmounts).length >= 6 && have >= 6) break;
    if (sample.filter(x => x.allBlankAmounts).length >= 6) break;
    if ((perGroup.get(u.group) ?? 0) >= 1) continue;
    perGroup.set(u.group, 1);
    sample.push({ ...u, selectedAs: 'H-amountless-heading' });
  }
  const out = { schema: 'budget-request-incomplete-name-guard-sample/v0', selectionRule: 'sha1(documentKey:page:logicalRowIndex) ascending within (stratum, group); G: up to 4 per group; NB/P: 1 per group; NC/ND: up to 1 per group; H: top up to 6 amountless headings (1 per group); known failures always included', poolCounts: pool, sample: sample.map(({ source, group, documentKey, canonicalUrl, page, logicalRowIndex, code, baselineName, yPt, stratum, selectedAs, allBlankAmounts }) => ({ selectedAs, stratum, source, group, documentKey, canonicalUrl, page, logicalRowIndex, code, baselineName, yPt, allBlankAmounts })) };
  // 視覚 GT 用の作業リスト: 層・guard の predicate・baseline の名称を含めず、sha1 順に並べる（GT 作成者が層を知らずにラベルを付けるため）
  const worklist = sample.map(u => ({ unitId: `${u.documentKey}:${u.page}:${u.logicalRowIndex}`, canonicalUrl: u.canonicalUrl, physicalPage: u.page, code: u.code, anchorYPt: u.yPt })).sort((a, b) => crypto.createHash('sha1').update(a.unitId).digest('hex').localeCompare(crypto.createHash('sha1').update(b.unitId).digest('hex')));
  nodeBudgetRequestFs.writeAtomic(path.join(path.dirname(OUT), 'gt-worklist.json'), Buffer.from(`${JSON.stringify({ schema: 'budget-request-incomplete-name-guard-gt-worklist/v0', units: worklist }, null, 2)}\n`, 'utf8'));
  nodeBudgetRequestFs.mkdirp(path.dirname(OUT));
  nodeBudgetRequestFs.writeAtomic(OUT, Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'));
  console.log(JSON.stringify({ units: units.length, pool, sampleSize: sample.length }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
