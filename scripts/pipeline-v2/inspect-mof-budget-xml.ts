/**
 * MOF 予算書【XML版】の source / schema inventory（research / inspection 用。production parser ではない）。
 * 対象: FY2024 一般会計 当初予算 `202411001` の取得済み原本（PR #369 の V2 downloader が公式から取得した byte 列）。
 * 入力は data/download の原本（読み取りのみ）と、あれば download provenance（data/work/mof-xml-download）。network 不要・決定的。
 * 意味（どの tag が項・事項か）は決め打ちせず、構造の観測 → 事項表の観測 → 階層の再現可能性の順に数える。
 *
 * 使い方: npx tsx scripts/pipeline-v2/inspect-mof-budget-xml.ts
 * 出力: tests/fixtures/mof-budget-xml-inventory/2024/202411001-{source-inventory,structure-summary}.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { nodeBudgetRequestFs } from './lib/budget-request-download';
import { collectPathStats, deepText, isNode, parseXml, structureSignature, type XmlNode } from './lib/mof-budget-xml-inspect';
import { parseMenuXmlFileNames } from './lib/mof-archive-download';

const ROOT = path.join('data', 'download', 'mof.go.jp', 'archive', '2024', '2024');
const XML_DIR = path.join(ROOT, 'xml');
const MENU = path.join(ROOT, 'html', '202411001menu.html');
const MAIN = path.join(ROOT, 'html', '202411001Main.html');
const PROVENANCE = path.join('data', 'work', 'mof-xml-download', '2024', '202411001.json');
const OUT_DIR = path.join('tests', 'fixtures', 'mof-budget-xml-inventory', '2024');
const JIKOU_TITLE = '〔組織別事項別内訳〕';
const titleOfRoot = (root: XmlNode) => { const t = root.children.filter(isNode).find(c => c.name === 'title_for_list'); return t ? deepText(t).trim() : ''; };

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const kids = (n: XmlNode, name: string) => n.children.filter(isNode).filter(c => c.name === name);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedEntries = <T>(m: Map<string, T>) => [...m.entries()].sort(([a], [b]) => cmp(a, b));
const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

/** clm の表示テキスト: <l> ごとの行を改行 `\n` で連結（行の区切りだけを保持。空白は触らない） */
function cellLines(c: XmlNode): string[] {
  return kids(c, 'p').flatMap(p => kids(p, 'l')).map(l => deepText(l));
}

interface Cell { col: string; lines: string[]; joined: string; hasGaiji: boolean; hasQt: boolean }
interface Row { key: string; page: number; row: number; cells: Map<string, Cell> }

const ID_RE = /^p(\d+)-(\d+)\.(\d+)-(\d+)\.(\d+)$/;

async function main() {
  const t0 = process.argv.includes('--quiet');
  void t0;
  // ---- P0: raw source freeze / integrity ----
  if (!fs.existsSync(MAIN) || !fs.existsSync(MENU)) throw new Error('Main/menu HTML が無い');
  const files = fs.readdirSync(XML_DIR).filter(f => f.endsWith('.xml')).sort(cmp);
  const menuNames = parseMenuXmlFileNames(new TextDecoder('euc-jp').decode(fs.readFileSync(MENU)));
  const menuSet = new Set(menuNames);
  const localSet = new Set(files);
  const missing = menuNames.filter(n => !localSet.has(n));
  const extra = files.filter(f => !menuSet.has(f));
  const prov = fs.existsSync(PROVENANCE) ? (JSON.parse(fs.readFileSync(PROVENANCE, 'utf8')) as { files: { url: string; sha256: string; bytes: number }[] }) : null;
  const provByName = new Map((prov?.files ?? []).map(f => [path.basename(f.url), f]));

  const inventory: Record<string, unknown>[] = [];
  const parsed = new Map<string, { root: XmlNode; decl: { version: string | null; encoding: string | null } | null }>();
  const sigMap = new Map<string, { sig: string; files: string[] }>();
  const pathAgg = new Map<string, { files: number; nodes: number; attrNames: Map<string, number>; withOwnText: number }>();
  let provMismatch = 0;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(XML_DIR, f));
    const text = new TextDecoder('shift_jis').decode(buf);
    const x = parseXml(text);
    parsed.set(f, { root: x.root, decl: x.declaration });
    const hash = sha256(buf);
    const pv = provByName.get(f);
    if (pv && (pv.sha256 !== hash || pv.bytes !== buf.length)) provMismatch++;
    const stylesheet = x.processingInstructions.find(p => p.startsWith('xml-stylesheet')) ?? null;
    inventory.push({
      filename: f, sourceUrl: pv?.url ?? null, bytes: buf.length, sha256: hash,
      xmlDeclaration: x.declaration, encoding: x.declaration?.encoding ?? null, root: x.root.name,
      doctype: x.doctype, stylesheet: stylesheet ? /href="([^"]+)"/.exec(stylesheet)?.[1] ?? stylesheet : null,
    });
    const st = collectPathStats(x.root);
    const sigText = structureSignature(st);
    const sigId = sha256(Buffer.from(sigText)).slice(0, 8);
    const e = sigMap.get(sigId) ?? { sig: sigText, files: [] };
    e.files.push(f);
    sigMap.set(sigId, e);
    for (const [p, s] of st) {
      const a = pathAgg.get(p) ?? { files: 0, nodes: 0, attrNames: new Map<string, number>(), withOwnText: 0 };
      a.files++; a.nodes += s.nodes; a.withOwnText += s.withOwnText;
      for (const [an, c] of Object.entries(s.attrNames)) inc(a.attrNames, an, c);
      pathAgg.set(p, a);
    }
  }
  const totalBytes = (inventory as { bytes: number }[]).reduce((n, r) => n + r.bytes, 0);
  const sourceInventory = {
    schema: 'mof-budget-xml-source-inventory/v0',
    scope: 'FY2024 一般会計 当初予算 202411001（research / inspection。production schema ではない）',
    main: { path: MAIN, bytes: fs.statSync(MAIN).size, sha256: sha256(fs.readFileSync(MAIN)) },
    menu: { path: MENU, bytes: fs.statSync(MENU).size, sha256: sha256(fs.readFileSync(MENU)), enumeratedXmlFiles: menuNames.length },
    xml: { localFiles: files.length, totalBytes, menuMissingLocally: missing, localNotInMenu: extra, duplicatesInMenuList: menuNames.length - menuSet.size },
    provenance: prov ? { present: true, manifestSha256: sha256(fs.readFileSync(PROVENANCE)), files: prov.files.length, hashOrBytesMismatch: provMismatch } : { present: false },
    files: inventory,
  };

  // ---- メニュー（目次）の階層と XML の関係 ----
  const menuText = new TextDecoder('euc-jp').decode(fs.readFileSync(MENU));
  const entries: { level: number; hasChild: number; title: string; file: string | null }[] = [];
  for (const m of menuText.matchAll(/LineOut\((\d+),(\d+),"([^"]*)","([^"]*)","[^"]*"\)/g)) {
    const link = m[4].replace(/#.*/, '');
    entries.push({ level: Number(m[1]), hasChild: Number(m[2]), title: m[3], file: /^[0-9A-Za-z_]+\.xml$/.test(link) ? link : null });
  }
  const chain: string[] = [];
  const chainByFile = new Map<string, Set<string>>();
  const entriesPerFile = new Map<string, number>();
  for (const e of entries) {
    chain.length = e.level - 1;
    chain[e.level - 1] = e.title;
    if (e.file) { inc(entriesPerFile, e.file); const s = chainByFile.get(e.file) ?? new Set<string>(); s.add(chain.join(' > ')); chainByFile.set(e.file, s); }
  }

  // ---- P1: 構造 inventory ----
  const titleOfFile = new Map(files.map(f => [f, titleOfRoot(parsed.get(f)!.root)] as const));
  const fingerprints = [...sigMap.entries()].sort(([, a], [, b]) => cmp(a.files[0], b.files[0])).map(([id, v]) => {
    const t = new Map<string, number>();
    v.files.forEach(f => inc(t, titleOfFile.get(f)!));
    return { fingerprint: id, files: v.files.length, firstFiles: v.files.slice(0, 3), pathCount: v.sig.split('\n').length, titleForList: sortedEntries(t).map(([k, n]) => ({ title: k, files: n })) };
  });
  // 事項表 94 ファイルが属する fingerprint と、最多 fingerprint との path 集合の差（意味を付けない構造差のみ）
  const jikouFp = new Map<string, string[]>();
  for (const [id, v] of sigMap) { const j = v.files.filter(f => titleOfFile.get(f) === JIKOU_TITLE); if (j.length > 0) jikouFp.set(id, j); }
  const topId = [...jikouFp.entries()].sort(([, a], [, b]) => b.length - a.length)[0][0];
  const pathSet = (id: string) => new Set(sigMap.get(id)!.sig.split('\n').map(l => l.replace(/\[.*\]$/, '')));
  const topPaths = pathSet(topId);
  const jikouFingerprints = [...jikouFp.entries()].map(([id, fl]) => ({ fingerprint: id, files: fl.length, firstFile: fl[0], pathsMissingVsMostCommon: [...topPaths].filter(p => !pathSet(id).has(p)).sort(cmp), pathsExtraVsMostCommon: [...pathSet(id)].filter(p => !topPaths.has(p)).sort(cmp) }));
  const pathStats = sortedEntries(pathAgg).map(([p, a]) => ({ path: p, files: a.files, nodes: a.nodes, attrNames: Object.fromEntries([...a.attrNames.entries()].sort(([x], [y]) => cmp(x, y))), withOwnText: a.withOwnText }));
  const titleOf = (root: XmlNode) => { const t = kids(root, 'title_for_list')[0]; return t ? deepText(t).trim() : ''; };
  const byTitle = new Map<string, number>();
  const headerLabelByTitle = new Map<string, Set<string>>();
  const jikouLabelWhere = new Map<string, { filesWithHeaderLabel: number; headerLabelFiles: string[] }>();
  for (const f of files) {
    const root = parsed.get(f)!.root;
    const t = titleOf(root);
    inc(byTitle, t);
    const tables = kids(root, 'body').flatMap(b => kids(b, 'table'));
    const hdr = tables.flatMap(tb => kids(tb, 'header').flatMap(h => kids(h, 'clm'))).map(c => cellLines(c).join('').replace(/\s+/g, ''));
    const set = headerLabelByTitle.get(t) ?? new Set<string>();
    hdr.forEach(l => set.add(l));
    headerLabelByTitle.set(t, set);
    if (hdr.includes('事項')) { const j = jikouLabelWhere.get(t) ?? { filesWithHeaderLabel: 0, headerLabelFiles: [] }; j.filesWithHeaderLabel++; if (j.headerLabelFiles.length < 2) j.headerLabelFiles.push(f); jikouLabelWhere.set(t, j); }
  }
  const idFormMismatch = { clm: 0, total: 0 };
  for (const f of files) for (const c of (function* walk(n: XmlNode): Generator<XmlNode> { if (n.name === 'clm') yield n; for (const k of n.children) if (isNode(k)) yield* walk(k); })(parsed.get(f)!.root)) { idFormMismatch.total++; if (!ID_RE.test(c.attrs.id ?? '')) idFormMismatch.clm++; }

  // ---- P2/P3: 〔組織別事項別内訳〕 の事項表 ----
  const jikouFiles = files.filter(f => titleOf(parsed.get(f)!.root) === JIKOU_TITLE);
  const rowClasses = new Map<string, number>();
  const exceptions: string[] = [];
  const headerLayouts = new Map<string, string[]>();
  let kouCount = 0, jikouCount = 0, subtotalRows = 0, descOnlyRows = 0, orgCells = 0, tableCount = 0;
  const orgChecks = { runningTitleForm: { ministryPrefixPlusOrg: 0, bare: 0 }, firstRowOrgCellEqualsRunningTitleOrgPart: 0, differs: [] as string[], ministryNames: new Set<string>(), distinctRunningTitles: 0 };
  const kouOrderFiles = new Set<string>();
  const runningTitles = new Set<string>();
  const kouCodeChecks = { numeric3: 0, notNumeric3: 0, nonIncreasingWithinFile: 0, duplicateWithinFile: 0 };
  const jikouCodeForm = new Map<string, number>();
  const amountForm = new Map<string, number>();
  const amountBlank = { col6: 0, col8: 0, col10: 0 };
  const text = { jikouNames: 0, multiLine: 0, withInnerSpace: 0, withFullwidthSpace: 0, withGaiji: 0, withQt: 0, halfwidthAscii: 0, kouNames: 0, kouMultiLine: 0, kouWithInnerSpace: 0, kouWithGaiji: 0 };
  const jikouNameCount = new Map<string, number>();
  const kouNameCount = new Map<string, number>();
  const docOrderChecks = { filesChecked: 0, notAscending: 0, rowsOnNewPageStartWithKou: 0, pageFirstRows: 0 };
  const assignment = { jikouWithPrecedingKouInFile: 0, jikouWithoutPrecedingKou: 0, kouRowsAlsoCarryJikou: 0, kouRowWithoutJikou: 0 };
  const menuChainOrg = { fileHasMenuChain: 0, chainContainsRunningTitle: 0 };
  const examples: unknown[] = [];

  for (const f of jikouFiles) {
    const root = parsed.get(f)!.root;
    const rt = kids(root, 'running_title')[0];
    const orgName = rt ? deepText(rt).trim() : '';
    runningTitles.add(orgName);
    const chains = [...(chainByFile.get(f) ?? [])];
    const rtm = /^(.+?所管)\s{2}(.+)$/.exec(orgName);
    const rtOrg = rtm ? rtm[2] : orgName;
    if (rtm) { orgChecks.runningTitleForm.ministryPrefixPlusOrg++; orgChecks.ministryNames.add(rtm[1]); } else orgChecks.runningTitleForm.bare++;
    if (chains.length > 0) { menuChainOrg.fileHasMenuChain++; if (chains.some(c => c.split(' > ').includes(rtOrg))) menuChainOrg.chainContainsRunningTitle++; }
    for (const b of kids(root, 'body')) for (const tb of kids(b, 'table')) {
      tableCount++;
      const hdr = kids(tb, 'header').flatMap(h => kids(h, 'clm')).map(c => `${(c.attrs.id ?? '').replace(/^p\d+-\d+\./, '')}=${cellLines(c).join('').replace(/\s+/g, '')}`).join('|');
      const hl = headerLayouts.get(hdr) ?? []; hl.push(f); headerLayouts.set(hdr, hl);
      const rows = new Map<string, Row>();
      const order: string[] = [];
      for (const d of kids(tb, 'data')) for (const c of kids(d, 'clm')) {
        const m = ID_RE.exec(c.attrs.id ?? '');
        if (!m) { exceptions.push(`${f}: clm id 形式外 ${c.attrs.id}`); continue; }
        const key = `p${m[1]}-${m[2]}.${m[3]}`;
        let r = rows.get(key);
        if (!r) { r = { key, page: Number(m[1]), row: Number(m[2]), cells: new Map() }; rows.set(key, r); order.push(key); }
        const col = `${m[4]}.${m[5]}`;
        if (r.cells.has(col)) exceptions.push(`${f}: 同一行・同一列に複数セル ${key} ${col}`);
        const lines = cellLines(c);
        const cl = c.children.length;
        void cl;
        r.cells.set(col, { col, lines, joined: lines.join(''), hasGaiji: JSON.stringify(c).includes('"gaiji"'), hasQt: JSON.stringify(c).includes('"qt"') });
      }
      docOrderChecks.filesChecked++;
      const keys = order.map(k => rows.get(k)!);
      if (keys.some((r, i) => i > 0 && (r.page < keys[i - 1].page || (r.page === keys[i - 1].page && r.row <= keys[i - 1].row)))) { docOrderChecks.notAscending++; exceptions.push(`${f}: 文書順と (page,row) の昇順が一致しない`); }

      let currentKou: { code: string; name: string } | null = null;
      let lastKouCode = -1;
      const seenKou = new Set<string>();
      let prevPage = -1;
      keys.forEach((r, idx) => {
        const has = (c: string) => r.cells.has(c) && r.cells.get(c)!.joined.trim() !== '';
        const colKey = [...r.cells.keys()].sort(cmp).join(',');
        let cls: string;
        if (has('4.2') && !has('5.1')) cls = 'subtotal-row(4.2)';
        else if (r.cells.size === 1 && has('11.1')) cls = 'description-only-row(11.1)';
        else if (has('5.1')) cls = has('2.1') ? (has('1.1') ? 'org+kou+jikou-row' : 'kou+jikou-row') : 'jikou-row';
        else cls = `unclassified(${colKey})`;
        inc(rowClasses, cls);
        if (cls.startsWith('unclassified')) exceptions.push(`${f}: 未分類の行 ${r.key} cols=${colKey}`);
        if (r.page !== prevPage) { docOrderChecks.pageFirstRows++; if (cls.includes('kou')) docOrderChecks.rowsOnNewPageStartWithKou++; prevPage = r.page; }
        if (has('1.1')) { orgCells++; const v = r.cells.get('1.1')!.joined.trim(); if (v === rtOrg) orgChecks.firstRowOrgCellEqualsRunningTitleOrgPart++; else orgChecks.differs.push(`${f}: col1='${v}' running_title='${orgName}'`); if (idx !== 0) exceptions.push(`${f}: 組織セルが先頭行以外にある ${r.key}`); }
        if (has('2.1') || has('3.1')) {
          kouCount++;
          const code = r.cells.get('2.1')?.joined.trim() ?? '';
          const nm = r.cells.get('3.1');
          if (/^\d{3}$/.test(code)) { kouCodeChecks.numeric3++; const n = Number(code); if (n <= lastKouCode) { kouCodeChecks.nonIncreasingWithinFile++; kouOrderFiles.add(f); } lastKouCode = n; } else kouCodeChecks.notNumeric3++;
          if (seenKou.has(code)) kouCodeChecks.duplicateWithinFile++;
          seenKou.add(code);
          if (nm) {
            text.kouNames++; if (nm.lines.length > 1) text.kouMultiLine++; if (/[ 　]/.test(nm.joined.trim())) text.kouWithInnerSpace++; if (nm.hasGaiji) text.kouWithGaiji++;
            inc(kouNameCount, nm.joined.trim());
          } else exceptions.push(`${f}: 項コードはあるが項名セルが無い ${r.key}`);
          currentKou = { code, name: nm?.joined.trim() ?? '' };
          if (!has('5.1')) assignment.kouRowWithoutJikou++; else assignment.kouRowsAlsoCarryJikou++;
        }
        if (has('5.1')) {
          jikouCount++;
          if (currentKou) assignment.jikouWithPrecedingKouInFile++; else { assignment.jikouWithoutPrecedingKou++; exceptions.push(`${f}: 項より前に事項行 ${r.key}`); }
          const nm = r.cells.get('5.1')!;
          text.jikouNames++; if (nm.lines.length > 1) text.multiLine++; if (/[  ]/.test(nm.joined.trim())) text.withInnerSpace++; if (/　/.test(nm.joined.trim())) text.withFullwidthSpace++;
          if (nm.hasGaiji) text.withGaiji++; if (nm.hasQt) text.withQt++; if (/[\x21-\x7e]/.test(nm.joined)) text.halfwidthAscii++;
          inc(jikouNameCount, nm.joined.trim());
          const c4 = r.cells.get('4.1')?.joined.trim() ?? '';
          inc(jikouCodeForm, /^\d{2}$/.test(c4) ? '2桁数字' : c4 === '' ? '空' : `その他:${c4.length}字`);
          for (const [col, key] of [['6.1', 'col6'], ['8.1', 'col8'], ['10.1', 'col10']] as const) {
            const v = r.cells.get(col)?.joined.trim() ?? '';
            if (v === '') amountBlank[key]++;
            else inc(amountForm, `${col}:${v.replace(/\d/g, '9').replace(/9+(,9{3})*/g, 'N')}`);
          }
          if (examples.length < 6 && idx < 5) examples.push({ file: f, row: r.key, kou: currentKou, cells: Object.fromEntries([...r.cells.entries()].map(([k, v]) => [k, v.lines])) });
        }
        if (cls === 'subtotal-row(4.2)') subtotalRows++;
        if (cls === 'description-only-row(11.1)') descOnlyRows++;
      });
    }
  }
  orgChecks.distinctRunningTitles = runningTitles.size;
  const dup = (m: Map<string, number>) => [...m.values()].filter(v => v > 1).length;

  const summary = {
    schema: 'mof-budget-xml-structure-summary/v0',
    scope: 'FY2024 一般会計 当初予算 202411001。観測のみ（意味は決め打ちしない。normalization・production schema は決めない）',
    xmlFiles: files.length,
    structure: {
      declarations: { distinct: [...new Set(inventory.map(r => JSON.stringify([r.xmlDeclaration, r.root, r.doctype])))].length, encodingValues: [...new Set(inventory.map(r => r.encoding))], rootValues: [...new Set(inventory.map(r => r.root))], doctypeValues: [...new Set(inventory.map(r => r.doctype))], stylesheetFiles: inventory.filter(r => r.stylesheet).length },
      elementPathCount: pathStats.length, fingerprintCount: fingerprints.length, fingerprints, pathStats,
      clmIdFormMismatch: idFormMismatch,
      titleForList: sortedEntries(byTitle).map(([t, n]) => ({ title: t, files: n })).sort((a, b) => b.files - a.files || cmp(a.title, b.title)),
      menu: { entries: entries.length, entriesWithXml: entries.filter(e => e.file).length, distinctXml: new Set(entries.filter(e => e.file).map(e => e.file)).size, filesLinkedByMultipleEntries: [...entriesPerFile.values()].filter(v => v > 1).length, maxEntriesPerFile: Math.max(...entriesPerFile.values()) },
    },
    jikouTableFingerprints: jikouFingerprints,
    jikouLabelOccurrences: { headerLabel事項ByTitle: sortedEntries(jikouLabelWhere).map(([t, v]) => ({ title: t, ...v })) },
    jikouTables: {
      files: jikouFiles.length, tables: tableCount,
      headerLayouts: sortedEntries(headerLayouts).map(([h, fs2]) => ({ header: h, files: fs2.length, firstFile: fs2[0] })),
      rowClasses: sortedEntries(rowClasses).map(([k, v]) => ({ class: k, rows: v })),
      counts: { kouStartRows: kouCount, jikouRows: jikouCount, subtotalRows, descriptionOnlyRows: descOnlyRows, orgCells },
      organization: { ...orgChecks, ministryNames: [...orgChecks.ministryNames].sort(cmp), menuAncestorChain: menuChainOrg },
      kou: { codeChecks: { ...kouCodeChecks, filesWithNonIncreasingCodeOrder: kouOrderFiles.size }, uniqueCodeNamePairs: kouNameCount.size, namesAppearingInMultipleKouRows: dup(kouNameCount) },
      jikou: { codeCellForm: [...jikouCodeForm.entries()], uniqueNames: jikouNameCount.size, namesAppearingMoreThanOnce: dup(jikouNameCount) },
      assignment, docOrderChecks,
      amounts: { blankByColumn: amountBlank, forms: sortedEntries(amountForm).map(([k, v]) => ({ form: k, rows: v })) },
      text,
      examples,
      exceptions,
    },
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  nodeBudgetRequestFs.writeAtomic(path.join(OUT_DIR, '202411001-source-inventory.json'), Buffer.from(`${JSON.stringify(sourceInventory, null, 2)}\n`, 'utf8'));
  nodeBudgetRequestFs.writeAtomic(path.join(OUT_DIR, '202411001-structure-summary.json'), Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, 'utf8'));
  console.log(JSON.stringify({ xml: sourceInventory.xml, provenance: sourceInventory.provenance, fingerprints: fingerprints.length, jikou: summary.jikouTables.counts, rowClasses: summary.jikouTables.rowClasses, exceptions: exceptions.length }, null, 1));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
