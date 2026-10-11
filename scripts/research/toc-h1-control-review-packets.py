#!/usr/bin/env python3
"""Create blinded review packets and fixed descriptive feature records.

Consumes only committed positive/candidate inventories and the frozen #417
primitive ledger. It contains no ownership classifier and never examines PDFs.
"""
from __future__ import annotations
import argparse, csv, hashlib, json, pathlib, zipfile
from collections import Counter, defaultdict

ARCHIVE_SHA = "ae2392ecb25f7457be9c8cccb68622d4193c544e48e62bf9583524578936ea79"


def sha(b: bytes) -> str: return hashlib.sha256(b).hexdigest()
def read_csv_bytes(b: bytes): return list(csv.DictReader(b.decode("utf-8-sig").splitlines()))
def dump_csv(path, rows, fields):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w=csv.DictWriter(f, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        w.writeheader(); w.writerows(rows)
def bytekey(s): return s.encode("utf-8")
def raw_page_lines(source_root, pdf, page):
    p=source_root/"work/budget-request-plain-text/2024"/(pdf.removeprefix("data/download/").removesuffix(".pdf").replace("/","__")+".txt")
    data=p.read_bytes().decode("utf-8")
    chunks=data.split("\f")
    if len(chunks) < page: raise ValueError(f"missing page {pdf}#{page}")
    return chunks[page-1].split("\n")

def lead_space(line):
    i=0
    while i<len(line) and line[i]==" ": i+=1
    j=i
    while j<len(line) and line[j].isspace(): j+=1
    return i, j>i

def utf16_slice(text, start, end):
    raw=text.encode("utf-16-le")
    return raw[start*2:end*2].decode("utf-16-le")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--repo-root",required=True,type=pathlib.Path)
    ap.add_argument("--source-data-root",required=True,type=pathlib.Path)
    ap.add_argument("--archive",required=True,type=pathlib.Path)
    ap.add_argument("--out-dir",required=True,type=pathlib.Path)
    a=ap.parse_args(); root=a.repo_root.resolve(); src=a.source_data_root.resolve(); out=a.out_dir.resolve()
    if sha(a.archive.read_bytes())!=ARCHIVE_SHA: raise SystemExit("STOP: #417 archive hash mismatch")
    base=root/"tests/fixtures/budget-request-toc-h1-control-analysis/2024"
    positive=read_csv_bytes((base/"positive-inventory.csv").read_bytes())
    selected=[json.loads(x) for x in (base/"selected-near-controls.jsonl").read_text(encoding="utf-8").splitlines()]
    second=set((base/"second-review-sample.txt").read_text(encoding="utf-8").splitlines())
    prefix="data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0/"
    with zipfile.ZipFile(a.archive) as z:
        ledger=read_csv_bytes(z.read(prefix+"primitive-accounting.csv"))
        pages=read_csv_bytes(z.read(prefix+"page-status.csv"))
        observations=read_csv_bytes(z.read(prefix+"assembly-observations.csv"))
    byid={r["source_primitive_id"]:r for r in ledger}
    pageinfo={(r["sourcePdf"],int(r["physicalPage"])):r for r in pages}
    h2ids=set()
    for r in observations:
        if r["hypothesis"]=="H2": h2ids.update(json.loads(r["source_primitive_ids"]))
    units_by_page=defaultdict(list)
    for r in ledger:
        k=(r["source_pdf"],int(r["physical_page"]))
        r["line_i"]=int(r["line_index"]); r["span"]=json.loads(r["source_range_utf16"])
        units_by_page[k].append(r)
    for v in units_by_page.values(): v.sort(key=lambda r:(r["line_i"],r["span"][0],bytekey(r["source_primitive_id"])))

    positive_pairs=[]
    for r in positive:
        ids=json.loads(r["source_primitive_ids"])
        if len(ids)!=2: raise SystemExit("positive pair does not have exactly two source primitives")
        positive_pairs.append({"pairId":r["observation_id"],"sourcePdf":r["source_pdf"],"physicalPage":int(r["physical_page"]),"startPrimitiveId":ids[0],"targetPrimitiveId":ids[1],"kind":"positive"})
    selected_pairs=[{**r,"kind":"near_control"} for r in selected]
    all_pairs=positive_pairs+selected_pairs
    feature_rows=[]; review_rows=[]; map_rows=[]
    for pair in all_pairs:
        pdf=pair["sourcePdf"]; page=int(pair["physicalPage"]); start=byid[pair["startPrimitiveId"]]; target=byid[pair["targetPrimitiveId"]]
        lines=raw_page_lines(src,pdf,page)
        si=int(start["line_index"]); ti=int(target["line_index"])
        if si>=len(lines) or ti>=len(lines): raise SystemExit(f"bad raw line index {pdf}#{page}:{si}/{ti}")
        sline,tline=lines[si],lines[ti]
        # Verify each frozen source span against the exact TXT line in JS UTF-16 units.
        if utf16_slice(sline, *json.loads(start["source_range_utf16"])) != start["raw_text"]:
            raise SystemExit(f"source span mismatch for {pair['startPrimitiveId']} at {pdf}#{page}:{si}")
        if utf16_slice(tline, *json.loads(target["source_range_utf16"])) != target["raw_text"]:
            raise SystemExit(f"source span mismatch for {pair['targetPrimitiveId']} at {pdf}#{page}:{ti}")
        # Keep only complete, non-overlapping frozen units strictly between source spans.
        between=[]
        start_end=(si,int(json.loads(start["source_range_utf16"])[1]))
        target_start=(ti,int(json.loads(target["source_range_utf16"])[0]))
        for u in units_by_page[(pdf,page)]:
            uid=u["source_primitive_id"]
            if uid in (pair["startPrimitiveId"],pair["targetPrimitiveId"]): continue
            ub=(u["line_i"],u["span"][0]); ue=(u["line_i"],u["span"][1])
            if ub>=start_end and ue<=target_start and ub<target_start: between.append(u)
        s_lead,s_other=lead_space(sline); t_lead,t_other=lead_space(tline)
        info=pageinfo[(pdf,page)]
        feat={
          "case_id":pair["pairId"],"case_group":pair["kind"],"hypothesis":"H1","source_pdf":pdf,"physical_page":page,
          "start_primitive_id":pair["startPrimitiveId"],"target_primitive_id":pair["targetPrimitiveId"],
          "source_line_index_gap":ti-si,"consecutive_source_lines":ti-si==1,
          "start_side":start["side"],"target_side":target["side"],"both_sides_known_equal":start["side"] in ("left","right") and start["side"]==target["side"],
          "start_line_leading_u0020_count":s_lead,"start_line_other_whitespace_before_text":s_other,
          "target_line_leading_u0020_count":t_lead,"target_line_other_whitespace_before_text":t_other,
          "start_range_utf16":start["source_range_utf16"],"target_range_utf16":target["source_range_utf16"],
          "start_offset_utf16":json.loads(start["source_range_utf16"])[0],"target_offset_utf16":json.loads(target["source_range_utf16"])[0],
          "page_ref_exact":start["page_ref"],"start_kind":start["primitive_kind"],"target_kind":target["primitive_kind"],
          "start_raw_fragment":start["raw_text"],"target_raw_fragment":target["raw_text"],
          "intervening_unit_count":len(between),"intervening_unit_kinds":"|".join(u["primitive_kind"] for u in between),
          "intervening_unit_ids":"|".join(u["source_primitive_id"] for u in between),"target_in_any_h2_observation":pair["targetPrimitiveId"] in h2ids,
          "page_boundary_status":info["columnStatus"],"page_boundary_column_utf16":info["boundaryUtf16Column"],
          "pair_interval_barrier_ids":"|".join(u["source_primitive_id"] for u in between if u["primitive_kind"]=="BARRIER"),
          "start_raw_line":sline,"target_raw_line":tline,
        }
        feature_rows.append(feat)
        if pair["kind"]=="near_control":
            # deterministic opaque case label; internal mapping retains pairId
            alias="C-"+hashlib.sha256(pair["pairId"].encode("utf-8")).hexdigest()[:12].upper()
            batch=int(hashlib.sha256((pair["pairId"]+"|primary-review-batch-v1").encode()).hexdigest()[:8],16)%3
            review_rows.append({
              "case_id":alias,"source_pdf":pdf,"physical_page":page,
              "start_raw_line_index":si,"target_raw_line_index":ti,
              "start_source_range_utf16":start["source_range_utf16"],"target_source_range_utf16":target["source_range_utf16"],
              "start_side":start["side"],"target_side":target["side"],
              "start_raw_text":start["raw_text"],"target_raw_text":target["raw_text"],
              "start_full_source_line":sline,"target_full_source_line":tline,
            })
            map_rows.append({"case_id":alias,"pair_id":pair["pairId"],"kind":"near_control","primary_batch":batch,"second_review":pair["pairId"] in second})

    feature_fields=list(feature_rows[0])
    review_fields=list(review_rows[0])
    dump_csv(out/"feature-inventory.csv",feature_rows,feature_fields)
    dump_csv(out/"review-mapping.csv",map_rows,["case_id","pair_id","kind","primary_batch","second_review"])
    for batch in range(3):
        rows=sorted((r for r in review_rows if int(hashlib.sha256(next(m["pair_id"] for m in map_rows if m["case_id"]==r["case_id"]).encode()+b"|primary-review-batch-v1").hexdigest()[:8],16)%3==batch),key=lambda r:r["case_id"].encode())
        dump_csv(out/f"primary-review-batch-{batch+1}.csv",rows,review_fields)
    second_rows=[]
    mapping={m["pair_id"]:m["case_id"] for m in map_rows}
    for r in review_rows:
        pairid=next(m["pair_id"] for m in map_rows if m["case_id"]==r["case_id"])
        if pairid in second: second_rows.append(r)
    dump_csv(out/"independent-second-review-packet.csv",sorted(second_rows,key=lambda r:r["case_id"].encode()),review_fields)
    print(json.dumps({"positive":len(positive_pairs),"selectedNearControls":len(selected_pairs),"reviewBatches":[sum(int(hashlib.sha256(m["pair_id"].encode()+b"|primary-review-batch-v1").hexdigest()[:8],16)%3==i for m in map_rows) for i in range(3)],"secondReview":len(second_rows),"featureRows":len(feature_rows)},ensure_ascii=False,sort_keys=True))

if __name__=="__main__": main()
