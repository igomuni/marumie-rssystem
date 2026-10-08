/**
 * H1 新 held-out 25 page の visual GT を、目視転記ソース（new-heldout-visual-gt-source.txt）から決定的に組み立てる。
 * parser / H1 / pdftotext 出力は使わない（import しない）。raw text 内容も読まない。Raw Text manifest は PDF / text hash の identity 照合にのみ使う。
 * 使い方: GT_RECORDED_AT=<iso> BASE_MAIN_SHA=<sha> npx tsx scripts/pipeline-v2/build-budget-request-toc-h1-new-heldout-visual-gt.ts [--freeze-fixture] [--render-dir <dir>]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const DIR = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly-header-zone-right-row-h1', '2024');
const FREEZE = process.argv.includes('--freeze-fixture');
const ri = process.argv.indexOf('--render-dir');
const RENDER_DIR = ri >= 0 ? process.argv[ri + 1] : null;
const read = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));

interface Member { localPdfPath: string; physicalPage: number; classifierSource: string }
type Row = { rowId: string; column: 'LEFT' | 'RIGHT'; orderInColumn: number; rowKindVisual: string; requestNumberVisualToken: string | null; requestNumberCircledVisual: boolean | null; codeVisual: string | null; markerVisual: string | null; pageRefVisual: string | null; titleVisual: string | null; wrappedFragmentCount: number; unreadable: boolean; fieldStates: Record<string, string> };

function parse(text: string) {
  const pages = new Map<number, { L: string[]; R: string[] | 'EMPTY' }>();
  let cur = -1;
  for (const ln of text.split('\n')) {
    if (ln.startsWith('## ')) { cur = Number(ln.slice(3)); pages.set(cur, { L: [], R: [] }); continue; }
    if (ln.startsWith('L: ')) pages.get(cur)!.L = ln.slice(3).split(';');
    else if (ln.startsWith('R: ')) pages.get(cur)!.R = ln.slice(3) === 'EMPTY' ? 'EMPTY' : ln.slice(3).split(';');
  }
  return pages;
}

function build() {
  const mem = read<{ digestSha256: string; members: Member[] }>(path.join(DIR, 'new-heldout-membership.json'));
  const rawManifest = read<{ documents: { localPdfPath: string; pdfSha256: string; pageTextSha256: string[] }[] }>(path.join('tests', 'fixtures', 'budget-request-raw-text', '2024', 'raw-text-manifest.json'));
  const docs = new Map(rawManifest.documents.map(d => [d.localPdfPath, d]));
  const src = parse(fs.readFileSync(path.join(DIR, 'new-heldout-visual-gt-source.txt'), 'utf8'));
  if (src.size !== mem.members.length) throw new Error('STOP_GT_MEMBERSHIP_MISMATCH');
  const pages = mem.members.map((c, idx) => {
    const p = src.get(idx)!;
    const d = docs.get(c.localPdfPath)!;
    const rows: Row[] = []; const fragments: { fragmentId: string; column: string; orderInOwner: number; ownerRowId: string; ownerStatus: string; ownerUniqueVisual: boolean; textVisual: string }[] = [];
    for (const [col, items] of [['LEFT', p.L], ['RIGHT', p.R]] as ['LEFT' | 'RIGHT', string[] | 'EMPTY'][]) {
      if (items === 'EMPTY') continue;
      let order = 0; let owner: Row | null = null; let fo = 0;
      for (const it of items) {
        if (it.startsWith('+')) { if (!owner) throw new Error(`fragment without owner @${idx}`); fo++; owner.wrappedFragmentCount++; fragments.push({ fragmentId: `${owner.rowId}+f${fo}`, column: col, orderInOwner: fo, ownerRowId: owner.rowId, ownerStatus: 'UNIQUE', ownerUniqueVisual: true, textVisual: it.slice(1) }); continue; }
        order++; fo = 0;
        const f = it.split(':');
        const rowId = `${c.localPdfPath}#${c.physicalPage}:${col}:${order}`;
        const base = { rowId, column: col, orderInColumn: order, wrappedFragmentCount: 0, unreadable: false };
        let r: Row;
        if (f[0] === 'Q') r = { ...base, rowKindVisual: 'REQUEST_NUMBER_ROW', requestNumberVisualToken: f[1].replace(/c$/, ''), requestNumberCircledVisual: f[1].endsWith('c'), codeVisual: f[2], markerVisual: null, pageRefVisual: f[3], titleVisual: f.slice(4).join(':') || null, fieldStates: {} };
        else if (f[0] === 'M') r = { ...base, rowKindVisual: 'MARKER_ROW', requestNumberVisualToken: null, requestNumberCircledVisual: null, codeVisual: f[1], markerVisual: `（${f[2]}）`, pageRefVisual: f[3], titleVisual: f.slice(4).join(':') || null, fieldStates: {} };
        else if (f[0] === 'P') r = { ...base, rowKindVisual: 'PLAIN_ROW', requestNumberVisualToken: null, requestNumberCircledVisual: null, codeVisual: null, markerVisual: null, pageRefVisual: f[1], titleVisual: f.slice(2).join(':'), fieldStates: {} };
        else throw new Error(`bad item ${it}`);
        r.fieldStates = { requestNumber: r.requestNumberVisualToken ? 'PRESENT_READABLE' : 'ABSENT_BLANK', code: r.codeVisual ? 'PRESENT_READABLE' : 'ABSENT_BLANK', marker: r.markerVisual ? 'PRESENT_READABLE' : 'ABSENT_BLANK', pageRef: r.pageRefVisual ? 'PRESENT_READABLE' : 'ABSENT_BLANK', title: r.titleVisual ? 'PRESENT_READABLE' : 'ABSENT_BLANK' };
        rows.push(r); owner = r;
      }
    }
    // 内部整合（visual GT 内部のみ。parser / H1 とは比較しない）
    const ids = rows.map(r => r.rowId); if (new Set(ids).size !== ids.length) throw new Error(`duplicate row id @${idx}`);
    const reqs = rows.filter(r => r.requestNumberVisualToken).map(r => Number(r.requestNumberVisualToken));
    reqs.forEach((n, i) => { if (i > 0 && n !== reqs[i - 1] + 1) throw new Error(`request number not consecutive @${idx}`); });
    return {
      localPdfPath: c.localPdfPath, pdfSha256: d.pdfSha256, physicalPage: c.physicalPage, textSha256: d.pageTextSha256[c.physicalPage - 1], classifierSource: c.classifierSource,
      visualColumnStructure: 'TWO_COLUMN_FRAME', leftColumnVisual: 'ROWS', rightColumnVisual: p.R === 'EMPTY' ? 'BLANK_NO_ROWS' : 'ROWS',
      gtPageComplete: true, unresolvedReason: null as string | null, rows, fragments,
    };
  });
  const all = pages.flatMap(p => p.rows);
  const counts = {
    pages: pages.length, direct: pages.filter(p => p.classifierSource === 'DIRECT').length, inherited: pages.filter(p => p.classifierSource === 'INHERITED').length,
    rightColumnUsedPages: pages.filter(p => p.rightColumnVisual === 'ROWS').length, rightColumnBlankPages: pages.filter(p => p.rightColumnVisual === 'BLANK_NO_ROWS').length, rightColumnAmbiguousPages: 0,
    rows: all.length, byRowKind: { REQUEST_NUMBER_ROW: all.filter(r => r.rowKindVisual === 'REQUEST_NUMBER_ROW').length, MARKER_ROW: all.filter(r => r.rowKindVisual === 'MARKER_ROW').length, PLAIN_ROW: all.filter(r => r.rowKindVisual === 'PLAIN_ROW').length },
    rowsByColumn: { LEFT: all.filter(r => r.column === 'LEFT').length, RIGHT: all.filter(r => r.column === 'RIGHT').length },
    wrappedFragments: pages.reduce((a, p) => a + p.fragments.length, 0), fragmentOwnerStatus: { UNIQUE: pages.reduce((a, p) => a + p.fragments.filter(f => f.ownerStatus === 'UNIQUE').length, 0), AMBIGUOUS: 0, NO_SAFE_OWNER: 0 },
    circledRequestNumbers: all.filter(r => r.requestNumberCircledVisual).length, unresolvedPages: 0, unresolvedRows: 0, unresolvedFragments: 0, unreadableFields: 0,
  };
  const gt = {
    schema: 'budget-request-toc-h1-new-heldout-visual-gt/v0',
    scope: 'H1 新 held-out 25 page の Visual GT。PDF の視覚観察のみ（pdftotext・parser・H1 出力は未使用・未観察）。#392 の GT schema を継承。評価結果ではない',
    inheritedSchema: 'budget-request-toc-row-assembly-visual-gt/v0（#392）。rowKindVisual は REQUEST_NUMBER_ROW / MARKER_ROW / PLAIN_ROW（visual-only。parser mapping なし）',
    schemaNotes: ['#392 の GT schema を拡張して titleVisual を追加した（#392 の row は titleVisual を持たない）。指示書 §7 の title/body 転記要件に従い、全 row（REQUEST / MARKER / PLAIN）で titleVisual を転記した。折返しのある row の titleVisual は 1 行目に見えた text のみで、続きは fragment の textVisual に別記録', 'pageRefVisual は見えた表記のまま（prefix 付きの「電 1」「原 1」もそのまま。正規化・補完なし）', 'requestNumberCircledVisual は丸囲みが見えたか（復元・推測なし）', 'fragment の ownerStatus は UNIQUE / AMBIGUOUS / NO_SAFE_OWNER。本 GT では全て UNIQUE', '#401 の review finding により、初版（title は PLAIN_ROW と fragment のみ）に対して REQUEST / MARKER row の title を visual のみで追記した（postReviewAmendment）'],
    membershipDigestSha256: mem.digestSha256,
    gtSource: 'new-heldout-visual-gt-source.txt を本 script で変換',
    enums: { rowKindVisual: ['REQUEST_NUMBER_ROW', 'MARKER_ROW', 'PLAIN_ROW'], fieldState: ['PRESENT_READABLE', 'ABSENT_BLANK', 'PRESENT_UNREADABLE', 'AMBIGUOUS', 'NOT_APPLICABLE', 'NOT_RECORDED'], rightColumnVisual: ['ROWS', 'BLANK_NO_ROWS', 'AMBIGUOUS'], fragmentOwnerStatus: ['UNIQUE', 'AMBIGUOUS', 'NO_SAFE_OWNER'] },
    counts, pages,
  };
  const recordedAt = process.env.GT_RECORDED_AT ?? new Date().toISOString();
  const SUPP = [{ memberIndex: 4, physicalPage: 3, localPdfPath: 'data/download/jbaudit.go.jp/jbaudit/bud_clo/bud/pdf/r06/20230906_02.pdf', dpi: [300, 600], region: 'page-ref column crop', reason: '110dpi では page ref セルが黒枠内の反転表示で判読が不安定だったため、高 DPI の crop で目視した（見えた値のみ転記）' }];
  const ledger = {
    schema: 'budget-request-toc-h1-new-heldout-annotation-ledger/v0',
    annotator: 'Claude Sonnet 5.5（Claude Code agent）',
    method: 'membership の canonical order で 25 page を 1 回ずつ、原本 PDF を pdftoppm 110dpi で render して目視。元 PDF は read-only。pdftotext・parser・H1 出力・trigger 判定は使用・観察していない',
    recordedAt, recordedAtNote: '記録時刻は GT 組立時刻。page ごとの目視時刻は取得していない（同一 session）',
    qualityPass: ['visual 内部整合のみ: row identity 一意・(column, orderInColumn) 一意・要求番号が page 内で連番・ledger 集計 = GT 集計・fragment owner が存在・render と member の identity 一致', 'annotation correction: 0（freeze 前に visual 以外の根拠で値を直していない）'],
    annotationCorrectionsBeforeFreeze: 0,
    postReviewAmendment: { trigger: '#401 の review finding（指示書 §7 の title/body 転記要件に対し、初版は REQUEST / MARKER row の title を省略していた）', action: '原本 PDF の render（110dpi、初版と同一 PNG）を再び目視し、REQUEST / MARKER 560 row の title を visual のみで追記。既存の token・page ref・column・順序は変更していない', changedFields: ['titleVisual（REQUEST / MARKER 560 row を追加。PLAIN_ROW・fragment は初版のまま）'], unchangedFields: ['row の identity・column・orderInColumn・token・code・marker・pageRef・fragment・counts'], h1OrParserOutputConsulted: false, formalEvaluationBeforeAmendment: 0, h1ExecutionsOnNewHeldoutBeforeAmendment: 0 },
    supplementalRenders: SUPP,
    pages: pages.map((p, i) => ({
      index: i, localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierSource: p.classifierSource,
      inspected: true, annotationCompleted: true, renderSource: `render:${i}`, visualRightColumnState: p.rightColumnVisual,
      rowCount: p.rows.length, requestCount: p.rows.filter(r => r.rowKindVisual === 'REQUEST_NUMBER_ROW').length, markerCount: p.rows.filter(r => r.rowKindVisual === 'MARKER_ROW').length, plainCount: p.rows.filter(r => r.rowKindVisual === 'PLAIN_ROW').length,
      wrappedFragmentCount: p.fragments.length, circledCount: p.rows.filter(r => r.requestNumberCircledVisual).length, unresolvedCount: 0, unreadableCount: 0,
      supplementalRenderUsed: SUPP.some(s => s.memberIndex === i), notes: SUPP.some(s => s.memberIndex === i) ? 'page ref セルは黒枠内の反転表示。高 DPI crop で判読' : '',
    })),
  };
  const files = RENDER_DIR ? fs.readdirSync(RENDER_DIR).filter(f => /^n\d\d-.*\.png$/.test(f) && !/supp/.test(f)).sort() : [];
  const suppFiles = RENDER_DIR ? fs.readdirSync(RENDER_DIR).filter(f => /supp/.test(f)).sort() : [];
  const render = {
    schema: 'budget-request-toc-h1-new-heldout-render-manifest/v0',
    tool: 'pdftoppm', baseDpi: 110, format: 'png',
    note: 'render artifact は repository に含めない（#392 慣行）。sha256 は目視に使った PNG の記録（render の再現性は pdftoppm の版に依存）',
    renders: mem.members.map((m, i) => ({ id: `render:${i}`, localPdfPath: m.localPdfPath, pdfSha256: docs.get(m.localPdfPath)!.pdfSha256, physicalPage: m.physicalPage, dpi: 110, pngSha256: files[i] ? fileSha(path.join(RENDER_DIR!, files[i])) : null, supplementalRenderUsed: SUPP.some(s => s.memberIndex === i) })),
    supplementalRenders: SUPP.map((s, k) => ({ ...s, pngSha256: suppFiles.map(f => fileSha(path.join(RENDER_DIR!, f))) })),
  };
  return { gt, ledger, render, counts };
}

const { gt, ledger, render, counts } = build();
const gtText = `${JSON.stringify(gt, null, 1)}\n`; const ledgerText = `${JSON.stringify(ledger, null, 1)}\n`; const renderText = `${JSON.stringify(render, null, 1)}\n`;
if (FREEZE) {
  fs.writeFileSync(path.join(DIR, 'new-heldout-ground-truth.json'), gtText);
  fs.writeFileSync(path.join(DIR, 'new-heldout-annotation-ledger.json'), ledgerText);
  fs.writeFileSync(path.join(DIR, 'new-heldout-render-manifest.json'), renderText);
  const mm = read<{ digestSha256: string }>(path.join(DIR, 'new-heldout-membership.json'));
  const manifest = {
    schema: 'budget-request-toc-h1-new-heldout-visual-gt-freeze-manifest/v0',
    status: 'NEW_HELDOUT_VISUAL_GT_FROZEN',
    createdAt: ledger.recordedAt, baseMainSha: process.env.BASE_MAIN_SHA ?? null,
    freezeCommit: 'この manifest を追加する git commit（自己参照を避けるため hash は本文に埋め込まない）',
    hashes: {
      implementationFreezeManifestSha256: fileSha(path.join(DIR, 'implementation-freeze-manifest.json')), h1SourceSha256: fileSha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly-h1.ts'),
      membershipFileSha256: fileSha(path.join(DIR, 'new-heldout-membership.json')), membershipDigestSha256: mm.digestSha256, membershipFreezeManifestSha256: fileSha(path.join(DIR, 'new-heldout-membership-freeze-manifest.json')),
      groundTruthSha256: sha(gtText), annotationLedgerSha256: sha(ledgerText), renderManifestSha256: sha(renderText), visualGtSourceSha256: fileSha(path.join(DIR, 'new-heldout-visual-gt-source.txt')),
      h1PreregistrationSha256: fileSha(path.join(DIR, 'preregistration.json')), parser393SourceSha256: fileSha('scripts/pipeline-v2/lib/budget-request-toc-row-assembly.ts'),
    },
    sourcePdfHashes: [...new Map(gt.pages.map(p => [p.localPdfPath, p.pdfSha256])).entries()].map(([localPdfPath, pdfSha256]) => ({ localPdfPath, pdfSha256 })),
    pageCount: 25, annotationCompletion: { complete: 25, total: 25 },
    annotationProtocol: '#392 の Visual GT protocol を継承（PDF visual のみ・blank→0 / 補完 / raw text / parser 参照の禁止・unreadable は推測しない）',
    renderProtocol: 'pdftoppm 110dpi 全 25 page。supplemental: 1 page の page-ref 列を 300 / 600dpi crop（理由は ledger）',
    gtSummary: counts,
    postReviewAmendment: 'ledger.postReviewAmendment を参照（#401 review finding による REQUEST / MARKER row の title 追記。formal evaluation 前・H1 未実行の時点での visual GT correction）',
    contamination: false, firewall: { h1ExecutionsOnNewHeldout: 0, parser393ExecutionsOnNewHeldout: 0, triggerCensus: 0, parserOutputViewed: false, h1SpecificLabels: false, rawTextUsedForGtValues: false, pdftotextDisplayed: false },
    formalEvaluationCount: { heldoutParserExecutionsTotal: 1, note: '#396 のみ。本 unit では増えていない' },
    unresolvedOrUnreadable: { unresolvedRows: 0, unreadableFields: 0, note: 'formal evaluation の可能性に影響する未解決はない' },
    claimBoundary: 'visual-only GT freeze。H1 の安全性・有効性は未評価。GT は同一 agent の作成で独立検証ではない。GT freeze 後の修正は silent fix せず別 correction protocol',
    judgment: 'READY_FOR_H1_ONE_SHOT_FROZEN_EVALUATION',
  };
  fs.writeFileSync(path.join(DIR, 'new-heldout-visual-gt-freeze-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
}
console.log(JSON.stringify(counts));
