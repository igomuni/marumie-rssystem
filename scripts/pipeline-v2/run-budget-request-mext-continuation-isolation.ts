/**
 * Phase A（failure isolation。抽出 rule は変更しない）: 文科省 `_03.pdf` で「隣接 token をつなぐと full name が存在する」3 項の物理構成を記録する。
 * 3 項の位置は MOF 名称で特定する（isolation のみ。continuation rule の形成には使わない）。
 * protocol: docs/tasks/20261006_0640_Budget_Request_MEXT_Item_Name_Continuation_Protocol.md
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/run-budget-request-mext-continuation-isolation.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import { extractDisplayPage, type PdfjsPageLike } from './lib/budget-request-display-page';
import { observeColumnLayout, observeIncompleteNameGuard, type ColumnLayout, type FieldResolverPageInput } from './lib/budget-request-field-resolver';
import { resolveLogicalRows } from './lib/budget-request-logical-row';
import { normalizeKey } from './lib/budget-request-mof-reconciliation';
import { buildTableGeometry } from './lib/budget-request-table-geometry';

const FX = 'tests/fixtures';
const OUT = `${FX}/budget-request-mext-continuation/2024`;
const MEXT_PDF = 'data/download/mext.go.jp/content/20230914-mxt_kaikesou01-000031817_03.pdf';
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const r1 = (x: number) => Math.round(x * 10) / 10;

async function main() {
  const baseline = readJson<{ sourcePdf: { sha256: string }; mextUnmatched: { mofSectionId: string; code: string; name: string; sourceClass: string }[] }>(`${OUT}/baseline.json`);
  if (fileSha(MEXT_PDF) !== baseline.sourcePdf.sha256) throw new Error('原本の hash 不一致（STOP）');
  const targets = baseline.mextUnmatched.filter(m => m.sourceClass === 'SPLIT_ACROSS_ADJACENT_TOKENS_FULL_NAME_PRESENT_AFTER_JOIN');
  if (targets.length !== 3) throw new Error('対象 3 項を再現できない（STOP）');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = 'node_modules/pdfjs-dist';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(MEXT_PDF)), cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/`, verbosity: 0 }).promise;
  const nf = normalizeKey;
  // 位置の特定（isolation のみ）: page の連結 text に MOF full name が含まれる page
  const pagesOf = new Map<string, number[]>();
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n); const c = await pg.getTextContent({ disableNormalization: false });
    const joined = nf((c.items.filter((i: unknown) => typeof i === 'object' && i !== null && 'str' in (i as object)) as { str: string }[]).map(i => i.str).join(''));
    for (const t of targets) if (joined.includes(nf(t.name))) pagesOf.set(t.mofSectionId, [...(pagesOf.get(t.mofSectionId) ?? []), n]);
    pg.cleanup();
  }
  const items: unknown[] = [];
  let lastLayout: ColumnLayout | null = null;
  const pageSet = new Set([...pagesOf.values()].flat());
  const pagesData = new Map<number, { page: FieldResolverPageInput; layout: ColumnLayout | null }>();
  for (let n = 1; n <= Math.max(...pageSet); n++) {
    const pg = await doc.getPage(n); const ex = await extractDisplayPage(pg as unknown as PdfjsPageLike, n, doc.numPages); pg.cleanup();
    const own = observeColumnLayout(n, ex.tokens); if (own) lastLayout = own;
    if (pageSet.has(n)) { const geometry = buildTableGeometry(ex.tokens, ex.meta); pagesData.set(n, { page: { meta: ex.meta, tokens: ex.tokens, geometry, logical: resolveLogicalRows(ex.tokens, ex.meta, geometry) }, layout: own ?? lastLayout }); }
  }
  await doc.destroy();
  for (const t of targets) {
    const pages = pagesOf.get(t.mofSectionId) ?? [];
    for (const n of pages) {
      const { page, layout } = pagesData.get(n)!;
      const rows = page.logical.logicalRowCandidates;
      const ref = page.geometry.parameters.rowClustering.referenceFontSize;
      const [nl, nr] = layout!.regions.name;
      const tokOf = (r: (typeof rows)[number]) => r.visualTokenIndexes.map(i => page.tokens[i]).filter(x => x.rawText.trim() !== '');
      const inName = (x: (typeof page.tokens)[number]) => { const c = (x.bbox.xMin + x.bbox.xMax) / 2; return c >= (nl ?? -1e9) && c < nr; };
      for (let ri = 0; ri < rows.length - 1; ri++) {
        const row = rows[ri], next = rows[ri + 1];
        const toks = tokOf(row);
        const codeTok = toks[0]; if (!codeTok || !/^\d{3}$/.test(codeTok.rawText.trim())) continue;
        const nameToks = toks.slice(1).filter(inName);
        const contToks = tokOf(next).filter(inName);
        const composed = nf(nameToks.map(x => x.rawText).join('') + contToks.map(x => x.rawText).join(''));
        if (composed !== nf(t.name)) continue;
        const rowToksWithIdx = toks.map(x => ({ token: x, physicalRowIndex: row.physicalRowIndexes[0] }));
        const guard = observeIncompleteNameGuard(page, layout!, row, next, rowToksWithIdx, new Set([codeTok.index]));
        const nextAll = tokOf(next);
        const after = rows[ri + 2];
        const afterToks = after ? tokOf(after) : [];
        const rightPanel = nextAll.filter(x => !inName(x));
        const nameXs = nameToks.map(x => x.bbox.xMin);
        const evidence = {
          codeAtRowStart: true, continuationHasCodeToken: /^\d{2,5}(-\d{2,5})*$/.test(nextAll[0]?.rawText.trim() ?? ''),
          continuationFirstTokenInNameRegion: nextAll.length > 0 && inName(nextAll[0]), continuationFirstTokenXMin: nextAll[0]?.bbox.xMin ?? null, itemNameStartXMin: nameXs.length ? Math.min(...nameXs) : null,
          xAlignmentDelta: nextAll[0] && nameXs.length ? r1(Math.min(...nameXs.map(x => Math.abs(nextAll[0].bbox.xMin - x))) * 100) / 100 : null,
          lineGap: { dy: next.resolution.evidence.vertical?.dy ?? null, dyFactor: next.resolution.evidence.vertical?.dyFactor ?? null },
          sameNameCell: contToks.length > 0 && contToks.every(inName), nameRegionX: layout!.regions.name,
          amountColumnTokensInContinuationRow: nextAll.filter(x => { const c = (x.bbox.xMin + x.bbox.xMax) / 2; return c >= layout!.regions.previousBudget[0] && c < layout!.regions.difference[1]; }).length,
          rightPanelTokensOnContinuationRow: rightPanel.map(x => ({ text: x.rawText.trim().slice(0, 20), xMin: x.bbox.xMin })),
          nextRowAfterContinuation: after ? { kind: after.resolution.kind, firstToken: afterToks[0]?.rawText.trim().slice(0, 12) ?? null, hasCode: /^\d{2,5}(-\d{2,5})*$/.test(afterToks[0]?.rawText.trim() ?? '') || /^\d{1,3}$/.test(afterToks[0]?.rawText.trim() ?? '') && /^\d{2}-\d{2,5}$/.test(afterToks[1]?.rawText.trim() ?? ''), firstTokenInNameRegion: afterToks.length > 0 && inName(afterToks[0]), firstTokenXMin: afterToks[0]?.bbox.xMin ?? null } : null,
          existingGuardObservation: { A_directlyBelow: guard.A, B_alignedNameStart: guard.B, C_startsWithCode: guard.C, D_hasAmount: guard.D, fires: guard.fires },
        };
        const supported = guard.fires && evidence.sameNameCell && !evidence.continuationHasCodeToken && evidence.amountColumnTokensInContinuationRow === 0;
        items.push({
          mofSectionId: t.mofSectionId, mofCodeDiagnostic: t.code, mofNormalizedFullName: nf(t.name), pdfPath: MEXT_PDF, page: n, logicalRowIndex: row.logicalRowIndex, itemCodeInSource: codeTok.rawText.trim(),
          currentExtractedName: { itemRowNameRegionText: nameToks.map(x => x.rawText).join(''), logicalRowResolutionOfContinuationRow: next.resolution.kind, logicalRowResolutionReason: next.resolution.evidence.reason ?? null, possibleContinuationLink: next.resolution.evidence.possibleContinuationOfLogicalRow ?? null },
          fullNameSourceTokens: [...nameToks.map(x => ({ role: 'item_row_name', text: x.rawText, index: x.index, bbox: x.bbox })), ...contToks.map(x => ({ role: 'continuation_row_name_region', text: x.rawText, index: x.index, bbox: x.bbox }))],
          rowBoundaries: { itemRowPhysicalRows: row.physicalRowIndexes, continuationPhysicalRows: next.physicalRowIndexes, itemRowYMin: r1(row.bbox.yMin), continuationYMin: r1(next.bbox.yMin), referenceFontSize: ref },
          evidence, classification: supported ? 'SOURCE_CONTINUATION_STRUCTURALLY_SUPPORTED' : 'SOURCE_CONTINUATION_AMBIGUOUS',
        });
      }
    }
  }
  const physicalClass = (it: any) => `${it.evidence.existingGuardObservation.fires ? 'guard_fires' : 'guard_not_fire'}|${it.evidence.sameNameCell ? 'name_cell' : 'other_cell'}|${it.evidence.rightPanelTokensOnContinuationRow.length > 0 ? 'right_panel_on_same_line' : 'no_right_panel'}`;
  const text = `${JSON.stringify(sortDeep({
    schema: 'budget-request-mext-continuation-isolation/v0',
    note: 'Phase A failure isolation。位置の特定に MOF 名称を使ったが、continuation の判定には使っていない（既存 FieldResolver の guard predicate A∧B∧¬C∧¬D を観測するだけ）。rule は未実装',
    sourcePdf: { path: MEXT_PDF, sha256: baseline.sourcePdf.sha256, pages: pagesData.size > 0 ? 1339 : null }, targetsFromBaseline: targets.length, itemsFound: items.length, pagesOfTargets: Object.fromEntries([...pagesOf.entries()]),
    items, physicalClassCounts: items.reduce((m: Record<string, number>, it) => { const k = physicalClass(it); m[k] = (m[k] ?? 0) + 1; return m; }, {}),
  }), null, 1)}\n`;
  fs.writeFileSync(`${OUT}/phaseA-isolation.json`, text);
  console.log(JSON.stringify({ sha: sha(text), found: items.length, classes: (items as any[]).map(i => [i.page, i.itemCodeInSource, i.classification, physicalClass(i), i.currentExtractedName.logicalRowResolutionOfContinuationRow]) }, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
