/**
 * 59 項の source-side classification freeze（新規 artifact。既存 fixture は書き換えない）。
 * 22 項（F0 16 + F7 1 + F2 5）は、各所管の令和 6 年度一般会計の目次・総表（取得原本）を pdftotext で読み、MOF 項名が項の entry として exact に載っているかを確認する。
 * 37 項（drawing-path 型の法務省 35 + 金融庁 2）は text が読めないため、視覚転記（visual transcription）との照合で記録する。
 * 日本学術会議 081 は、取得原本の総表（内閣府 0.pdf）全 page の確認と、公式 index の観測（WebFetch）の記録で扱う。
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/run-budget-request-unmatched59-source-side-freeze.ts
 */
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { VISUAL_TRANSCRIPTION } from './lib/budget-request-visual-transcription';

const FX = 'tests/fixtures';
const IN = `${FX}/budget-request-unmatched-59/2024`, OUT = `${FX}/budget-request-unmatched-59-source-side/2024`;
const MC = `${FX}/budget-request-mext-continuation/2024`;
const FROZEN: Record<string, string> = {
  [`${IN}/baseline.json`]: '7f7e219245849b4dcec9a7352dfdda70eeb09f0f404047d18f5a979ff1e24bb4',
  [`${IN}/unmatched-59-inventory.jsonl.gz`]: '',
  [`${IN}/source-pdf-scan.json`]: '',
  'docs/tasks/20261006_0930_Budget_Request_Unmatched_59_Source_Failure_Inventory_Result.md': '',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const N = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
const pdfPages = (pdf: string, a: number, b: number): string[] => execFileSync('pdftotext', ['-f', String(a), '-l', String(b), '-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\f').slice(0, b - a + 1);
const pageCount = (pdf: string): number => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }))![1]);

// 所管 / 組織 → 一般会計の目次・総表を含む取得原本。表紙・目次・総表の範囲は page の title で決める（明細表の最初の page の直前まで）
const CAO0 = 'data/download/cao.go.jp/yosan/soshiki/r06/pdf/0.pdf';
const SUMMARY_SOURCES: Record<string, { pdfs: string[]; wholeDocument: boolean; officialUrl: string }> = {
  '環境省': { pdfs: ['data/download/env.go.jp/content/000157010.pdf'], wholeDocument: false, officialUrl: 'https://www.env.go.jp/content/000157010.pdf' },
  '国土交通省': { pdfs: ['data/download/mlit.go.jp/page/content/001630995.pdf'], wholeDocument: false, officialUrl: 'https://www.mlit.go.jp/page/content/001630995.pdf' },
  '防衛省': { pdfs: ['data/download/mod.go.jp/j/budget/gaisan/r6/gaisanyoukyu.pdf'], wholeDocument: false, officialUrl: 'https://www.mod.go.jp/j/budget/gaisan/r6/gaisanyoukyu.pdf' },
  '外務省': { pdfs: ['data/download/mofa.go.jp/mofaj/files/100546568.pdf'], wholeDocument: false, officialUrl: 'https://www.mofa.go.jp/mofaj/files/100546568.pdf' },
  '財務省': { pdfs: ['data/download/mof.go.jp/about_mof/mof_budget/budget/fy2024/2024ippan_2.pdf'], wholeDocument: false, officialUrl: 'https://www.mof.go.jp/about_mof/mof_budget/budget/fy2024/2024ippan_2.pdf' },
  '厚生労働省': { pdfs: ['data/download/mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf'], wholeDocument: false, officialUrl: 'https://www.mhlw.go.jp/wp/yosan/yosan/24syokan/dl/05-1b-01.pdf' },
  '経済産業省': { pdfs: ['data/download/meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf'], wholeDocument: false, officialUrl: 'https://www.meti.go.jp/main/yosangaisan/fy2024/pdf/ippan_o.pdf' },
  '文部科学省': { pdfs: ['data/download/mext.go.jp/content/20230914-mxt_kaikesou01-000031817_01.pdf', 'data/download/mext.go.jp/content/20230914-mxt_kaikesou01-000031817_02.pdf'], wholeDocument: true, officialUrl: 'https://www.mext.go.jp/content/20230914-mxt_kaikesou01-000031817_01.pdf; …_02.pdf' },
  '内閣府/内閣本府': { pdfs: [CAO0], wholeDocument: true, officialUrl: 'https://www.cao.go.jp/yosan/soshiki/r06/pdf/0.pdf' },
  '内閣府/沖縄総合事務局': { pdfs: [CAO0], wholeDocument: true, officialUrl: 'https://www.cao.go.jp/yosan/soshiki/r06/pdf/0.pdf' },
  '内閣府/日本学術会議': { pdfs: [CAO0], wholeDocument: true, officialUrl: 'https://www.cao.go.jp/yosan/soshiki/r06/pdf/0.pdf' },
  '内閣府/消費者庁': { pdfs: ['data/download/caa.go.jp/policies/budget/assets/cms_caa205_230914_03.pdf'], wholeDocument: false, officialUrl: 'https://www.caa.go.jp/policies/budget/assets/cms_caa205_230914_03.pdf' },
};
const keyOf = (m: string, org: string) => (m === '内閣府' ? `内閣府/${org}` : m);

function scopeOf(pdf: string, whole: boolean): { first: number; last: number } {
  const n = pageCount(pdf);
  if (whole) return { first: 1, last: n };
  const head = pdfPages(pdf, 1, Math.min(n, 60));
  const detail = head.findIndex(t => { const x = N(t); return x.includes('歳出概算要求額明細表') && !x.includes('・・・') && !x.includes('目次'); });
  return { first: 1, last: detail >= 0 ? detail : Math.min(n, 60) }; // detail は 0 始まり index = 直前の page 番号
}

interface Inv { mofRowId: string; mofCode: string; mofNameRaw: string; mofNameNormalized: string; mofMinistry: string; mofOrganization: string; failureClass: string; recoverabilityClass: string; evidenceRefs: unknown; exactHitsOtherAuthority: { pdfPath: string; page: number; kind: string; leftCode: { shape: string } | null; pdfAccountType: string }[] }

function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (h !== '' && fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const inv = zlib.gunzipSync(fs.readFileSync(`${IN}/unmatched-59-inventory.jsonl.gz`)).toString('utf8').trim().split('\n').map(l => JSON.parse(l) as Inv);
  const baseline = readJson<{ mofTotal: number; exactCovered: number; unmatched: number }>(`${IN}/baseline.json`);
  if (inv.length !== 59 || new Set(inv.map(r => r.mofRowId)).size !== 59 || baseline.exactCovered !== 725 || baseline.unmatched !== 59) throw new Error('59 項の identity / baseline を再現できない（STOP）');
  const scan = readJson<{ pdfs: { localPath: string; sha256: string; accountType: string; publisherAuthority: string }[] }>(`${IN}/source-pdf-scan.json`);
  const pdfMeta = new Map(scan.pdfs.map(p => [p.localPath, p]));
  const hitsAll = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${IN}/source-search-hits.json.gz`)).toString('utf8')) as { hits: Record<string, { pdfPath: string; page: number; kind: string; leftCode: { shape: string } | null }[]> };
  const mextBase = new Map(readJson<{ mextUnmatched: { mofSectionId: string; sourceClass: string }[] }>(`${MC}/baseline.json`).mextUnmatched.map(m => [m.mofSectionId, m.sourceClass]));
  const transcript = VISUAL_TRANSCRIPTION.map(v => ({ ...v, norm: N(v.itemName) }));
  const pdfPathOf: Record<string, string> = { moj: 'data/download/moj.go.jp/content/001402818.pdf', fsa: 'data/download/fsa.go.jp/common/budget/yosan/6youkyuu-2/01.pdf' };
  const rows: unknown[] = [];
  const pageCache = new Map<string, string[]>();
  const read = (pdf: string, a: number, b: number) => { const k = `${pdf}|${a}|${b}`; if (!pageCache.has(k)) pageCache.set(k, pdfPages(pdf, a, b)); return pageCache.get(k)!; };

  for (const r of inv) {
    const nm = N(r.mofNameRaw);
    const base = { mofRowId: r.mofRowId, mofAuthority: r.mofMinistry, mofOrganization: r.mofOrganization, mofItemCode: r.mofCode, mofItemName: r.mofNameRaw, previousFailureClass: r.failureClass, previousEvidenceRefs: r.evidenceRefs };
    if (r.failureClass === 'F1') {
      const vis = transcript.find(v => v.norm === nm);
      const pdf = vis ? pdfPathOf[vis.pdfId] : null;
      rows.push(sortDeep({ ...base, summaryClassification: 'SUMMARY_REPRESENTATION_BLOCKED', machineReadable: false, visualExactObserved: vis ? true : false, specialTreatment: null, officialSource: vis ? (vis.pdfId === 'moj' ? 'https://www.moj.go.jp/content/001402818.pdf' : 'https://www.fsa.go.jp/common/budget/yosan/6youkyuu-2/01.pdf') : null, sourceLocalPath: pdf, sourcePage: vis ? vis.pdfPage : null, sourceSha256: pdf ? fileSha(pdf) : null, evidenceType: vis ? 'VISUAL+MACHINE_TEXT(negative)' : 'MACHINE_TEXT(negative)',
        causeStatus: 'UNRESOLVED', visual: vis ? { visualItemCode: vis.itemCode, visualItemName: vis.itemName, tocPageRef: vis.tocPageRef, column: vis.column, organizationVisible: `${vis.organizationCode} ${vis.organizationName}` } : null, notes: 'drawing-path 型のため通常の text extraction では読めない（previous inventory）。目次の項名を視覚転記と照合。原因（当初予算との差の有無など）は評価対象外' }));
      continue;
    }
    // F0 / F7 / F2: machine-readable な一般会計の目次・総表
    const key = keyOf(r.mofMinistry, r.mofOrganization);
    const src = SUMMARY_SOURCES[key];
    if (!src) { rows.push(sortDeep({ ...base, summaryClassification: 'SUMMARY_SOURCE_COVERAGE_UNRESOLVED', machineReadable: null, visualExactObserved: null, specialTreatment: null, officialSource: null, sourceLocalPath: null, sourcePage: null, sourceSha256: null, evidenceType: 'NONE', causeStatus: 'UNRESOLVED', notes: `対応する一般会計の目次・総表の取得原本が無い（${key}）` })); continue; }
    const exact: { pdf: string; page: number; line: string }[] = [], embedded: { pdf: string; page: number; line: string }[] = [], near: { pdf: string; page: number; line: string }[] = [];
    const scopes: { pdf: string; first: number; last: number; sha256: string }[] = [];
    const stems = nm.length >= 8 ? [nm.slice(0, 6), nm.slice(-6)] : [nm];
    for (const pdf of src.pdfs) {
      const sc = scopeOf(pdf, src.wholeDocument); scopes.push({ pdf, first: sc.first, last: sc.last, sha256: fileSha(pdf) });
      const pages = read(pdf, sc.first, sc.last);
      pages.forEach((t, i) => {
        const pg = sc.first + i, nt = N(t);
        for (let at = nt.indexOf(nm); at >= 0; at = nt.indexOf(nm, at + 1)) {
          const line = t.split('\n').find(l => N(l).includes(nm.slice(0, Math.min(nm.length, 6)))) ?? '';
          (/\d{3}$/.test(nt.slice(Math.max(0, at - 3), at)) ? exact : embedded).push({ pdf, page: pg, line: line.replace(/\s+/g, ' ').trim().slice(0, 140) });
        }
        if (exact.length === 0) for (const l of t.split('\n')) { const nl = N(l); if (near.length < 4 && stems.some(s => nl.includes(s)) && !nl.includes(nm)) near.push({ pdf, page: pg, line: l.replace(/\s+/g, ' ').trim().slice(0, 140) }); }
      });
    }
    const gakujutsu = r.mofOrganization === '日本学術会議';
    const otherAccount = r.failureClass === 'F7' ? (hitsAll.hits[r.mofRowId] ?? []).filter(h => pdfMeta.get(h.pdfPath)?.accountType === 'special' && [r.mofMinistry, r.mofOrganization].includes(pdfMeta.get(h.pdfPath)?.publisherAuthority ?? '') && h.leftCode?.shape === 'plain3').map(h => `${h.pdfPath.split('/').pop()}#${h.page} (special account, left code plain3, ${h.kind})`) : null;
    const cls = exact.length > 0 ? 'EXACT_IN_GENERAL_SUMMARY' : 'NOT_EXACT_IN_GENERAL_SUMMARY';
    rows.push(sortDeep({ ...base, summaryClassification: cls, machineReadable: true, visualExactObserved: null,
      specialTreatment: gakujutsu ? '事項要求' : null,
      officialSource: src.officialUrl, sourceLocalPath: scopes.map(s => s.pdf).join('; '), sourcePage: exact.length > 0 ? exact[0].page : null, sourceSha256: scopes.map(s => s.sha256).join('; '),
      evidenceType: gakujutsu ? 'MACHINE_TEXT+OFFICIAL_INDEX' : 'MACHINE_TEXT', causeStatus: 'UNRESOLVED',
      summaryCheck: { scope: scopes.map(s => ({ path: s.pdf, pages: `${s.first}-${s.last}` })), exactEntries: exact, embeddedInLongerName: embedded, nearbyOrSimilarNames: near.map(n => `${n.pdf.split('/').pop()}#${n.page}: ${n.line}`), otherAccountExactName: otherAccount, mextPreviousIndependentCheck: mextBase.get(r.mofRowId) ?? null },
      notes: gakujutsu ? '公式 index（令和６年度歳出概算要求書）の 日本学術会議 は「事項要求」と表示され個別 PDF のリンクが無い（officialSourceObservations）。一般会計総表（0.pdf 全 25 page）に「学術会議」を含む文字列が無い。事項要求から当初予算の項になった経緯は source が説明しておらず原因は未確定' : '確認した令和６年度一般会計概算要求の目次・総表に、MOF 項名が項の entry として掲載されていない（掲載されていないことと概算要求時点に項が存在しなかったこととは同一ではない）。近い名称は観測のみで同一項とは認定しない' }));
  }
  if (rows.length !== 59) throw new Error('classification 行数が 59 でない（STOP）');
  const tally = (f: (r: Record<string, unknown>) => string) => { const m: Record<string, number> = {}; for (const r of rows as Record<string, unknown>[]) m[f(r)] = (m[f(r)] ?? 0) + 1; return m; };
  const gz = zlib.gzipSync(Buffer.from((rows as unknown[]).map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8'), { level: 9 });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/unmatched-59-source-side-classification.jsonl.gz`, gz);
  const officialObs = {
    url: 'https://www.cao.go.jp/yosan/soshiki/r06/yosangaisan_r6.html', retrievedWith: 'WebFetch（page 内容を要約・抽出する tool。内容は原文の逐語転記ではなく tool の出力）', retrievedOn: '2026-10-06',
    observed: ['page title: 令和６年度歳出概算要求書（内閣府）', '一般会計 > 概算要求書 > 表紙及び総表 → pdf/0.pdf（相対 link。取得原本 data/download/cao.go.jp/yosan/soshiki/r06/pdf/0.pdf に対応）', '個別 PDF は pdf/1.pdf … pdf/50.pdf（一般会計、51 件）', '「日本学術会議」の行には「事項要求」と表示され、PDF の link が無い（直前は 国際平和協力本部 pdf/48.pdf、直後は 官民人材交流センター pdf/49.pdf）', '「事項要求」についての説明文は page 上に無い'],
    limitations: ['WebFetch の抽出結果であり、HTML 原文そのものの保存ではない', '同じ page への 1 回目の取得では link の base URL が異なる要約が返った（相対 link を解決した URL は取得原本の canonical URL と一致する 2 回目の抽出を採用）', 'Bash からの curl は許可されなかったため HTML 原文の独立取得は未実施'],
  };
  const summaryBody = {
    schema: 'budget-request-unmatched59-source-side-classification/v0',
    note: '既存 fixture は変更せず新規に追加する source-side freeze。classification の件数は source evidence から再集計した実測値。725 / 784 を extractor recall と呼ばない',
    frozen: Object.fromEntries(Object.entries(FROZEN).map(([p]) => [p, fileSha(p)])), classificationGzSha256: sha(gz), mofTotal: baseline.mofTotal, exactCovered: baseline.exactCovered, unmatched: baseline.unmatched,
    bySummaryClassification: tally(r => String(r.summaryClassification)), byPreviousFailureClass: tally(r => String(r.previousFailureClass)), byMachineReadable: tally(r => String(r.machineReadable)), byCauseStatus: tally(r => String(r.causeStatus)),
    notExactBreakdownByPreviousClass: (() => { const m: Record<string, number> = {}; for (const r of rows as Record<string, unknown>[]) if (r.summaryClassification === 'NOT_EXACT_IN_GENERAL_SUMMARY') m[String(r.previousFailureClass)] = (m[String(r.previousFailureClass)] ?? 0) + 1; return m; })(),
    visualExactObservedCount: (rows as Record<string, unknown>[]).filter(r => r.visualExactObserved === true).length, officialSourceObservations: officialObs, pdfsReferenced: [...new Set((rows as { sourceLocalPath: string | null }[]).flatMap(r => (r.sourceLocalPath ?? '').split('; ').filter(Boolean)))].sort().map(p => ({ path: p, sha256: fileSha(p), authority: pdfMeta.get(p)?.publisherAuthority ?? null, accountType: pdfMeta.get(p)?.accountType ?? null })),
    wording: '未一致 59 項について確認した範囲では、machine-readable な令和６年度一般会計概算要求の総表・目次に MOF exact 項名が存在するにもかかわらず現行 extractor が取り逃している項は確認されなかった。これは extractor 全体の recall や 725 件側の問題の有無を意味しない（分母 784 は MOF 当初予算側の項集合で、概算要求側 source universe と同一であることは証明されていない）',
  };
  const summary = sortDeep(summaryBody) as typeof summaryBody;
  fs.writeFileSync(`${OUT}/unmatched-59-source-side-summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
  console.log(JSON.stringify({ sha: sha(gz), by: summary.bySummaryClassification, previous: summary.byPreviousFailureClass, notExact: summary.notExactBreakdownByPreviousClass, visual: summary.visualExactObservedCount }, null, 1));
}
main();
