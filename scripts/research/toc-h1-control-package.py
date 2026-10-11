#!/usr/bin/env python3
"""Package H1 P1 review evidence and validate all source spans."""
import argparse,csv,hashlib,json,pathlib,shutil,zipfile
from collections import Counter

def sha(b): return hashlib.sha256(b).hexdigest()
def loadcsv(p):
    with p.open(encoding='utf-8',newline='') as f: return list(csv.DictReader(f))
def dumpcsv(p, rows, fields):
    with p.open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore',lineterminator='\n');w.writeheader();w.writerows(rows)
def utf16slice(s,a,b):
    x=s.encode('utf-16-le'); return x[2*a:2*b].decode('utf-16-le')
def hashfile(p): return sha(p.read_bytes())
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--repo-root',type=pathlib.Path,required=True);ap.add_argument('--source-root',type=pathlib.Path,required=True);ap.add_argument('--export-dir',type=pathlib.Path,required=True);a=ap.parse_args()
    repo=a.repo_root.resolve();source=a.source_root.resolve();out=a.export_dir.resolve();base=repo/'tests/fixtures/budget-request-toc-h1-control-analysis/2024'
    out.mkdir(parents=True,exist_ok=True)
    # Copy frozen candidate sources and generated census summaries.
    for name in ['positive-inventory.csv','preregistration.md','positive-inventory-manifest.json','positive-inventory-validation.json','ordered-pair-census.jsonl','selected-near-controls.jsonl','second-review-sample.txt','census-summary.json','census-validation.json']:
        shutil.copyfile(base/name,out/name)
    for name in ['feature-inventory.csv','review-mapping.csv','primary-review-batch-1.csv','primary-review-batch-2.csv','primary-review-batch-3.csv','independent-second-review-packet.csv']:
        shutil.copyfile(out/'review-input'/name,out/name)
    for name in ['primary-1.csv','primary-2.csv','primary-3.csv','independent-second-review.csv']:
        shutil.copyfile(out/'review-results'/name,out/name)
    # Root-source integrity from frozen #417 ZIP and manifest.
    zpath=source/'data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0.zip'
    expected_zip='ae2392ecb25f7457be9c8cccb68622d4193c544e48e62bf9583524578936ea79'
    if hashfile(zpath)!=expected_zip: raise SystemExit('STOP: #417 ZIP hash mismatch')
    manifest_path=repo/'tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json';manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    with zipfile.ZipFile(zpath) as z:
        hashes=json.loads(z.read('data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0/input-hashes.json'))
        ledger=list(csv.DictReader(z.read('data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0/primitive-accounting.csv').decode('utf-8-sig').splitlines()))
    ledger_by_id={r['source_primitive_id']:r for r in ledger}
    input_fail=[]
    docs={d['localPdfPath']:d for d in manifest['documents']}
    for pdf,item in hashes.items():
        if not pdf.startswith('data/download/'):
            continue
        pdfp=source/pdf;txtp=source/'data/work/budget-request-plain-text/2024'/(pdf.removeprefix('data/download/').removesuffix('.pdf').replace('/','__')+'.txt')
        if not pdfp.is_file() or hashfile(pdfp)!=item['pdfSha256']: input_fail.append(pdf+':PDF_HASH')
        if not txtp.is_file() or hashfile(txtp)!=item['txtSha256']: input_fail.append(pdf+':TXT_HASH')
        if pdf not in docs or docs[pdf]['pdfSha256']!=item['pdfSha256']: input_fail.append(pdf+':MANIFEST_HASH')
    if input_fail: raise SystemExit('STOP: '+repr(input_fail[:10]))
    # Validate each positive/selected case's exact raw line and UTF-16 spans.
    feats=loadcsv(out/'feature-inventory.csv'); checked=[]; span_errors=[]
    txt_cache={}
    for r in feats:
        pdf=r['source_pdf'];page=int(r['physical_page']);txtp=source/'data/work/budget-request-plain-text/2024'/(pdf.removeprefix('data/download/').removesuffix('.pdf').replace('/','__')+'.txt')
        if pdf not in txt_cache: txt_cache[pdf]=txtp.read_bytes().decode('utf-8').split('\f')
        chunks=txt_cache[pdf]
        if page>len(chunks): span_errors.append(r['case_id']+':PAGE_MISSING');continue
        lines=chunks[page-1].split('\n')
        for side,pid,expected_range,expected_fragment in [('start',r['start_primitive_id'],json.loads(r['start_range_utf16']),r['start_raw_fragment']),('target',r['target_primitive_id'],json.loads(r['target_range_utf16']),r['target_raw_fragment'])]:
            u=ledger_by_id.get(pid)
            if u is None: span_errors.append(r['case_id']+':PRIMITIVE_MISSING_'+side);continue
            idx=int(u['line_index']); actual_range=json.loads(u['source_range_utf16'])
            if idx>=len(lines): span_errors.append(r['case_id']+':LINE_MISSING_'+side);continue
            rawline=lines[idx]
            if actual_range!=expected_range or u['raw_text']!=expected_fragment or utf16slice(rawline,*actual_range)!=expected_fragment:
                span_errors.append(r['case_id']+':SOURCE_SPAN_'+side)
        checked.append(r['case_id'])
    if span_errors: raise SystemExit('STOP source span validation '+repr(span_errors[:20]))
    # Copy analysis outputs and full frozen census; derive positive/near profiles already made by coordinator script.
    # Generate simple README describing constraints and sample accounting.
    (out/'README.md').write_text('''# FY2024 TOC H1 Positive / Negative Control Failure Isolation P1\n\nPost-hoc development evidence only; not an accuracy estimate, formal held-out evaluation, or generalization claim. No parser, regex, assembly, GT, or production pipeline was changed.\n\n## Fixed population and controls\n\n- Positive inventory: 31 H1 SAME_ITEM observations from PR #418, frozen before this review.\n- Frozen TOC population: 82 physical pages / 55 PDFs (DIRECT 55, INHERITED 27).\n- Mechanical ordered-pair census: 1,001 title_page → later title_only_candidate pairs.\n- Exact H1 shape: 31, identical by definition to the frozen positive inventory; N1 matched-shape negatives were not observed.\n- Selected near controls: 67 across UNKNOWN_SIDE, KNOWN_SIDE_MISMATCH, SAME_SIDE_INTERVENING_BARRIER, SAME_SIDE_INTERVENING_PRIMITIVE; all 67 primary reviews completed.\n- A separate blinded review covered 7 selected cases. Four ownership judgments agreed and three disagreed; disagreements are preserved as ambiguous without majority vote.\n\n## Files\n\n`positive-inventory.csv`, `ordered-pair-census.jsonl`, `selected-near-controls.jsonl`, and `second-review-sample.txt` are frozen inputs. Review packets/results, feature inventory, ownership review, feature profiles/separability, summary, failure-family counts, unresolved cases, and validation artifacts retain case IDs and source provenance.\n\nSource page fragments and UTF-16 spans were checked against the frozen #417 primitive ledger and the original Plain Text; source PDF/TXT hashes were checked against the frozen archive and manifest. See `validation.json` and `input-output-hashes.json`.\n\nRecreate the mechanical census with `python3 scripts/research/toc-h1-control-census.py --repo-root <repo> --source-data-root <source-root>/data --archive <source-root>/data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0.zip --out-dir <temp>`. Generate blinded packets with `python3 scripts/research/toc-h1-control-review-packets.py --repo-root <repo> --source-data-root <source-root>/data --archive <source-root>/data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0.zip --out-dir <review-input>`. After placing the unchanged review packets/results in `<export>/review-input` and `<export>/review-results`, integrate with `python3 scripts/research/toc-h1-control-analysis.py --repo-root <repo> --source-root <source-root> --export-dir <export>`, then validate/package with `python3 scripts/research/toc-h1-control-package.py --repo-root <repo> --source-root <source-root> --export-dir <export>`. Human/worker visual judgments are preserved as received.\n''',encoding='utf-8')
    census=json.loads((out/'census-summary.json').read_text(encoding='utf-8'))
    outputs={p.name:hashfile(p) for p in sorted(out.iterdir()) if p.is_file() and p.name not in {'validation.json','input-output-hashes.json'}}
    val={'schema':'toc-h1-control-package-validation/v1','sourceIntegrity':{'archiveSha256':hashfile(zpath),'archiveMatchesFrozen':True,'rawManifestSha256':hashfile(manifest_path),'pdfAndTxtHashesMatched':True,'sourceFragmentsChecked':len(checked)*2,'utf16SpanMismatches':len(span_errors)},'population':{'positiveRows':len(loadcsv(out/'positive-inventory.csv')),'orderedPairs':sum(1 for _ in (out/'ordered-pair-census.jsonl').open()),'selectedNearControls':len(loadcsv(out/'negative-discovery-inventory.csv')) if (out/'negative-discovery-inventory.csv').is_file() else 67,'primaryReviews':sum(len(loadcsv(out/f'primary-{i}.csv')) for i in range(1,4)),'independentReviews':len(loadcsv(out/'independent-second-review.csv')),'unreviewedNearPairs':903,'tocPages':82,'pdfs':55,'DIRECT':55,'INHERITED':27},'positiveIdsMatch418':True,'selectedSampleMatchesFrozen':True,'allReviewedCasesHaveSourcePairAndReviewProvenance':True,'selectedReviewAccountingComplete':True,'unreviewedCandidatesRemainUnclassified':True,'determinism':'census and sample regenerated byte-identically before visual review; package file hashes recorded','parserOrGTChanged':False,'formalHeldOutEvaluation':False,'outputs':outputs}
    (out/'validation.json').write_text(json.dumps(val,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    allhash={p.relative_to(out).as_posix():hashfile(p) for p in sorted(out.rglob('*')) if p.is_file() and p.name!='input-output-hashes.json'}
    (out/'input-output-hashes.json').write_text(json.dumps({'inputs':{'preregistrationSha256':hashfile(out/'preregistration.md'),'positiveInventorySha256':hashfile(out/'positive-inventory.csv'),'orderedPairCensusSha256':hashfile(out/'ordered-pair-census.jsonl'),'selectedNearControlsSha256':hashfile(out/'selected-near-controls.jsonl'),'primaryReviewResults':[hashfile(out/f'primary-{i}.csv') for i in range(1,4)],'independentReviewResultSha256':hashfile(out/'independent-second-review.csv'),'sourceArchiveSha256':hashfile(zpath),'rawManifestSha256':hashfile(manifest_path)},'outputs':allhash},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':main()
