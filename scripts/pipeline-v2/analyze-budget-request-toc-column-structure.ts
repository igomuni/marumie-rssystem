/**
 * TOC column-aware failure isolation（observation のみ。parser・preregistration・GT ではない）。
 * Phase A: Page Classification v0 が TOC と routing した 82 page の machine inventory（Raw Text のみから column / row の risk を記述する観測量）。
 * Phase B: inventory を見た後に文章化した deterministic rule で development visual sample を選ぶ（rule は選定前に doc 化し、render 結果を見て変更しない）。
 * machine feature は観測量の保存であり、`twoColumn=true` 等の semantic label は付けない。固定 column index・magic threshold の正式化・publisher 固有の境界は使わない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-column-structure.ts [--freeze-fixture]
 * 出力: tests/fixtures/budget-request-toc-column-structure/2024/machine-inventory.json（--freeze-fixture のとき）
 *       tests/fixtures/budget-request-toc-column-structure/2024/development-sample-selection.json（同上）
 *       data/work/budget-request-toc-column-structure/2024/sample-pages.json（目視用の page text。git 管理外）
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import type { PageClassificationRecord } from './lib/budget-request-page-classification';

const FREEZE = process.argv.includes('--freeze-fixture');
const OUT_DIR = path.join('tests', 'fixtures', 'budget-request-toc-column-structure', '2024');
const WORK_DIR = path.join('data', 'work', 'budget-request-toc-column-structure', '2024');
const CLS = path.join('data', 'work', 'budget-request-page-classification', '2024', 'page-classification.jsonl');
const RAW_MANIFEST = path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json');
const PAGES_DIR = path.join('data', 'work', 'budget-request-raw-text', '2024');
const LEDGER = path.join('tests', 'fixtures', 'budget-request-cover-toc-structure', '2024', 'development-explored-pages.json');
const RAW_DIGEST = '7c6d2dcec1f4bec0ca37a1b3aa391adce7d99b93ac4642c74cab7a328dac4052';
const CLS_DIGEST = '39464fc76b1b83272d5852d3db1db776e22bb570ee0f6b7ca4d1da64de4a5ecc';
export const SAMPLE_SEED = 'budget-request-toc-column-failure-isolation-dev-20261008';
const PER_STRATUM = 2;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const PUA = /[-]/g;
const HYPH = /[‐‑]/;

interface RawPage { page: number; text: string; textSha256: string; nonEmptyLines: { lineIndex: number; text: string }[] }

/** 1 行に末尾 page 番号候補が 2 つ並ぶ形: `<digits><gap≥2><text … digits>$`。右 block の開始 column（文字 index）を返す */
function secondSegmentStart(line: string): number | null {
  const m = /(\d{1,4})(\s{2,})(\S.*\s\d{1,4}\s*)$/.exec(line);
  if (!m) return null;
  return m.index + m[1].length + m[2].length;
}
const lineKind = (l: string) => {
  const t = l.trim();
  if (/^令\s*和/.test(t) && /目\s*次/.test(t)) return 'TITLE';
  if (/ページ/.test(t)) return 'COLUMN_HEADER';
  if (/^要求/.test(t) || /^番号/.test(t)) return 'COLUMN_HEADER_CONT';
  return 'BODY';
};

function main() {
  const raw = readJson<{ frozenInput: { corpusDigestSha256: string }; documents: { localPdfPath: string; pdfSha256: string; artifactPath: string; pageTextSha256: string[]; publisherDomain: string; logicalDocumentIndex: number }[] }>(RAW_MANIFEST);
  if (raw.frozenInput.corpusDigestSha256 !== RAW_DIGEST) throw new Error('raw text digest mismatch');
  const body = fs.readFileSync(CLS, 'utf8');
  if (sha256Hex(body) !== CLS_DIGEST) throw new Error('classification digest mismatch');
  const cls = body.split('\n').filter(l => l).map(l => JSON.parse(l) as PageClassificationRecord);
  const byKey = new Map(cls.map(r => [`${r.localPdfPath}#${r.physicalPage}`, r]));
  const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
  const tocs = cls.filter(r => r.classification.pageType === 'TOC');
  if (tocs.length !== 82 || tocs.filter(r => r.classification.source === 'DIRECT').length !== 55) throw new Error('TOC population mismatch');
  const cache = new Map<string, RawPage[]>();
  const pagesOf = (p: string) => { let r = cache.get(p); if (!r) { r = fs.readFileSync(path.join(PAGES_DIR, docs.get(p)!.artifactPath), 'utf8').split('\n').filter(l => l).map(l => JSON.parse(l) as RawPage); cache.set(p, r); } return r; };
  const ledger = readJson<{ pages: { localPdfPath: string; physicalPage: number; classifierPageType: string; inspection: { renderViewed: boolean } }[] }>(LEDGER);
  const rendered = new Set(ledger.pages.filter(p => p.classifierPageType === 'TOC' && p.inspection.renderViewed).map(p => `${p.localPdfPath}#${p.physicalPage}`));
  const explored = new Set(ledger.pages.filter(p => p.classifierPageType === 'TOC').map(p => `${p.localPdfPath}#${p.physicalPage}`));

  const pages: Record<string, unknown>[] = [];
  for (const r of tocs) {
    const d = docs.get(r.localPdfPath)!;
    const rp = pagesOf(r.localPdfPath)[r.physicalPage - 1];
    if (rp.textSha256 !== r.rawText.textSha256 || d.pageTextSha256[r.physicalPage - 1] !== rp.textSha256 || d.pdfSha256 !== r.pdfSha256) throw new Error(`hash mismatch ${r.localPdfPath}#${r.physicalPage}`);
    const lines = rp.nonEmptyLines.map(l => l.text);
    const kinds = lines.map(lineKind);
    const body = lines.filter((_, i) => kinds[i] === 'BODY');
    const lens = lines.map(l => l.length).sort((a, b) => a - b);
    const headerLine = lines.find((_, i) => kinds[i] === 'COLUMN_HEADER') ?? null;
    const pageTokenCols = headerLine ? [...headerLine.matchAll(/ページ/g)].map(m => m.index!) : [];
    const secondStarts = body.map(secondSegmentStart).filter((x): x is number => x !== null);
    const countRe = (re: RegExp) => body.reduce((n, l) => n + (l.match(re) ?? []).length, 0);
    // 末尾 page 参照候補（行末の 1〜4 桁、任意の 1〜3 文字 prefix token）
    const trailingRef = body.filter(l => /\s(?:[^\s\d（）()]{1,3}\s+)?\d{1,4}\s*$/.test(l)).length;
    const prefixCand = body.filter(l => /\s{2,}[^\s\d（）()・]{1,3}\s+\d{1,4}\s*$/.test(l) && !/[・]{3,}/.test(l));
    const noTrailing = body.filter(l => !/\d{1,4}\s*$/.test(l));
    const puaCodePoints = [...new Set([...rp.text.matchAll(PUA)].map(m => `U+${m[0].codePointAt(0)!.toString(16).toUpperCase()}`))];
    const prev = byKey.get(`${r.localPdfPath}#${r.physicalPage - 1}`);
    const next = byKey.get(`${r.localPdfPath}#${r.physicalPage + 1}`);
    pages.push({
      localPdfPath: r.localPdfPath, pdfSha256: r.pdfSha256, physicalPage: r.physicalPage, textSha256: rp.textSha256,
      publisherDomain: d.publisherDomain, logicalDocumentIndex: d.logicalDocumentIndex,
      classifierSource: r.classification.source, explicitTitleObserved: kinds.includes('TITLE'),
      nonEmptyLineCount: lines.length, bodyLineCount: body.length,
      firstNonEmptyLines: lines.slice(0, 4),
      pageHeaderTokenColumns: pageTokenCols,
      lineLength: { min: lens[0] ?? 0, median: lens[Math.floor(lens.length / 2)] ?? 0, max: lens[lens.length - 1] ?? 0 },
      leadingWhitespaceDistinct: [...new Set(body.map(l => l.length - l.trimStart().length))].sort((a, b) => a - b),
      largeGapLineCount: body.filter(l => /\S\s{8,}\S/.test(l)).length,
      trailingPageRefLineCount: trailingRef,
      linesWithTwoPageRefCandidates: secondStarts.length,
      secondSegmentStartColumns: [...new Set(secondStarts)].sort((a, b) => a - b),
      markerCounts: { 組織: countRe(/[（(]\s*組織\s*[）)]/g), 会計: countRe(/[（(]\s*会計\s*[）)]/g), 勘定: countRe(/[（(]\s*勘定\s*[）)]/g), 項: countRe(/[（(]\s*項\s*[）)]/g), 所管: countRe(/[（(]\s*所管\s*[）)]/g) },
      requestNumberRowStarts: body.filter(l => /^\s*\d{1,3}\s+\d{2}[‐‑-]\d{2}/.test(l)).length,
      requestNumberTokensMidLine: countRe(/\s\d{1,3}\s+\d{2}[‐‑-]\d{2}\s/g),
      u2011LineCount: body.filter(l => HYPH.test(l)).length,
      puaCodePoints,
      prefixPageRefCandidateLines: prefixCand.length,
      prefixPageRefCandidateTails: [...new Set(prefixCand.map(l => (/\s{2,}([^\s\d（）()・]{1,3}\s+\d{1,4})\s*$/.exec(l) ?? [])[1] ?? ''))].slice(0, 6),
      wrappedRowCandidateLines: noTrailing.length,
      previousPhysicalPageType: prev?.classification.pageType ?? (r.physicalPage === 1 ? null : prev?.classification.status ?? null),
      nextPhysicalPageType: next?.classification.pageType ?? (next ? next.classification.status : null),
      previousPageIsTocInSamePdf: prev?.classification.pageType === 'TOC',
      developmentExploredInPr3a: explored.has(`${r.localPdfPath}#${r.physicalPage}`),
      renderedInPr3a: rendered.has(`${r.localPdfPath}#${r.physicalPage}`),
    });
  }
  const keys = pages.map(p => `${p.localPdfPath}#${p.physicalPage}`);
  if (new Set(keys).size !== keys.length) throw new Error('duplicate page');

  // ---- sample selection（inventory を見た後に文章化した rule。render 結果を見て変更しない） ----
  const cand = pages.filter(p => !p.renderedInPr3a); // PR-3A で render 済みの 3 page は新規 sample の denominator から外す
  const stratumRules: Record<string, (p: Record<string, unknown>) => boolean> = {
    'DIRECT': p => p.classifierSource === 'DIRECT',
    'INHERITED': p => p.classifierSource === 'INHERITED',
    'continuation-in-multi-page-run(prev page is TOC)': p => p.previousPageIsTocInSamePdf === true,
    'many-two-ref-lines(>=median of pages with any)': p => (p.linesWithTwoPageRefCandidates as number) >= (medianTwoRef(pages)),
    'few-two-ref-lines(1..3)': p => { const n = p.linesWithTwoPageRefCandidates as number; return n >= 1 && n <= 3; },
    'no-two-ref-lines(right-empty-suspected)': p => p.linesWithTwoPageRefCandidates === 0,
    'wrapped-row-candidate(>=3 lines)': p => (p.wrappedRowCandidateLines as number) >= 3,
    'prefix-page-ref-candidate': p => (p.prefixPageRefCandidateLines as number) >= 1,
    'PUA-present': p => (p.puaCodePoints as string[]).length > 0,
    'marker-family:組織': p => (p.markerCounts as Record<string, number>).組織 > 0,
    'marker-family:会計': p => (p.markerCounts as Record<string, number>).会計 > 0,
    'marker-family:勘定': p => (p.markerCounts as Record<string, number>).勘定 > 0,
    'request-number-rows-many(>=20)': p => (p.requestNumberRowStarts as number) + (p.requestNumberTokensMidLine as number) >= 20,
    'request-number-rows-few(<=6)': p => (p.requestNumberRowStarts as number) + (p.requestNumberTokensMidLine as number) <= 6,
  };
  const pickKey = (s: string, p: Record<string, unknown>) => sha256Hex(`${SAMPLE_SEED}|${s}|${p.localPdfPath}|${p.physicalPage}`);
  const picked = new Map<string, { page: Record<string, unknown>; strata: string[] }>();
  const poolSizes: Record<string, number> = {};
  const publishersSeen = new Set<string>();
  for (const [s, rule] of Object.entries(stratumRules)) {
    const pool = cand.filter(rule);
    poolSizes[s] = pool.length;
    // publisher diversity: 同一 stratum 内では publisher が重複しない候補を hash 順に優先
    const sorted = [...pool].sort((a, b) => cmp(pickKey(s, a), pickKey(s, b)));
    const chosen: Record<string, unknown>[] = [];
    const pubs = new Set<string>();
    for (const p of sorted) { if (chosen.length >= PER_STRATUM) break; if (!pubs.has(String(p.publisherDomain))) { chosen.push(p); pubs.add(String(p.publisherDomain)); } }
    for (const p of sorted) { if (chosen.length >= PER_STRATUM) break; if (!chosen.includes(p)) chosen.push(p); }
    for (const p of chosen) { const k = `${p.localPdfPath}#${p.physicalPage}`; const e = picked.get(k) ?? { page: p, strata: [] }; e.strata.push(s); picked.set(k, e); publishersSeen.add(String(p.publisherDomain)); }
  }
  // 同一 failure family の重複 render を抑える: 3 stratum 以上に属する page を優先し、2 stratum 以下の page のうち hash 順で後ろのものを、全 stratum が他の page で既に充足されていれば落とす
  const stratumCover = new Map<string, number>();
  for (const { strata } of picked.values()) for (const s of strata) stratumCover.set(s, (stratumCover.get(s) ?? 0) + 1);
  const ordered = [...picked.entries()].sort(([ka, a], [kb, b]) => b.strata.length - a.strata.length || cmp(sha256Hex(`${SAMPLE_SEED}|prune|${ka}`), sha256Hex(`${SAMPLE_SEED}|prune|${kb}`)));
  const kept = new Map<string, { page: Record<string, unknown>; strata: string[] }>();
  const need = new Map<string, number>(Object.keys(stratumRules).map(s => [s, Math.min(1, poolSizes[s])]));
  for (const [k, e] of ordered) {
    const helps = e.strata.some(s => (need.get(s) ?? 0) > 0);
    if (helps) { kept.set(k, e); for (const s of e.strata) need.set(s, Math.max(0, (need.get(s) ?? 0) - 1)); }
  }
  // PUA を含む page は全件 sample に含める（指示: 可能な限り全件 development visual inspection 対象）。render 前に決めた規則
  for (const p of cand.filter(stratumRules['PUA-present'])) { const k = `${p.localPdfPath}#${p.physicalPage}`; if (!kept.has(k)) kept.set(k, { page: p, strata: ['PUA-present'] }); else if (!kept.get(k)!.strata.includes('PUA-present')) kept.get(k)!.strata.push('PUA-present'); }
  const sample = [...kept.values()].map(({ page, strata }) => ({ localPdfPath: page.localPdfPath, pdfSha256: page.pdfSha256, physicalPage: page.physicalPage, textSha256: page.textSha256, classifierPageType: 'TOC', classifierSource: page.classifierSource, publisherDomain: page.publisherDomain, selectionStratum: strata.sort(), selectionReason: `deterministic hash 順で各 stratum の先頭（publisher 重複を避ける）。同一 stratum の重複 render を抑えるため、各 stratum の 1 page 目を満たす最小集合に絞った（seed ${SAMPLE_SEED}）`, inspectionRole: 'DEVELOPMENT_EXPLORATION' }))
    .sort((a, b) => cmp(String(a.localPdfPath), String(b.localPdfPath)) || Number(a.physicalPage) - Number(b.physicalPage));

  const count = (rows: Record<string, unknown>[], f: (r: Record<string, unknown>) => string) => { const o: Record<string, number> = {}; for (const r of rows) o[f(r)] = (o[f(r)] ?? 0) + 1; return Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b))); };
  const summary = {
    pages: pages.length, direct: pages.filter(p => p.classifierSource === 'DIRECT').length, inherited: pages.filter(p => p.classifierSource === 'INHERITED').length,
    physicalPdfs: new Set(pages.map(p => p.localPdfPath)).size, publishers: new Set(pages.map(p => p.publisherDomain)).size,
    pagesWithAnyTwoRefLine: pages.filter(p => (p.linesWithTwoPageRefCandidates as number) > 0).length,
    pagesWithNoTwoRefLine: pages.filter(p => p.linesWithTwoPageRefCandidates === 0).length,
    twoRefLineCountDistribution: count(pages, p => String(Math.min(p.linesWithTwoPageRefCandidates as number, 30))),
    secondSegmentStartColumnVariety: { distinctColumnsAcrossAllPages: new Set(pages.flatMap(p => p.secondSegmentStartColumns as number[])).size, pagesWithSingleColumn: pages.filter(p => (p.secondSegmentStartColumns as number[]).length === 1).length, pagesWithMultipleColumns: pages.filter(p => (p.secondSegmentStartColumns as number[]).length > 1).length },
    puaPages: pages.filter(p => (p.puaCodePoints as string[]).length > 0).length,
    puaCodePoints: count(pages.flatMap(p => (p.puaCodePoints as string[]).map(c => ({ c }))), r => String(r.c)),
    pagesWithPrefixPageRefCandidate: pages.filter(p => (p.prefixPageRefCandidateLines as number) > 0).length,
    pagesWithWrappedRowCandidate: pages.filter(p => (p.wrappedRowCandidateLines as number) > 0).length,
    markerFamilyPages: { 組織: pages.filter(p => (p.markerCounts as Record<string, number>).組織 > 0).length, 会計: pages.filter(p => (p.markerCounts as Record<string, number>).会計 > 0).length, 勘定: pages.filter(p => (p.markerCounts as Record<string, number>).勘定 > 0).length },
    previousPageIsTocInSamePdf: pages.filter(p => p.previousPageIsTocInSamePdf).length,
    byPublisher: count(pages, p => String(p.publisherDomain)),
  };
  const out = { schema: 'budget-request-toc-column-structure-machine-inventory/v0', scope: 'TOC 82 page の machine inventory（観測量のみ。parser output ではなく、twoColumn 等の semantic label を付けていない）', generator: 'scripts/pipeline-v2/analyze-budget-request-toc-column-structure.ts', frozenInput: { rawTextCorpusDigestSha256: RAW_DIGEST, pageClassificationCorpusDigestSha256: CLS_DIGEST }, summary, pages };
  const sel = { schema: 'budget-request-toc-column-structure-development-sample/v0', inspectionRole: 'DEVELOPMENT_EXPLORATION（held-out ではない）', seed: SAMPLE_SEED, previouslyRenderedInPr3aExcluded: [...rendered].sort(), strataRules: Object.keys(stratumRules), poolSizes, perStratum: PER_STRATUM, sampleSize: sample.length, publishers: [...publishersSeen].sort(), sample };
  if (FREEZE) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'machine-inventory.json'), `${JSON.stringify(out, null, 1)}\n`);
    fs.writeFileSync(path.join(OUT_DIR, 'development-sample-selection.json'), `${JSON.stringify(sel, null, 1)}\n`);
  }
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.writeFileSync(path.join(WORK_DIR, 'sample-pages.json'), JSON.stringify(sample.map(s => ({ ...s, text: pagesOf(String(s.localPdfPath))[Number(s.physicalPage) - 1].text }))));
  console.log(JSON.stringify({ summary, poolSizes, sampleSize: sample.length, publishers: sel.publishers.length }, null, 1));
}
function medianTwoRef(pages: Record<string, unknown>[]): number {
  const v = pages.map(p => p.linesWithTwoPageRefCandidates as number).filter(n => n > 0).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 1;
}
main();
