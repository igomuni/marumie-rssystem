/**
 * 財務省「予算書・決算書データベース」年度別アーカイブの download 選定ロジック（純関数。network・fs に触れない）。
 * download-mof-archive.ts（CLI）が使う。
 *
 * アーカイブページは1つの帳票IDに複数の資料を載せる。資料の役割（source role）は次のとおり:
 *   - 科目別内訳（CSV版 / Excel版）: 項→目の科目別表
 *   - 予算書本体（PDF版 / XML版）: 事項別内訳などを含む予算書そのもの。XML版のリンク先は `*Main.html`（フレームセット）で、
 *     本文は `{id}menu.html`（目次）が列挙する `../xml/*.xml` に分割されている
 * CSV と XML は別の source role なので、片方を取ったらもう片方を捨てる関係ではない。
 */

export type ArchiveKind = 'dlpdf' | 'html' | 'excel' | 'csv';

export interface ArchiveLink {
  href: string;
  text: string;
  /** hrefの `/server/{yearDir}/{kind}/{file}` のkind部分 */
  kind: ArchiveKind;
  /** ファイル名から様式・年度接尾辞を除いた帳票ID（同一帳票の形式違いをまとめる単位） */
  reportId: string;
}

/** アーカイブページHTMLから `/server/...` へのリンクだけを抽出する */
export function extractServerLinks(html: string): ArchiveLink[] {
  const re = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const out: ArchiveLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href.startsWith('/server/')) continue;
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const parts = href.split('/'); // '', 'server', yearDir, kind, file
    const kind = parts[3] as ArchiveKind;
    const file = parts[4] ?? '';
    const reportId = file.replace(/^DL/, '').replace(/(Main)?\.(pdf|xlsx|zip|html)$/, '');
    out.push({ href, text, kind, reportId });
  }
  return out;
}

/**
 * 帳票ID単位でcsvがあればcsvのみ、無ければdlpdfのみを残す
 * （excel・htmlは常に同一内容の重複/入れ物のため除外）。既存の挙動。XML版は selectXmlDocumentLinks が別 role として扱う。
 */
export function selectLinksToDownload(links: ArchiveLink[]): ArchiveLink[] {
  const byReport = new Map<string, ArchiveLink[]>();
  for (const link of links) {
    const list = byReport.get(link.reportId) ?? [];
    list.push(link);
    byReport.set(link.reportId, list);
  }
  const selected: ArchiveLink[] = [];
  for (const group of byReport.values()) {
    const csv = group.filter(l => l.kind === 'csv');
    if (csv.length > 0) selected.push(...csv);
    else selected.push(...group.filter(l => l.kind === 'dlpdf'));
  }
  return selected;
}

/** アーカイブ上で「【XML版】」と明示された html（`*Main.html`）リンク。明示のない html は対象にしない */
export function isXmlEditionLink(link: ArchiveLink): boolean {
  return link.kind === 'html' && /Main\.html$/.test(link.href) && link.text.includes('【XML版】');
}

/** 取得を明示された帳票ID（例: `202411001`）の XML版リンクだけを返す。重複した href は1つにまとめる。指定が無ければ空 */
export function selectXmlDocumentLinks(links: ArchiveLink[], reportIds: string[]): ArchiveLink[] {
  const want = new Set(reportIds);
  const seen = new Set<string>();
  const out: ArchiveLink[] = [];
  for (const l of links) {
    if (!isXmlEditionLink(l) || !want.has(l.reportId) || seen.has(l.href)) continue;
    seen.add(l.href);
    out.push(l);
  }
  return out;
}

/** 目次 `{id}menu.html`（EUC-JP をデコード済みの文字列）の `LineOut(...,"file.xml#anchor",...)` から、本文 XML のファイル名を重複なく順に取り出す */
export function parseMenuXmlFileNames(menuHtml: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /LineOut\([^)]*?"([0-9A-Za-z_]+\.xml)(?:#[^"]*)?"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(menuHtml)) !== null) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push(m[1]);
  }
  return out;
}

/** 目次から本文 XML を1件も列挙できなければ throw する（形式変更・encoding 問題を「成功」にしない）。明示取得した帳票の目次は必ず XML を含む前提 */
export function requireMenuXmlFileNames(menuHtml: string, reportId: string): string[] {
  const names = parseMenuXmlFileNames(menuHtml);
  if (names.length === 0) throw new Error(`目次から本文XMLを1件も列挙できません（目次の形式変更または decode の問題の可能性）: ${reportId}`);
  return names;
}

/** href（`/server/2024/html/202411001Main.html`）から、同じ階層の目次 URL パス（`.../202411001menu.html`）と XML ディレクトリ（`/server/2024/xml/`）を導く */
export function xmlDocumentPaths(mainHref: string): { menuHref: string; xmlDirHref: string } {
  const m = /^(\/server\/[^/]+)\/html\/([0-9A-Za-z_]+)Main\.html$/.exec(mainHref);
  if (!m) throw new Error(`XML版の Main.html として解釈できません: ${mainHref}`);
  return { menuHref: `${m[1]}/html/${m[2]}menu.html`, xmlDirHref: `${m[1]}/xml/` };
}
