# FY2024 Budget Request TOC — Independent Source Correspondence Anchor P5

**Status:** Frozen development evidence-sufficiency study. This is not held-out evaluation or a source-mapping implementation.

## Objective and boundary

This study asks what independent evidence is needed to establish that a Raw Text UTF-16 source span corresponds to a particular PDF-native source token. It keeps three questions separate: A1, whether normalized text occurs in the frozen PDF token stream; A2, what physical PDF evidence identifies the corresponding item or glyph; and A3, whether provenance directly links the Raw Text span to that PDF source identity.

No source-mapping resolver, alignment algorithm, row/region parser, semantic ownership decision, or assembly is implemented. P2, P3, and P4 results and frozen files remain unchanged. Text uniqueness, coordinate proximity, visual similarity, independent review, or a second extractor cannot by themselves establish A3.

## Frozen population

The population is all 17 P3 segments whose frozen M0 result is `UNIQUE_TEXT_OCCURRENCE` with exactly one occurrence. P3 IDs are retained. P3 M1 results form descriptive strata: 4 `UNIQUE_CONTEXT_OCCURRENCE` and 13 `CONTEXT_NOT_MATCHED`. The population builder verifies the archived P3 ZIP SHA-256 and CRC, hashes the P3 outputs and crosswalk, and requires 43 P3 segments plus the exact 17 / 4 / 13 counts. It makes no new source-correspondence judgment.

The archived P3 ZIP is `20261011_2251_FY2024_TOC_Source_Token_Mapping_P3_FINAL.zip`, SHA-256 `73e231ec306c6d017d3acb2720ea92428d90b89353e2d315e053c44789d7a62c`. The P3 crosswalk is `tests/fixtures/budget-request-toc-source-token-mapping/2024/development-inventory.json` (SHA-256 `c66c671a04fcbd5d34f7f5f31ace35d776e73fd38f6958268df0ff10a6678b56`). Frozen population and blinded packet are recorded beside this document under `tests/fixtures/budget-request-toc-source-correspondence-anchor/2024/`.

The original Plain Text files are not materialized in the canonical `data/work` directory. The P3 archive contains the exact selected full Raw Text lines and fragments, each with the recorded original-file SHA-256; P3's frozen population process previously verified the UTF-16 spans against the source files. P5 uses those hash-bound line snapshots and prior validation as source snapshots. This is a limitation: P5 cannot freshly hash the complete original TXT files in this workspace.

## Evidence model and outcomes

### A1 — text occurrence

Compare the exact segment and frozen P3 M0 occurrence evidence. Record normalized strings, P3 stream hash and offset, occurrence count, pdf.js item range, and item-local code-point/UTF-16 offsets. This is verification of text occurrence only. Do not rerun or alter P3 matching.

### A2 — PDF physical evidence

For each relevant PDF page, inspect P3 pdf.js 5.4.296 item text, item index, transform and bbox, and render the source PDF with Poppler `pdftoppm` 26.09.0 at 150 DPI for visual observation. Record the observed glyph text, page, item and position granularity (`PAGE_LEVEL`, `REGION_LEVEL`, `ITEM_LEVEL`, `CHARACTER_LEVEL`, `UNDETERMINED`) and native-text/render agreement. An item bbox is never a per-character bbox. A second extraction with Poppler `pdftotext` / `-bbox-layout` may be recorded as I2 evidence, not as a direct Raw Text offset link. Never use coordinates or meaning to choose among repeated strings.

### A3 — Raw Text source correspondence

Assess whether an auditable, reproducible transformation provenance links the specific Raw Text UTF-16 offset to the specific PDF source identity and excludes competing interpretations. A3 outcomes are `SOURCE_CORRESPONDENCE_CONFIRMED`, `SOURCE_CORRESPONDENCE_REJECTED`, `AMBIGUOUS`, or `UNDETERMINABLE`. CONFIRMED requires an actual source-to-output trace; text uniqueness, visual inspection, spatial proximity, semantic plausibility, or agreement between extractors is insufficient. Context mismatch alone does not justify REJECTED.

### Evidence independence

- I1: an independent reviewer repeats observation; this tests review reproducibility, not source independence.
- I2: a different extractor observes the same PDF; this tests extractor-dependent differences, not a direct Raw Text provenance link.
- I3: the actual Raw Text transformation path links output offsets to PDF text/glyph identities; this can support A3 if the link is reproducible and excludes alternatives.

Record observation, interpretation, uncertainty, tool/version/options, and source hashes separately. Do not use P1 ownership labels, P4 speculative cause classes, or semantic item identity.

## Procedure fixed before P5 evidence assessment

1. Generate the 17-row population and blinded packet from the frozen P3 archive and P3 development crosswalk. Reject unexpected hashes or counts.
2. For A1, inspect the frozen P3 M0 row and selected occurrence metadata without recomputing matches.
3. For A2, inspect the corresponding source PDF page, pdf.js item metadata from the frozen P3 token manifest, and a 150-DPI Poppler render. Record item-level versus character-level precision explicitly. Poppler output is supplementary I2 evidence only.
4. For A3, inspect the Raw Text manifest, its named producer and frozen input metadata, the producer source, P3 source-span validation, and any available offset/glyph trace. Do not regenerate Raw Text or invent an offset map.
5. Assign A1/A2/A3 records independently. For A3, identify evidence for and against each outcome and list missing evidence. If the direct link is unavailable, use `UNDETERMINABLE` rather than infer.
6. Failure families may overlap: AF-1 text-only evidence; AF-2 insufficient physical-position granularity; AF-3 missing extraction provenance; AF-4 extractor ordering/identity difference; AF-5 multiple plausible correspondences; AF-6 insufficient/mixed/other. Use primary and secondary labels only when supported; otherwise retain an unresolved reason.
7. After primary records are finalized, an independent Orca reviewer reviews all 17 segments without primary A3 decisions or P1/P4 labels. Compare A1, A2, A3, evidence-independence, and missing-evidence assessments after both records are complete. Preserve disagreements; do not majority-vote.
8. Regenerate only mechanical inventory and summary outputs twice and compare bytes/hashes. Human visual judgments remain separate.

## Source provenance and tools

The Raw Text manifest identifies `scripts/pipeline-v2/build-budget-request-raw-text.ts`, Poppler `pdftotext` 26.09.0, `-layout -enc UTF-8`, form-feed page splitting, and the frozen manifest inputs. P3 used pdf.js 5.4.296 with `getTextContent({ disableNormalization: true })`. P5's planned render/extraction observations use Poppler 26.09.0. Actual installed tool versions and options are recorded in the run manifest. These are source observations, not a claim that Poppler and pdf.js share token identity.

## STOP conditions

Stop if P3 source artifacts or hashes fail, the 17 M0 Unique rows cannot be reconstructed, source PDF hashes mismatch, the P3 frozen status differs from the archive, or evidence assessment would require semantic ownership, a new resolver, or changing P3 rules. Missing direct provenance, absent character-level bboxes, ambiguous outcomes, and zero A3 confirmations are valid research results.

## Reproduction

```sh
python3 scripts/research/build-toc-source-correspondence-p5-population.py \
  --p3-zip <verified-P3-archive.zip> \
  --development-inventory tests/fixtures/budget-request-toc-source-token-mapping/2024/development-inventory.json \
  --output-dir tests/fixtures/budget-request-toc-source-correspondence-anchor/2024
```

The source archive and crosswalk are inputs. The generated population and packet are committed unchanged at freeze. P5 is development evidence and does not estimate accuracy or authorize alignment, assembly, or production integration.
