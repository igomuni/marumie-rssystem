#!/usr/bin/env python3
"""Integrate blinded H1 control reviews and descriptive feature comparison."""
from __future__ import annotations
import argparse,csv,hashlib,json,pathlib
from collections import Counter,defaultdict


def sha_file(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def rows_csv(p): return list(csv.DictReader(p.open(encoding="utf-8",newline="")))
def write_csv(p, rows, fields):
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open("w",encoding="utf-8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction="ignore",lineterminator="\n");w.writeheader();w.writerows(rows)
def first(r,*keys,default=""):
    for k in keys:
        v=r.get(k)
        if v is not None and str(v)!="": return v
    return default
def normalize_evidence(raw, ownership):
    x=(raw or "").strip().upper()
    if x in {"RAW_TEXT_SUFFICIENT","PDF_VISUAL_REQUIRED","STILL_UNDETERMINABLE"}: return x
    if x in {"PARTIAL","UNDETERMINED","INSUFFICIENT"} or ownership in {"AMBIGUOUS","UNDETERMINABLE"}: return "STILL_UNDETERMINABLE"
    if x in {"SUFFICIENT","VISUAL_TABLE_STRUCTURE","WRAPPED_OR_FRAGMENTARY_TEXT"}: return "PDF_VISUAL_REQUIRED"
    return "STILL_UNDETERMINABLE"

def normalize_independent_evidence(raw):
    x=(raw or "").strip().upper()
    if x in {"RAW_TEXT_SUFFICIENT","PDF_VISUAL_REQUIRED","STILL_UNDETERMINABLE"}: return x
    if x in {"SUFFICIENT","VISUAL_TABLE_STRUCTURE","WRAPPED_OR_FRAGMENTARY_TEXT"}:
        return "REVIEWER_REPORTED_SUFFICIENT_METHOD_UNSPECIFIED"
    if x in {"PARTIAL","UNDETERMINED","INSUFFICIENT"}: return "STILL_UNDETERMINABLE"
    return "NOT_RECORDED"

def numeric_sep(pos, neg):
    try: pv=[float(x) for x in pos if x not in (None,"")]; nv=[float(x) for x in neg if x not in (None,"")]
    except Exception: return "INSUFFICIENT_EVIDENCE","nonnumeric or missing values"
    if not pv or not nv or len(pv)!=len(pos) or len(nv)!=len(neg): return "INSUFFICIENT_EVIDENCE","missing numeric values"
    p=(min(pv),max(pv)); n=(min(nv),max(nv))
    return ("OVERLAPS_POSITIVE_NEGATIVE" if max(p[0],n[0])<=min(p[1],n[1]) else "SEPARATES_OBSERVED_CASES"),f"positive_range={p}; control_range={n}"
def categorical_sep(pos, neg):
    if any(x in (None,"") for x in pos+neg): return "INSUFFICIENT_EVIDENCE","one or more values unavailable"
    ps=set(pos); ns=set(neg); overlap=ps&ns
    return ("OVERLAPS_POSITIVE_NEGATIVE" if overlap else "SEPARATES_OBSERVED_CASES"),f"shared_values={sorted(overlap)}"

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--repo-root",required=True,type=pathlib.Path);ap.add_argument("--source-root",required=True,type=pathlib.Path,help="workspace root containing data/work/exports and the frozen #417 ZIP");ap.add_argument("--export-dir",required=True,type=pathlib.Path);a=ap.parse_args()
    root=a.repo_root.resolve(); source=a.source_root.resolve(); out=a.export_dir.resolve(); src=out/"review-input"; rev=out/"review-results"
    base=root/"tests/fixtures/budget-request-toc-h1-control-analysis/2024"
    features=rows_csv(out/"review-input/feature-inventory.csv")
    mapping=rows_csv(out/"review-input/review-mapping.csv")
    map_by_case={r["case_id"]:r for r in mapping}; feature_by_pair={}
    census=[json.loads(x) for x in (base/"ordered-pair-census.jsonl").read_text(encoding="utf-8").splitlines()]
    selected=[json.loads(x) for x in (base/"selected-near-controls.jsonl").read_text(encoding="utf-8").splitlines()]
    selected_by_pair={x["pairId"]:x for x in selected}
    archive=source/"data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0.zip"
    if sha_file(archive)!="ae2392ecb25f7457be9c8cccb68622d4193c544e48e62bf9583524578936ea79":
        raise SystemExit("STOP: frozen #417 archive hash mismatch")
    import zipfile
    prefix="data/work/exports/20261011_1756_FY2024_TOC_Minimal_Assembly_v0/"
    with zipfile.ZipFile(archive) as z:
        assembly_rows=list(csv.DictReader(z.read(prefix+"assembly-observations.csv").decode("utf-8-sig").splitlines()))
    assembly_by_primitive={}
    for obs in assembly_rows:
        ids=json.loads(obs["source_primitive_ids"])
        lines=json.loads(obs["source_line_indexes"])
        ranges=json.loads(obs["source_ranges_utf16"])
        raw=json.loads(obs["source_raw_text_fragments"])
        for i,pid in enumerate(ids):
            assembly_by_primitive[pid]={"observation_id":obs["observation_id"],"source_pdf":obs["source_pdf"],"physical_page":obs["physical_page"],"publisher_domain":obs["publisher_domain"],"raw_line_index":lines[i],"source_range_utf16":ranges[i],"raw_fragment":raw[i],"hypothesis":obs["hypothesis"],"status":obs["status"]}
    for r in features:
        feature_by_pair[r["case_id"]]=r
    primary_raw=[]
    for i in range(1,4):
        p=rev/f"primary-{i}.csv"
        if not p.is_file(): raise SystemExit(f"missing primary review {p}")
        for r in rows_csv(p): r["_batch"]=str(i); primary_raw.append(r)
    primary_by_case={r["case_id"]:r for r in primary_raw}
    expected={r["case_id"] for i in range(1,4) for r in rows_csv(src/f"primary-review-batch-{i}.csv")}
    if len(primary_raw)!=67 or len(primary_by_case)!=67 or set(primary_by_case)!=expected:
        raise SystemExit("primary reviews do not account for exactly the 67 fixed selected cases")
    second_path=rev/"independent-second-review.csv"
    if not second_path.is_file(): raise SystemExit("missing independent second review")
    second_raw=rows_csv(second_path); second_by_case={r["case_id"]:r for r in second_raw}
    expected_second={r["case_id"] for r in rows_csv(src/"independent-second-review-packet.csv")}
    if len(second_raw)!=7 or len(second_by_case)!=7 or set(second_by_case)!=expected_second:
        raise SystemExit("independent second review does not account for the fixed 7 cases")

    joined=[]; comparisons=[]
    for case,r in sorted(primary_by_case.items()):
        m=map_by_case[case]; pairid=m["pair_id"]; p=selected_by_pair[pairid]; f=feature_by_pair[pairid]
        ownership=r["ownership"].strip().upper()
        raw_ev=first(r,"evidence_sufficiency")
        control=first(r,"primary_control_label","control_label","control_label_primary")
        secondary=first(r,"secondary_control_labels","control_labels_secondary")
        if control.lower() not in ("n2","n3","n4","n5","other"):
            # Leave original free-form label visible; a fixed family may be assigned by reviewed PDF evidence.
            control_raw=control; control=""
        else: control_raw=control
        s=second_by_case.get(case)
        sec_own=s["ownership"].strip().upper() if s else ""
        sec_ev_raw=first(s or {},"evidence_sufficiency") if s else ""
        sec_ev=normalize_independent_evidence(sec_ev_raw) if s else ""
        if s and ownership==sec_own: relation="AGREEMENT"
        elif s: relation="DISAGREEMENT"
        else: relation="NOT_DOUBLE_REVIEWED"
        consensus=ownership if relation=="AGREEMENT" else ("AMBIGUOUS" if relation=="DISAGREEMENT" else ownership)
        adjudication="NO_ADJUDICATION_REQUIRED" if relation in ("AGREEMENT","NOT_DOUBLE_REVIEWED") else "PRESERVED_DISAGREEMENT_NO_MAJORITY"
        sp=assembly_by_primitive[p["startPrimitiveId"]]; tp=assembly_by_primitive[p["targetPrimitiveId"]]
        if sp["source_pdf"]!=p["sourcePdf"] or tp["source_pdf"]!=p["sourcePdf"] or str(sp["physical_page"])!=str(p["physicalPage"]) or str(tp["physical_page"])!=str(p["physicalPage"]):
            raise SystemExit(f"primitive provenance mismatch for {pairid}")
        row={
          "case_id":case,"pair_id":pairid,"hypothesis":"H1","shape_signature":p["shapeSignature"],"sample_rank":p["sampleRank"],
          "source_pdf":p["sourcePdf"],"physical_page":p["physicalPage"],"publisher_domain":sp["publisher_domain"],
          "start_primitive_id":p["startPrimitiveId"],"target_primitive_id":p["targetPrimitiveId"],
          "start_raw_line_index":sp["raw_line_index"],"target_raw_line_index":tp["raw_line_index"],
          "start_source_range_utf16":json.dumps(sp["source_range_utf16"]),"target_source_range_utf16":json.dumps(tp["source_range_utf16"]),
          "start_observation_id":sp["observation_id"],"target_observation_id":tp["observation_id"],"source_line_index_gap":f["source_line_index_gap"],
          "start_raw_line":f["start_raw_line"],"target_raw_line":f["target_raw_line"],
          "primary_reviewer_batch":r["_batch"],"primary_ownership_initial":ownership,"primary_evidence_raw":raw_ev,"primary_evidence_normalized":normalize_evidence(raw_ev,ownership),
          "primary_control_label":control,"primary_control_label_raw":control_raw,"primary_secondary_labels":secondary,
          "independent_ownership_initial":sec_own,"independent_evidence_raw":sec_ev_raw,"independent_evidence_normalized":sec_ev,
          "independent_control_label":first(s or {},"primary_control_label","control_label","control_label_primary") if s else "",
          "ownership_review_relation":relation,"ownership_integrated_status":consensus,"coordinator_adjudication":adjudication,
          "primary_pdf_region":first(r,"exact_visible_region","visible_region","pdf_region"),
          "primary_observed_facts":first(r,"observed_facts","raw_text_facts"),"primary_interpretation":first(r,"interpretation"),
          "primary_uncertainty":first(r,"uncertainty"),"primary_method":first(r,"method","review_method"),
          "independent_pdf_region":first(s or {},"pdf_region","visible_region","exact_visible_region") if s else "",
          "independent_observed_facts":first(s or {},"observed_facts","raw_text_facts") if s else "",
          "independent_interpretation":first(s or {},"interpretation") if s else "",
          "independent_uncertainty":first(s or {},"uncertainty") if s else "",
          "independent_method":first(s or {},"review_method","method") if s else "",
          "raw_title_fragment":f["start_raw_fragment"],"raw_target_fragment":f["target_raw_fragment"],
        }
        joined.append(row)
        if s:
            comparisons.append({"case_id":case,"pair_id":pairid,"source_pdf":p["sourcePdf"],"physical_page":p["physicalPage"],"primary_ownership":ownership,"independent_ownership":sec_own,"integrated_status":consensus,"review_relation":relation,"primary_label":control_raw,"independent_label":row["independent_control_label"],"adjudication":"PRESERVED_DISAGREEMENT_NO_MAJORITY" if relation=="DISAGREEMENT" else "AGREEMENT","primary_uncertainty":row["primary_uncertainty"],"independent_uncertainty":row["independent_uncertainty"]})
    joined_fields=list(joined[0]); write_csv(out/"negative-ownership-review.csv",joined,joined_fields)
    comp_fields=list(comparisons[0]); write_csv(out/"independent-review-comparison.csv",comparisons,comp_fields)

    # Feature comparison: fixed positives vs primary-distinct selected controls, with any double-review dissent disclosed.
    pos=[r for r in features if r["case_group"]=="positive"]
    neg=[feature_by_pair[map_by_case[c]["pair_id"]] for c,r in primary_by_case.items() if r["ownership"].strip().upper()=="DISTINCT_ITEMS"]
    sep=[]
    def add_numeric(fid,label,field):
        p=[r.get(field) for r in pos]; n=[r.get(field) for r in neg]; status,reason=numeric_sep(p,n)
        sep.append({"feature_id":fid,"subfeature":label,"status":status,"positive_count":len(p),"negative_control_count":len(n),"positive_missing":sum(x in (None,"") for x in p),"negative_missing":sum(x in (None,"") for x in n),"method":"numeric range overlap","reason":reason})
    def add_cat(fid,label,field,na=False,why=""):
        if na:
            sep.append({"feature_id":fid,"subfeature":label,"status":"NOT_APPLICABLE","positive_count":len(pos),"negative_control_count":len(neg),"positive_missing":0,"negative_missing":0,"method":"preregistered exclusion","reason":why}); return
        p=[r.get(field) for r in pos]; n=[r.get(field) for r in neg]; status,reason=categorical_sep(p,n)
        sep.append({"feature_id":fid,"subfeature":label,"status":status,"positive_count":len(p),"negative_control_count":len(n),"positive_missing":sum(x in (None,"") for x in p),"negative_missing":sum(x in (None,"") for x in n),"method":"exact observed-value set overlap","reason":reason})
    add_numeric("F01","source_line_index_gap","source_line_index_gap")
    add_cat("F02","side_pair",True,"Side pair is used to define near-shape strata; not discrimination evidence.")
    add_numeric("F03","start_line_leading_U+0020_count","start_line_leading_u0020_count")
    add_numeric("F03","target_line_leading_U+0020_count","target_line_leading_u0020_count")
    add_cat("F03","start_line_other_whitespace","start_line_other_whitespace_before_text")
    add_cat("F03","target_line_other_whitespace","target_line_other_whitespace_before_text")
    add_numeric("F04","start_offset_utf16","start_offset_utf16")
    add_numeric("F04","target_offset_utf16","target_offset_utf16")
    add_cat("F05","page_ref_exact","page_ref_exact")
    add_cat("F06","primitive_kinds_and_raw_fragments","start_kind",True,"The pair is defined by title_page → title_only_candidate; raw fragments/kinds are fixed by pair selection.")
    add_cat("F07","intervening_units","intervening_unit_kinds",True,"Intervening barrier/primitive information is used to assign near-shape strata; not discrimination evidence.")
    add_cat("F08","target_in_any_H2_observation","target_in_any_h2_observation")
    add_cat("F09","page_boundary_status","page_boundary_status")
    add_numeric("F09","page_boundary_column_utf16","page_boundary_column_utf16")
    add_cat("F09","pair_interval_barrier_ids","pair_interval_barrier_ids",True,"Barrier IDs are part of the sample strata; not discrimination evidence.")
    write_csv(out/"feature-separability.csv",sep,["feature_id","subfeature","status","positive_count","negative_control_count","positive_missing","negative_missing","method","reason"])

    # Descriptive profiles and failure-family accounting.
    prof=[]
    profile_fields=["source_line_index_gap","start_line_leading_u0020_count","target_line_leading_u0020_count","start_offset_utf16","target_offset_utf16","page_ref_exact","target_in_any_h2_observation","page_boundary_status","page_boundary_column_utf16","pair_interval_barrier_ids"]
    for group,rs in (("positive",pos),("selected_near_controls_primary_distinct",neg)):
        for field in profile_fields:
            vals=[r.get(field) for r in rs]; present=[v for v in vals if v not in (None,"")]
            numeric=field in {"source_line_index_gap","start_line_leading_u0020_count","target_line_leading_u0020_count","start_offset_utf16","target_offset_utf16","page_boundary_column_utf16"}
            if numeric:
                nums=[int(v) for v in present]; dist={"min":min(nums) if nums else None,"max":max(nums) if nums else None,"values":dict(sorted(Counter(nums).items()))}
            else: dist=dict(sorted(Counter(present).items()))
            prof.append({"group":group,"feature":field,"n":len(rs),"missing":len(vals)-len(present),"distribution":json.dumps(dist,ensure_ascii=False,sort_keys=True)})
    write_csv(out/"feature-profile.csv",prof,["group","feature","n","missing","distribution"])
    for group,filename in (("positive","positive-feature-profile.csv"),("selected_near_controls_primary_distinct","negative-feature-profile.csv")):
        write_csv(out/filename,[r for r in prof if r["group"]==group],["group","feature","n","missing","distribution"])

    primary_counts=Counter(r["primary_control_label"] or r["primary_control_label_raw"] for r in joined)
    own_counts=Counter(r["primary_ownership_initial"] for r in joined)
    evidence_counts=Counter(r["primary_evidence_normalized"] for r in joined)
    compare_counts=Counter(r["ownership_review_relation"] for r in joined if r["independent_ownership_initial"])
    integrated=Counter(r["ownership_integrated_status"] for r in joined)
    shape_counts=Counter(x["shapeSignature"] for x in selected)
    census_counts=Counter(x["shapeSignature"] for x in census)
    family_rows=[]
    for sig,n in sorted(shape_counts.items()):
        cases=[r for r in joined if selected_by_pair[map_by_case[r["case_id"]]["pair_id"]]["shapeSignature"]==sig]
        family_rows.append({"axis":"FROZEN_SHAPE_STRATUM","category":sig,"count":n,"primary_DISTINCT":sum(r["primary_ownership_initial"]=="DISTINCT_ITEMS" for r in cases),"second_reviewed_n":sum(bool(r["independent_ownership_initial"]) for r in cases),"integrated_AMBIGUOUS":sum(r["ownership_integrated_status"]=="AMBIGUOUS" for r in cases),"reviewer_labels":json.dumps(dict(Counter(r["primary_control_label"] for r in cases)),ensure_ascii=False,sort_keys=True)})
    for label,n in sorted(primary_counts.items()):
        family_rows.append({"axis":"PRIMARY_CONTROL_LABEL","category":label,"count":n,"reviewer_labels":label})
    for label,n in sorted(integrated.items()):
        family_rows.append({"axis":"INTEGRATED_OWNERSHIP","category":label,"count":n})
    write_csv(out/"failure-family-summary.csv",family_rows,["axis","category","count","primary_DISTINCT","second_reviewed_n","integrated_AMBIGUOUS","reviewer_labels"])
    selected_inventory=[]
    for x in selected:
        case=next(m["case_id"] for m in mapping if m["pair_id"]==x["pairId"])
        selected_inventory.append({**feature_by_pair[x["pairId"]],"pair_id":x["pairId"],"shape_signature":x["shapeSignature"],"sample_rank":x["sampleRank"],"review_case_id":case})
    write_csv(out/"negative-discovery-inventory.csv",selected_inventory,list(features[0])+["pair_id","shape_signature","sample_rank","review_case_id"])
    unresolved=[r for r in joined if r["ownership_integrated_status"] in {"AMBIGUOUS","UNDETERMINABLE"}]
    write_csv(out/"unresolved-cases.csv",unresolved,list(joined[0]))
    summary={
      "schema":"toc-h1-positive-negative-analysis/v1","researchStatus":"post-hoc development controls; not accuracy/generalization or held-out",
      "population":{"tocPages":82,"pdfs":55,"DIRECT":55,"INHERITED":27},
      "positive":{"count":len(pos),"ownership":"prior #418 SAME_ITEM; PDF visual required","pdfCount":len({r["source_pdf"] for r in pos}),"pageCount":len({(r["source_pdf"],r["physical_page"]) for r in pos})},
      "orderedPairCensus":{"count":len(census),"shapeCounts":dict(census_counts),"n1":"N1_NOT_OBSERVED_IN_FROZEN_CORPUS; exact set is definitionally the fixed 31 positives"},
      "nearControls":{"candidateCount":sum(shape_counts.values()),"selectedCount":len(selected),"unselectedNearCount":sum(census_counts[s] for s in ("UNKNOWN_SIDE","KNOWN_SIDE_MISMATCH","SAME_SIDE_INTERVENING_BARRIER","SAME_SIDE_INTERVENING_PRIMITIVE"))-len(selected),"selectedCountsBySignature":dict(shape_counts),"primaryOwnership":dict(own_counts),"integratedOwnership":dict(integrated),"primaryLabels":dict(primary_counts),"primaryEvidenceSufficiency":dict(evidence_counts),"secondReviewCount":len(second_raw),"secondReviewAgreement":dict(compare_counts)},
      "featureSeparability":{r["feature_id"]+"/"+r["subfeature"]:r["status"] for r in sep},
      "noMajorityRuleApplied":True,
      "coordinatorAdjudication":"No reviewer disagreement was overwritten; disagreements remain AMBIGUOUS in integrated status.",
    }
    summary_text=json.dumps(summary,ensure_ascii=False,indent=2)+"\n"
    (out/"analysis-summary.json").write_text(summary_text,encoding="utf-8")
    (out/"summary.json").write_text(summary_text,encoding="utf-8")
    print(json.dumps({"primary":dict(own_counts),"evidence":dict(evidence_counts),"labels":dict(primary_counts),"secondReview":dict(compare_counts),"integrated":dict(integrated),"separability":summary["featureSeparability"]},ensure_ascii=False,sort_keys=True))
if __name__=="__main__": main()
