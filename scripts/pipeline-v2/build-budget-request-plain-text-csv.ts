import * as fs from 'fs'; import * as path from 'path'; import {createHash} from 'crypto';
import {coverPage,tocPage,renderTocCsv} from './lib/budget-request-plain-text-csv';
const root='data/work/budget-request-plain-text/2024', out='data/work/budget-request-csv/2024';
const selections=[{kind:'toc',slug:'mlit.go.jp__page__content__001630995',page:6,pdf:'data/download/mlit.go.jp/page/content/001630995.pdf'},{kind:'cover',slug:'cao.go.jp__yosan__soshiki__r06__pdf__0',page:1,pdf:'data/download/cao.go.jp/yosan/soshiki/r06/pdf/0.pdf'}] as const;
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(fs.readFileSync('tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json','utf8'));
if (!Array.isArray(manifest.documents) || manifest.documents.length !== 82) throw Error(`frozen raw-text manifest must contain 82 PDFs; found ${manifest.documents?.length ?? 'invalid documents'}`);
const manifestPaths = manifest.documents.map((d:any)=>d.localPdfPath);
if (new Set(manifestPaths).size !== manifestPaths.length) throw Error('duplicate localPdfPath in frozen raw-text manifest');
fs.mkdirSync(out,{recursive:true}); const audit:any[]=[];
for(const s of selections){
  const doc=manifest.documents.find((d:any)=>d.localPdfPath===s.pdf); if(!doc)throw Error(`missing manifest ${s.pdf}`);
  const pdf=fs.readFileSync(s.pdf); if(hash(pdf)!==doc.pdfSha256)throw Error(`source PDF SHA mismatch ${s.pdf}`);
  const txt=fs.readFileSync(path.join(root,s.slug+'.txt')); const fullText=txt.toString('utf8');
  if(!fullText.endsWith('\f'))throw Error(`TXT missing terminal FF ${s.slug}`);
  const pages=fullText.split('\f');
  if(pages.length-1!==doc.pageCount || doc.pageTextSha256.length!==doc.pageCount)throw Error(`TXT FF/page count mismatch ${s.slug}: ${pages.length-1} vs manifest ${doc.pageCount}`);
  const text=pages[s.page-1]; if(text===undefined||hash(Buffer.from(text))!==doc.pageTextSha256[s.page-1])throw Error(`text SHA mismatch ${s.pdf} page ${s.page}`);
  let content:string;
  if(s.kind==='cover'){const result=coverPage(text,s.pdf,s.page); content=result.csv; audit.push(...result.audit);}
  else{const result=tocPage(text,s.pdf,s.page); content=renderTocCsv(result.records); audit.push(...result.audit);}
  fs.writeFileSync(path.join(out,`${s.kind}-${s.slug}-p${s.page}.csv`),content);
}
fs.writeFileSync(path.join(out,'audit.tsv'),['source_pdf\tpage\traw_line_index\traw_line\traw_text\treason',...audit.map(a=>[a.sourcePdf,a.page,a.rawLineIndex,a.rawLine,a.rawText,a.reason].join('\t'))].join('\n')+'\n');
