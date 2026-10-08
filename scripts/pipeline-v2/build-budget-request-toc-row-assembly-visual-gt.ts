/**
 * TOC A 層 row assembly の Visual GT fixture を、目視転記ソース（visual-gt-source.txt）から決定的に組み立てる。
 * parser は使わない。Raw Text は page identity / hash 照合にのみ使い、visual field の補完には使わない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/build-budget-request-toc-row-assembly-visual-gt.ts [--freeze-fixture] [--render-dir <dir>]
 * 出力（--freeze-fixture のとき）: ground-truth.json / annotation-ledger.json / render-manifest.json / gt-freeze-manifest.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';

const dir = path.join('tests', 'fixtures', 'budget-request-toc-row-assembly', '2024');
const FREEZE = process.argv.includes('--freeze-fixture');
const ri = process.argv.indexOf('--render-dir');
const RENDER_DIR = ri >= 0 ? process.argv[ri + 1] : null;
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const fileSha = (f: string) => sha256Hex(fs.readFileSync(f));

interface Cand { localPdfPath: string; pdfSha256: string; physicalPage: number; textSha256: string; classifierSource: string }
type Row = { rowId: string; column: 'LEFT' | 'RIGHT'; orderInColumn: number; rowKindVisual: string; requestNumberVisualToken: string | null; requestNumberCircledVisual: boolean | null; codeVisual: string | null; markerVisual: string | null; pageRefVisual: string | null; wrappedFragmentCount: number; unreadable: boolean; fieldStates: Record<string, string> };
type Frag = { fragmentId: string; column: 'LEFT' | 'RIGHT'; orderInOwner: number; ownerRowId: string; ownerUniqueVisual: boolean; textVisual: string };

function parseSource(text: string) {
  const pages = new Map<number, { L: string[]; R: string[] | 'EMPTY' }>();
  let cur = -1;
  for (const ln of text.split('\n')) {
    if (ln.startsWith('## ')) { cur = Number(ln.slice(3)); pages.set(cur, { L: [], R: [] }); continue; }
    if (ln.startsWith('L: ') || ln.startsWith('R: ')) {
      const body = ln.slice(3);
      const v = body === 'EMPTY' ? 'EMPTY' : body.split(';');
      if (ln[0] === 'L') { if (v === 'EMPTY') throw new Error('left EMPTY は未対応'); pages.get(cur)!.L = v; } else pages.get(cur)!.R = v;
    }
  }
  return pages;
}

function build() {
  const held = readJson<{ membershipDigestSha256: string; pages: Cand[] }>(path.join(dir, 'heldout-candidates.json'));
  const src = fs.readFileSync(path.join(dir, 'visual-gt-source.txt'), 'utf8');
  const parsed = parseSource(src);
  if (parsed.size !== held.pages.length) throw new Error('source page count mismatch');
  const pages = held.pages.map((c, idx) => {
    const p = parsed.get(idx)!;
    const rows: Row[] = []; const frags: Frag[] = [];
    const cols: [('LEFT' | 'RIGHT'), string[] | 'EMPTY'][] = [['LEFT', p.L], ['RIGHT', p.R]];
    for (const [col, items] of cols) {
      if (items === 'EMPTY') continue;
      let order = 0; let owner: Row | null = null; let fo = 0;
      for (const it of items) {
        if (it.startsWith('+')) {
          if (!owner) throw new Error(`fragment without owner @${idx}`);
          fo += 1; owner.wrappedFragmentCount += 1;
          frags.push({ fragmentId: `${owner.rowId}+f${fo}`, column: col, orderInOwner: fo, ownerRowId: owner.rowId, ownerUniqueVisual: true, textVisual: it.slice(1) });
          continue;
        }
        order += 1; fo = 0;
        const f = it.split(':');
        const rowId = `${c.localPdfPath}#${c.physicalPage}:${col}:${order}`;
        const base = { rowId, column: col, orderInColumn: order, wrappedFragmentCount: 0, unreadable: false } as const;
        let row: Row;
        if (f[0] === 'Q') { const circled = f[1].endsWith('c'); row = { ...base, rowKindVisual: 'REQUEST_NUMBER_ROW', requestNumberVisualToken: f[1].replace(/c$/, ''), requestNumberCircledVisual: circled, codeVisual: f[2], markerVisual: null, pageRefVisual: f[3], fieldStates: {} }; }
        else if (f[0] === 'M') row = { ...base, rowKindVisual: 'MARKER_ROW', requestNumberVisualToken: null, requestNumberCircledVisual: null, codeVisual: f[1], markerVisual: `（${f[2]}）`, pageRefVisual: f[3], fieldStates: {} };
        else if (f[0] === 'P') row = { ...base, rowKindVisual: 'PLAIN_ROW', requestNumberVisualToken: null, requestNumberCircledVisual: null, codeVisual: null, markerVisual: null, pageRefVisual: f[1], fieldStates: {} };
        else throw new Error(`bad item ${it}`);
        row.fieldStates = { requestNumber: row.requestNumberVisualToken ? 'PRESENT_READABLE' : 'ABSENT_BLANK', code: row.codeVisual ? 'PRESENT_READABLE' : 'ABSENT_BLANK', marker: row.markerVisual ? 'PRESENT_READABLE' : 'ABSENT_BLANK', pageRef: row.pageRefVisual ? 'PRESENT_READABLE' : 'ABSENT_BLANK' };
        rows.push(row); owner = row;
      }
    }
    return {
      localPdfPath: c.localPdfPath, pdfSha256: c.pdfSha256, physicalPage: c.physicalPage, textSha256: c.textSha256, classifierSource: c.classifierSource,
      visualColumnStructure: 'TWO_COLUMN_FRAME', leftColumnVisual: 'ROWS', rightColumnVisual: p.R === 'EMPTY' ? 'BLANK_NO_ROWS' : 'ROWS',
      gtPageComplete: true, unresolvedReason: null as string | null, rows, fragments: frags,
    };
  });
  const rowIds = pages.flatMap(p => p.rows.map(r => r.rowId));
  if (new Set(rowIds).size !== rowIds.length) throw new Error('row id duplicate');
  const counts = { pages: pages.length, rows: rowIds.length, byRowKind: { REQUEST_NUMBER_ROW: 0, MARKER_ROW: 0, PLAIN_ROW: 0 } as Record<string, number>, rowsByColumn: { LEFT: 0, RIGHT: 0 }, wrappedFragments: pages.reduce((a, p) => a + p.fragments.length, 0), circledRequestNumbers: 0, rightColumnBlankPages: pages.filter(p => p.rightColumnVisual === 'BLANK_NO_ROWS').length, rightColumnUsedPages: pages.filter(p => p.rightColumnVisual === 'ROWS').length, unresolvedPages: 0, unresolvedRows: 0, unresolvedFragments: 0, unreadableFields: 0 };
  for (const p of pages) for (const r of p.rows) { counts.byRowKind[r.rowKindVisual] += 1; counts.rowsByColumn[r.column] += 1; if (r.requestNumberCircledVisual) counts.circledRequestNumbers += 1; }
  const gt = {
    schema: 'budget-request-toc-row-assembly-visual-gt/v0',
    scope: 'HELDOUT_CANDIDATE 23 page の Visual GT。PDF の視覚観察のみ（Raw Text は identity/hash 照合のみ）。parser 未使用。評価結果ではない',
    membershipDigestSha256: held.membershipDigestSha256,
    gtSource: 'visual-gt-source.txt を本 script で変換',
    enums: { rowKindVisual: ['REQUEST_NUMBER_ROW', 'MARKER_ROW', 'PLAIN_ROW'], fieldState: ['PRESENT_READABLE', 'ABSENT_BLANK', 'PRESENT_UNREADABLE', 'AMBIGUOUS', 'NOT_APPLICABLE'], rightColumnVisual: ['ROWS', 'BLANK_NO_ROWS', 'UNRESOLVED'] },
    notes: ['rowKindVisual は見た目上の形式のみ（階層 semantics を持たない）。PLAIN_ROW = 要求番号・marker を持たず page ref を持つ行', 'requestNumberVisualToken は見えた数字、requestNumberCircledVisual は丸囲みが見えたか（style を復元・推測していない）', 'codeVisual は行内に見えた code（NN-NN / 3 桁 / 1〜2 桁）を文字列のまま', 'pageRefVisual は見えた page 表記を文字列のまま（正規化・補完なし）', 'fragment の ownerUniqueVisual は visual の連続性で判定（parser の直前 row rule を根拠にしていない）'],
    counts, pages,
  };
  const recordedAt = process.env.GT_RECORDED_AT ?? new Date().toISOString();
  const ledger = {
    schema: 'budget-request-toc-row-assembly-annotation-ledger/v0',
    annotator: 'Claude Sonnet 5.5（Claude Code agent）',
    method: 'pdftoppm 110dpi で対象 page を render し目視。元 PDF は read-only。Raw Text・parser は visual field の補完に未使用',
    recordedAt,
    recordedAtNote: '記録時刻は GT 組立時の時刻。page ごとの目視時刻は取得していない（同一 session 内）',
    selfChecks: ['visual 内部整合のみ: 要求番号が各 page で連番（欠落 0）、page ref が page 内で非減少（page 内で左 → 右の順）。Raw Text との照合は行っていない'],
    pages: pages.map((p, i) => ({ index: i, localPdfPath: p.localPdfPath, pdfSha256: p.pdfSha256, physicalPage: p.physicalPage, textSha256: p.textSha256, classifierSource: p.classifierSource, inspected: true, gtComplete: p.gtPageComplete, unresolvedReason: p.unresolvedReason, rows: p.rows.length, fragments: p.fragments.length, renderArtifact: `render:${i}`, annotator: 'Claude Sonnet 5.5' })),
    newVisualRiskObservations: [
      'right column が marker row（項）から始まる page がある（左 column の最終 request row の続きの項）。GT 記録のみで rule は変更しない',
      '要求番号セルに丸囲み数字が現れる行が一部の page にある。丸囲みは見えた表現として requestNumberCircledVisual に記録（style の復元・推測なし）',
      'page ref セルに罫線ボックスが見える page がある（mof 2 page）。page ref の読みには影響しない',
    ],
    candidateReplacements: 0,
  };
  const render = (() => {
    const files = RENDER_DIR ? fs.readdirSync(RENDER_DIR).filter(f => /^c\d\d-.*\.png$/.test(f)).sort() : [];
    return {
      schema: 'budget-request-toc-row-assembly-render-manifest/v0',
      tool: 'pdftoppm', resolutionDpi: 110, format: 'png',
      note: 'render artifact は repository に含めない。sha256 は目視に使った PNG の記録（render の再現性は pdftoppm の版に依存）',
      renders: held.pages.map((c, i) => ({ id: `render:${i}`, localPdfPath: c.localPdfPath, physicalPage: c.physicalPage, pngSha256: files[i] ? fileSha(path.join(RENDER_DIR!, files[i])) : null })),
    };
  })();
  return { gt, ledger, render, counts };
}

function main() {
  const { gt, ledger, render, counts } = build();
  const gtText = `${JSON.stringify(gt, null, 1)}\n`;
  const ledgerText = `${JSON.stringify(ledger, null, 1)}\n`;
  const renderText = `${JSON.stringify(render, null, 1)}\n`;
  if (FREEZE) {
    fs.writeFileSync(path.join(dir, 'ground-truth.json'), gtText);
    fs.writeFileSync(path.join(dir, 'annotation-ledger.json'), ledgerText);
    fs.writeFileSync(path.join(dir, 'render-manifest.json'), renderText);
    const held = readJson<{ membershipDigestSha256: string; frozenInput: Record<string, string>; pages: Cand[] }>(path.join(dir, 'heldout-candidates.json'));
    const pre = readJson<{ integrity: { createdAt: string; baseMainSha: string; frozenInput: Record<string, string> } }>(path.join(dir, 'preregistration.json'));
    const manifest = {
      schema: 'budget-request-toc-row-assembly-gt-freeze-manifest/v0',
      status: 'GT_FROZEN',
      gtSchemaVersion: 'budget-request-toc-row-assembly-visual-gt/v0',
      createdAt: ledger.recordedAt,
      baseMainSha: process.env.GT_BASE_MAIN_SHA ?? null,
      dependency: { pr391HeadSha: '66fbb6a8f263b437df29e2214c3acb3d744e2b8d', preregistrationCreatedAt: pre.integrity.createdAt },
      membershipDigestSha256: held.membershipDigestSha256,
      sha256: {
        preregistration: fileSha(path.join(dir, 'preregistration.json')),
        heldoutCandidates: fileSha(path.join(dir, 'heldout-candidates.json')),
        visualGtSource: fileSha(path.join(dir, 'visual-gt-source.txt')),
        groundTruth: sha256Hex(gtText),
        annotationLedger: sha256Hex(ledgerText),
        renderManifest: sha256Hex(renderText),
      },
      frozenInput: pre.integrity.frozenInput,
      sourcePdfHashes: [...new Map(held.pages.map(c => [c.localPdfPath, c.pdfSha256])).entries()].map(([localPdfPath, pdfSha256]) => ({ localPdfPath, pdfSha256 })),
      counts,
      claimBoundary: 'GT freeze のみ。parser・評価は未実施。GT 誤りは silent fix せず別 correction protocol / 研究単位で扱う。candidate は目視により held-out GT evidence になった（以後 development tuning に使わない）',
      judgment: 'READY_FOR_TOC_ROW_ASSEMBLY_IMPLEMENTATION',
    };
    fs.writeFileSync(path.join(dir, 'gt-freeze-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  }
  console.log(JSON.stringify(counts, null, 1));
}
main();
