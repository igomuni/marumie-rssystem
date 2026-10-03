import { describe, expect, it } from 'vitest';
import { extractServerLinks, isXmlEditionLink, parseMenuXmlFileNames, requireMenuXmlFileNames, selectLinksToDownload, selectXmlDocumentLinks, xmlDocumentPaths } from './mof-archive-download';

// 実アーカイブページの形（令和6年度 一般会計 当初予算）を模した fixture。network には依存しない
const HTML = `
<ul>
<li><a href="/server/2024/dlpdf/DL202411001.pdf" target="_blank">一般会計 当初予算【PDF版】（PDF／3719KB）<span>x</span></a></li>
<li><a href="/server/2024/html/202411001Main.html" target="_blank">一般会計 当初予算【XML版】<span>x</span></a></li>
<li><a href="/server/2024/excel/DL202411001.xlsx">一般会計 歳入予算明細書及び歳出予定経費要求書(科目別内訳)【Excel版】</a></li>
<li><a href="/server/2024/csv/DL202411001.zip">一般会計 歳入予算明細書及び歳出予定経費要求書(科目別内訳)【CSV版】</a></li>
<li><a href="/server/2024/dlpdf/DL202477001.pdf">一般会計 歳出決算報告書【PDF版】</a></li>
<li><a href="/server/2024/html/202477001Main.html">一般会計 歳出決算報告書【XML版】</a></li>
<li><a href="/server/2024/html/20247A001Main.html">何らかの html（XML版の表記なし）</a></li>
<li><a href="/other/page.html">対象外</a></li>
</ul>`;
const links = extractServerLinks(HTML);

describe('MOF archive link classification', () => {
  it('kind と reportId を分類し、/server/ 以外を除く', () => {
    expect(links.map(l => [l.kind, l.reportId])).toEqual([['dlpdf', '202411001'], ['html', '202411001'], ['excel', '202411001'], ['csv', '202411001'], ['dlpdf', '202477001'], ['html', '202477001'], ['html', '20247A001']]);
  });
  it('XML版 は 【XML版】表記の Main.html だけで、PDF・CSV と取り違えない', () => {
    expect(links.filter(isXmlEditionLink).map(l => l.href)).toEqual(['/server/2024/html/202411001Main.html', '/server/2024/html/202477001Main.html']);
  });
});

describe('既存の CSV 選定は変わらない', () => {
  it('csv がある帳票は csv のみ、無ければ dlpdf のみ。html・excel は選ばない', () => {
    expect(selectLinksToDownload(links).map(l => l.href)).toEqual(['/server/2024/csv/DL202411001.zip', '/server/2024/dlpdf/DL202477001.pdf']);
  });
});

describe('XML は別 role として共存する', () => {
  it('指定が無ければ XML は選ばれない（既定の取得対象を増やさない）', () => {
    expect(selectXmlDocumentLinks(links, [])).toEqual([]);
  });
  it('指定した帳票の XML版だけが選ばれ、CSV の選定結果は同じ帳票でも落とされない', () => {
    const xml = selectXmlDocumentLinks(links, ['202411001']);
    expect(xml.map(l => l.href)).toEqual(['/server/2024/html/202411001Main.html']);
    expect(selectLinksToDownload(links).map(l => l.href)).toContain('/server/2024/csv/DL202411001.zip');
  });
  it('同一 href は二重に選ばない', () => {
    expect(selectXmlDocumentLinks([...links, ...links], ['202411001'])).toHaveLength(1);
  });
});

describe('目次からの XML 列挙', () => {
  const MENU = `
  LineOut(01,0,"表紙","202411001910001a.xml","");
  LineOut(01,1,"令和6年度一般会計予算","","");
  LineOut(02,0,"予算総則","202411001000001a.xml#p1","p.  1");
  LineOut(03,1,"歳入","202411001000029a.xml#p29","p. 29");
  LineOut(04,0,"国会主管","202411001000029a.xml#p29-3","p. 29");
  LineOut(05,0,"〔組織別事項別内訳〕","202411001000265b.xml#p265","p.265");`;
  it('ファイル名を fragment 抜きで重複なく順に返し、リンクの無い行は無視する', () => {
    expect(parseMenuXmlFileNames(MENU)).toEqual(['202411001910001a.xml', '202411001000001a.xml', '202411001000029a.xml', '202411001000265b.xml']);
  });
  it('Main.html から目次と XML ディレクトリの path を導く。形が違えば throw', () => {
    expect(xmlDocumentPaths('/server/2024/html/202411001Main.html')).toEqual({ menuHref: '/server/2024/html/202411001menu.html', xmlDirHref: '/server/2024/xml/' });
    expect(() => xmlDocumentPaths('/server/2024/csv/DL202411001.zip')).toThrow();
  });
  it('目次から XML を1件も列挙できなければ throw する（0件を成功扱いにしない）', () => {
    expect(() => requireMenuXmlFileNames('LineOut(01,1,"見出しだけ","","");', '202411001')).toThrow(/202411001/);
    expect(() => requireMenuXmlFileNames('', '202411001')).toThrow();
    expect(requireMenuXmlFileNames(MENU, '202411001')).toHaveLength(4);
  });
});
