import * as fs from 'fs'; import * as path from 'path'; import {createHash} from 'crypto';
import {coverPage,tocPage,renderTocCsv} from './lib/budget-request-plain-text-csv';
import {deterministicPdfSlug} from './lib/budget-request-plain-text';
const root='data/work/budget-request-plain-text/2024', out='data/work/budget-request-csv/2024';
const selections=[{kind:'cover',slug:'cao.go.jp__yosan__soshiki__r06__pdf__0',page:1,pdf:'data/download/cao.go.jp/yosan/soshiki/r06/pdf/0.pdf'}] as const;
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(fs.readFileSync('tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json','utf8'));
if (!Array.isArray(manifest.documents) || manifest.documents.length !== 82) throw Error(`frozen raw-text manifest must contain 82 PDFs; found ${manifest.documents?.length ?? 'invalid documents'}`);
const manifestPaths = manifest.documents.map((d:any)=>d.localPdfPath);
if (new Set(manifestPaths).size !== manifestPaths.length) throw Error('duplicate localPdfPath in frozen raw-text manifest');
const development=JSON.parse(fs.readFileSync('tests/fixtures/budget-request-toc-physical-row/2024/development-sample.json','utf8'));
if (development.inspectionRole !== 'DEVELOPMENT_EXPLORATION（held-out ではない・formal preregistration ではない）' || !Array.isArray(development.pages)) throw Error('unexpected TOC development-sample manifest');
const tocSelections=development.pages.filter((p:any)=>p.role==='NEW_DEVELOPMENT'&&p.classifierPageType==='TOC').map((p:any)=>({kind:'toc' as const,slug:deterministicPdfSlug(p.localPdfPath),page:p.physicalPage,pdf:p.localPdfPath,expectedPdfSha256:p.pdfSha256,expectedTextSha256:p.textSha256,publisherDomain:p.publisherDomain}));
if (!tocSelections.some((s:any)=>s.pdf==='data/download/mlit.go.jp/page/content/001630995.pdf'&&s.page===6)) throw Error('required MLIT H5 page is absent from development sample');
if (new Set(tocSelections.map((s:any)=>s.publisherDomain)).size < 4) throw Error('TOC development sample must cover multiple publishers');
fs.mkdirSync(out,{recursive:true}); const audit:any[]=[]; const validation:any[]=[];
for(const s of [...tocSelections,...selections]){
  const doc=manifest.documents.find((d:any)=>d.localPdfPath===s.pdf); if(!doc)throw Error(`missing manifest ${s.pdf}`);
  const pdf=fs.readFileSync(s.pdf); if(hash(pdf)!==doc.pdfSha256)throw Error(`source PDF SHA mismatch ${s.pdf}`);
  if ('expectedPdfSha256' in s && s.expectedPdfSha256!==doc.pdfSha256) throw Error(`development sample PDF hash differs from frozen raw-text manifest ${s.pdf}`);
  const txt=fs.readFileSync(path.join(root,s.slug+'.txt')); const fullText=txt.toString('utf8');
  if(!fullText.endsWith('\f'))throw Error(`TXT missing terminal FF ${s.slug}`);
  const pages=fullText.split('\f');
  if(pages.length-1!==doc.pageCount || doc.pageTextSha256.length!==doc.pageCount)throw Error(`TXT FF/page count mismatch ${s.slug}: ${pages.length-1} vs manifest ${doc.pageCount}`);
  const text=pages[s.page-1]; if(text===undefined||hash(Buffer.from(text))!==doc.pageTextSha256[s.page-1])throw Error(`text SHA mismatch ${s.pdf} page ${s.page}`);
  if ('expectedTextSha256' in s && s.expectedTextSha256!==doc.pageTextSha256[s.page-1]) throw Error(`development sample text hash differs from frozen raw-text manifest ${s.pdf} page ${s.page}`);
  let content:string;
  if(s.kind==='cover'){const result=coverPage(text,s.pdf,s.page); content=result.csv; audit.push(...result.audit); validation.push({kind:s.kind,pdf:s.pdf,page:s.page,records:1,auditEntries:result.audit.length});}
  else{const result=tocPage(text,s.pdf,s.page); content=renderTocCsv(result.records); audit.push(...result.audit); validation.push({kind:s.kind,pdf:s.pdf,page:s.page,publisherDomain:s.publisherDomain,records:result.records.length,auditEntries:result.audit.length,unresolvedEntries:result.audit.filter((a:any)=>a.reason.startsWith('unresolved')||a.reason.includes('unclassified')).length});}
  fs.writeFileSync(path.join(out,`${s.kind}-${s.slug}-p${s.page}.csv`),content);
}
fs.writeFileSync(path.join(out,'audit.tsv'),['source_pdf\tpage\traw_line_index\traw_line\traw_text\treason',...audit.map(a=>[a.sourcePdf,a.page,a.rawLineIndex,a.rawLine,a.rawText,a.reason].join('\t'))].join('\n')+'\n');
fs.writeFileSync(path.join(out,'development-validation.json'),JSON.stringify({scope:'selected development pages only; not a full-corpus or held-out evaluation',tocPublisherCount:new Set(tocSelections.map((s:any)=>s.publisherDomain)).size,pages:validation},null,2)+'\n');
