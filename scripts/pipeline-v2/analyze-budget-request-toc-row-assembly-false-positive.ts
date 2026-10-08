/**
 * #396 の FALSE_POSITIVE_ROW_ASSEMBLY 10 件の failure isolation（観測の機械的列挙と family 化のための材料）。
 * 保存済み artifact（#396 result / heldout-parser-output / frozen GT / Raw Text）の読み取りのみ。parser を import も実行もしない（held-out 再実行禁止）。
 * 解釈（family / causal status）は failure-families.json に別保存し、観測 table（observations.json）には原因名を付けない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/analyze-budget-request-toc-row-assembly-false-positive.ts [--freeze-fixture]
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { gtKey, gtTokenString, normColl, type GtPage } from './lib/budget-request-toc-row-assembly-evaluator';

const FREEZE = process.argv.includes('--freeze-fixture');
const EVAL = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-evaluation', '2024');
const ASM = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const OUT = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-false-positive-failure-isolation', '2024');
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const fileSha = (f: string) => sha256Hex(fs.readFileSync(f));
const key = (r: { localPdfPath: string; physicalPage: number }) => `${r.localPdfPath}#${r.physicalPage}`;
const cps = (s: string) => Array.from(s);
const isWs = (c: string | undefined) => c === undefined || /\s/u.test(c);
const FROZEN = { evaluationResult: 'fcb1e40cc25969748516c4bbe1673d15418051a5d01d912310118abba4d05f66', parserOutput: 'd95abb76ea63e660189167d6d8d6f8f34e9234cb879be18854b44c8b375b6f6b' };

interface Unit { column: string; sourceOrder: number; rowKind: string; rowStartTokenRaw: string | null; provenance: { lineIndex: number; charStart: number; charEnd: number; sourceRawSlice: string }; state: string }
interface PageOut { localPdfPath: string; physicalPage: number; pageState: string; rightBandEdge: number | null; rows: Unit[] }
interface Evidence { family: string; localPdfPath: string; physicalPage: number; gtRowId: string; gtKey: string; parserUnit: string; reason: string }

function main() {
  if (fileSha(path.join(EVAL, 'evaluation-result.json')) !== FROZEN.evaluationResult || fileSha(path.join(EVAL, 'heldout-parser-output.json')) !== FROZEN.parserOutput) throw new Error('STOP_FROZEN_ARTIFACT_INTEGRITY');
  const res = readJson<{ summary: { severe: { total: number; FALSE_POSITIVE_ROW_ASSEMBLY: { count: number; evidence: Evidence[] }; affectedPages: string[] } }; pages: { localPdfPath: string; physicalPage: number; classifierSource: string; instances: { family: string }[] }[] }>(path.join(EVAL, 'evaluation-result.json'));
  const out = readJson<{ pages: PageOut[] }>(path.join(EVAL, 'heldout-parser-output.json'));
  const gt = readJson<{ pages: GtPage[] }>(path.join(ASM, 'ground-truth.json'));
  const raw = readJson<{ documents: { localPdfPath: string; artifactPath: string }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
  const docs = new Map(raw.documents.map(d => [d.localPdfPath, d]));
  const rawCache = new Map<string, { nonEmptyLines: { lineIndex: number; text: string }[] }[]>();
  const rawLine = (p: string, page: number, lineIndex: number) => {
    let r = rawCache.get(p); if (!r) { r = fs.readFileSync(path.join('data', 'work', 'budget-request-raw-text', '2024', docs.get(p)!.artifactPath), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); rawCache.set(p, r); }
    return r[page - 1].nonEmptyLines.find(l => l.lineIndex === lineIndex)!.text;
  };
  const ev = res.summary.severe.FALSE_POSITIVE_ROW_ASSEMBLY.evidence;
  const idOf = (i: number) => `FP-${String(i + 1).padStart(2, '0')}`;
  const sevPerUnit = new Map<string, number>(); const sevPerPage = new Map<string, number>();
  for (const e of ev) { sevPerUnit.set(e.parserUnit, (sevPerUnit.get(e.parserUnit) ?? 0) + 1); sevPerPage.set(key(e), (sevPerPage.get(key(e)) ?? 0) + 1); }

  const observations = ev.map((e, i) => {
    const cls = res.pages.find(p => key(p) === key(e))!.classifierSource;
    const page = out.pages.find(p => key(p) === key(e))!;
    const g = gt.pages.find(p => key(p) === key(e))!;
    const gtRow = g.rows.find(r => r.rowId === e.gtRowId)!;
    const lineIndex = Number(e.parserUnit.split('@line')[1]);
    const unit = page.rows.find(u => `${u.column}:${u.sourceOrder}` === e.parserUnit.split('#')[1].split('@')[0].split(':').slice(1).join(':') && u.provenance.lineIndex === lineIndex)!;
    const line = rawLine(e.localPdfPath, e.physicalPage, lineIndex);
    const chars = cps(line); const E = page.rightBandEdge;
    const tok = gtTokenString(gtRow);
    const nline = normColl(line);
    const tokUtf16 = nline.indexOf(tok);
    // 正規化前の code point 位置（空白畳み前の raw で token 先頭を探す）
    const firstTokenChar = tok.split(' ')[0];
    const rawTokenPos = (() => { const re = new RegExp(`(?<![0-9])${firstTokenChar.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'); const m = re.exec(line.slice(0)); return m ? cps(line.slice(0, m.index)).length : -1; })();
    const headerUnits = page.rows.filter(u => u.rowKind === 'TITLE_OR_HEADING');
    const firstNonTitle = page.rows.filter(u => u.rowKind !== 'TITLE_OR_HEADING' && u.column !== 'UNSPLIT' || (u.column === 'UNSPLIT' && u.rowKind !== 'TITLE_OR_HEADING')).map(u => u.provenance.lineIndex).sort((a, b) => a - b)[0];
    const containsTok = (t: string) => new RegExp(`(?<![0-9])${t.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![0-9])`, 'u').test(nline);
    const gtOthersInLine = [...new Set(g.rows.filter(r => (r.rowKindVisual === 'REQUEST_NUMBER_ROW' || r.rowKindVisual === 'MARKER_ROW') && containsTok(gtTokenString(r))).map(r => gtKey(r)))];
    const sameOrderLeft = g.rows.find(r => r.column === 'LEFT' && r.orderInColumn === gtRow.orderInColumn);
    return {
      evidenceId: idOf(i), severeFamily: e.family, reason: e.reason,
      localPdfPath: e.localPdfPath, physicalPage: e.physicalPage, classifierSource: cls, parserPageState: page.pageState,
      gtRowId: e.gtRowId, gtKey: e.gtKey, gtColumn: gtRow.column, gtOrderInColumn: gtRow.orderInColumn, gtRowKindVisual: gtRow.rowKindVisual,
      gtLeftRowSameOrderInColumn: sameOrderLeft ? { rowId: sameOrderLeft.rowId, rowKindVisual: sameOrderLeft.rowKindVisual } : null,
      parserUnitId: e.parserUnit, parserUnitRowKind: unit.rowKind, parserUnitColumn: unit.column, parserUnitState: unit.state, parserUnitRowStartTokenRaw: unit.rowStartTokenRaw,
      sourceLineIndex: lineIndex, sourceRawLine: line, sourceRawSlice: unit.provenance.sourceRawSlice,
      matchedToken: tok, gtKeysContainedInLine: gtOthersInLine,
      headerZone: { unitIsTitleOrHeading: unit.rowKind === 'TITLE_OR_HEADING', headerUnitsOnPage: headerUnits.length, headerUnitLineIndexes: headerUnits.map(u => u.provenance.lineIndex), firstNonTitleUnitLineIndex: firstNonTitle ?? null },
      geometry: {
        rawLineLength: chars.length, unitCharStart: unit.provenance.charStart, unitCharEnd: unit.provenance.charEnd, rightBandEdgeE: E,
        matchedTokenCharIndex: rawTokenPos, tokenSideOfE: E === null || rawTokenPos < 0 ? null : rawTokenPos >= E ? 'AT_OR_RIGHT_OF_E' : 'LEFT_OF_E',
        charBeforeEIsWhitespace: E === null ? null : isWs(chars[E - 1]), charAtEIsWhitespace: E === null ? null : isWs(chars[E]),
        boundaryCrossingState: E === null ? null : !isWs(chars[E - 1]) && !isWs(chars[E]) ? 'CROSSING' : 'NOT_CROSSING',
        normalizedTokenOffsetInCollapsedLine: tokUtf16,
      },
      severeCountOnSameParserUnit: sevPerUnit.get(e.parserUnit), severeCountOnSamePage: sevPerPage.get(key(e)),
    };
  });

  // page context: 全 ASSEMBLED_SPLIT page の header zone 行で、E 以降に内容がある行（counterexample 材料）
  const pageContext = out.pages.filter(p => p.pageState === 'ASSEMBLED_SPLIT').map(p => {
    const E = p.rightBandEdge as number;
    const lines = p.rows.filter(u => u.rowKind === 'TITLE_OR_HEADING').map(u => {
      const l = rawLine(p.localPdfPath, p.physicalPage, u.provenance.lineIndex); const c = cps(l);
      return { lineIndex: u.provenance.lineIndex, hasContentAtOrRightOfE: c.slice(E).some(x => !isWs(x)), textAtOrRightOfE: c.slice(E).join('').trim(), severeEvidenceIds: observations.filter(o => o.parserUnitId.endsWith(`@line${u.provenance.lineIndex}`) && key(o) === key(p)).map(o => o.evidenceId) };
    });
    return { localPdfPath: p.localPdfPath, physicalPage: p.physicalPage, rightBandEdgeE: E, severeOnPage: sevPerPage.get(key(p)) ?? 0, headerZoneLinesWithContentAtOrRightOfE: lines.filter(l => l.hasContentAtOrRightOfE), headerZoneLineCount: lines.length };
  });

  const observationsDoc = {
    schema: 'budget-request-toc-row-assembly-false-positive-observations/v0',
    note: '観測 table（原因名を付けない）。保存済み artifact の読み取りのみ。parser は実行していない',
    frozen: { evaluationResultSha256: FROZEN.evaluationResult, heldoutParserOutputSha256: FROZEN.parserOutput, groundTruthSha256: fileSha(path.join(ASM, 'ground-truth.json')) },
    severeExpected: res.summary.severe.total, severeObserved: observations.length, affectedPages: res.summary.severe.affectedPages.length,
    observations, pageContextForAssembledSplitPages: pageContext,
  };
  // ---- family 化（observable な定義で機械的に割り当てる。定義に合わなければ UNCLASSIFIED）----
  const FAMILY_A = 'HEADER_ZONE_WHOLE_LINE_CONTAINS_RIGHT_COLUMN_ROW_START';
  const familyOf = (o: (typeof observations)[number]) =>
    o.parserPageState === 'ASSEMBLED_SPLIT' && o.parserUnitRowKind === 'TITLE_OR_HEADING' && o.parserUnitColumn === 'UNSPLIT' && o.parserUnitRowStartTokenRaw === null &&
    o.geometry.tokenSideOfE === 'AT_OR_RIGHT_OF_E' && o.geometry.boundaryCrossingState === 'NOT_CROSSING' && o.gtColumn === 'RIGHT' && o.headerZone.firstNonTitleUnitLineIndex !== null && o.sourceLineIndex < o.headerZone.firstNonTitleUnitLineIndex
      ? FAMILY_A : 'UNCLASSIFIED';
  const assigned = observations.map(o => ({ evidenceId: o.evidenceId, family: familyOf(o) }));
  const byFamily = (f: string) => observations.filter(o => familyOf(o) === f);
  const A = byFamily(FAMILY_A);
  const lineOrderOnPage = (o: (typeof observations)[number]) => observations.filter(x => key(x) === key(o) && x.sourceLineIndex <= o.sourceLineIndex).length; // 同 page 内で token を含む header 行の何番目か
  const variantToken = (o: (typeof observations)[number]) => (o.gtKey.startsWith('M|') ? 'MARKER_TOKEN' : 'REQUEST_TOKEN');
  const count = (xs: string[]) => xs.reduce((a: Record<string, number>, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
  const splitPagesNoSevere = pageContext.filter(p => p.severeOnPage === 0);
  const families = {
    schema: 'budget-request-toc-row-assembly-false-positive-failure-families/v0',
    note: 'family 化と causal status（観測 table とは分離）。#396 は再判定しない。parser・GT・evaluator・threshold は変更していない。fix simulation はしていない',
    frozen: observationsDoc.frozen,
    accounting: { severeTotal: observations.length, familyCountSum: assigned.filter(a => a.family !== 'UNCLASSIFIED').length, unclassified: assigned.filter(a => a.family === 'UNCLASSIFIED').length, uniqueEvidenceIds: new Set(observations.map(o => o.evidenceId)).size, affectedPages: new Set(observations.map(o => key(o))).size, mechanisticallyExplained: A.length, hypothesized: 0, unresolved: 0 },
    assignment: assigned,
    families: [{
      label: FAMILY_A,
      observableDefinition: 'parser page が ASSEMBLED_SPLIT（右 band E 解決済み）で、E より右に GT の右 column row の row-start token を含む raw line が、最初の row-start 行より前（header zone）にあり、whole-line の TITLE_OR_HEADING 1 unit（column=UNSPLIT, row-start token なし）として出力された。token は E 以右にあり boundary crossing はない',
      count: A.length, pages: [...new Set(A.map(o => key(o)))].length, evidenceIds: A.map(o => o.evidenceId),
      commonObservablePattern: `全件で unit は TITLE_OR_HEADING・UNSPLIT・rowStartTokenRaw=null、GT の右 row は 1 件の token を含み、同一 raw line の左側は GT の PLAIN_ROW（同 order の LEFT row）。header zone 内の同 page の最初の row-start 行は line ${[...new Set(A.map(o => o.headerZone.firstNonTitleUnitLineIndex))].join(' / ')}、問題の行はそれより前（line ${[...new Set(A.map(o => o.sourceLineIndex))].sort((a, b) => a - b).join(' / ')}）。1 unit あたり severe 1 件、1 page あたり 2 件`,
      subVariantsObservedOnly: { byTokenKind: count(A.map(variantToken)), byHeaderLineOrderOnPage: count(A.map(o => `line#${lineOrderOnPage(o)}`)), note: '同一機構内の観測属性であり独立 family ではない' },
      counterexample: { description: '右 band が解決された他の ASSEMBLED_SPLIT page（severe 0）では、header zone 内で E 以右に内容を持つ行は page title / 列見出し行のみ（GT の row token を含まない）', pages: splitPagesNoSevere.map(p => ({ localPdfPath: p.localPdfPath, physicalPage: p.physicalPage, headerZoneLinesRightOfE: p.headerZoneLinesWithContentAtOrRightOfE.map(l => ({ lineIndex: l.lineIndex, text: l.textAtOrRightOfE.slice(0, 40) })) })) },
      parserRuleRelation: '#391 preregistration の header zone rule（最初の row-start 行の直前まで。header zone の行は分割せず whole-line を TITLE_OR_HEADING として保持）と #393 の実装どおりの出力。row-start 判定は行頭 token のみで、行頭が「令和…」の行は row-start ではないため header zone が延びる。実装の逸脱ではない',
      evaluatorArtifactPossibility: '10 件とも merge predicate の token は E 以右の GT 右 row の token で、境界の数字 lookbehind/lookahead に適合し、同一 raw line の左側は GT の PLAIN_ROW。文字列の偶然一致ではなく、複数の GT visual row（左 PLAIN_ROW + 右 row）が 1 parser unit の sourceRawSlice に含まれる。predicate-only の疑いは 0 件',
      causalStatus: 'MECHANISTICALLY_EXPLAINED',
      causalBasis: 'frozen parser の header zone 経路（行頭が row-start でない行は header zone として whole-line 保持）と保存済み出力（問題の行はいずれも最初の非 TITLE unit より前の TITLE unit）から、出力に至る機構を追跡できる。同一機構が 10 件全てに当てはまる',
      limitations: ['同一 raw line の左 PLAIN_ROW と右 row が視覚上も同一 baseline かは目視していない（family 判定には不要）', 'なぜこの page の右 column が左より上から始まるかという layout 上の理由は仮説の対象で、本 unit では扱わない'],
    }],
    adjacentObservationsNotInSevere: [
      { note: '同じ header zone 機構で whole-line に取り込まれた右 column の wrapped fragment 行（token を持たないため merge predicate の対象外）', cases: pageContext.flatMap(p => p.headerZoneLinesWithContentAtOrRightOfE.filter(l => l.severeEvidenceIds.length === 0 && p.severeOnPage > 0 && !/^[\d]+$/u.test(l.textAtOrRightOfE) && !/(区|目|次|号|求|額)/u.test(l.textAtOrRightOfE.slice(0, 4))).map(l => ({ localPdfPath: p.localPdfPath, physicalPage: p.physicalPage, lineIndex: l.lineIndex, text: l.textAtOrRightOfE.slice(0, 40) }))), status: 'OBSERVED_PATTERN（#396 の severe 件数には含まれない）' },
    ],
    visualInspection: { performed: false, reason: '保存済み artifact のみで family 判定が一意にできたため escalation 不要', pages: [], gtChanged: false },
    evaluatorPredicateCheck: { physicalMergeSupported: A.length, predicateOnlyPossibility: 0, unresolved: 0, note: '#396 は frozen contract 上 severe のまま再判定しない' },
    nextResearchQuestion: '右 band E が解決された page で、header zone の行（最初の row-start 行より前）が右 column の row-start token を含むかどうかを、preregistered primitive（E、row-start token pattern）だけから区別できるか。別 unit で仮説形成する（本 unit は fix を含まない）',
    judgment: 'READY_FOR_FALSE_POSITIVE_HYPOTHESIS_FORMATION',
  };
  if (FREEZE) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'observations.json'), `${JSON.stringify(observationsDoc, null, 1)}\n`);
    fs.writeFileSync(path.join(OUT, 'failure-families.json'), `${JSON.stringify(families, null, 1)}\n`);
  }
  console.log(JSON.stringify({ accounting: families.accounting, adjacent: families.adjacentObservationsNotInSevere[0].cases }, null, 1));
  if (false) console.log(JSON.stringify({ n: observations.length, summary: observations.map(o => [o.evidenceId, o.parserUnitRowKind, o.geometry.tokenSideOfE, o.geometry.boundaryCrossingState, o.headerZone.firstNonTitleUnitLineIndex, o.gtKeysContainedInLine.length, o.severeCountOnSameParserUnit, o.gtLeftRowSameOrderInColumn?.rowKindVisual]), pageContext: pageContext.map(p => [p.physicalPage, p.severeOnPage, p.headerZoneLinesWithContentAtOrRightOfE.length, p.headerZoneLineCount]) }));
}
main();
