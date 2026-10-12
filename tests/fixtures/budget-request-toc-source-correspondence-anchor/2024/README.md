# FY2024 TOC P5 — Source Correspondence Anchor

This package records the P5 development evidence-sufficiency study. It does not contain an alignment or mapping resolver. A1/A2 evidence is separated from A3 source correspondence; all A3 outcomes are `UNDETERMINABLE`.

## Population

17 frozen P3 M0-unique segments (4 M1-unique; 13 M1-context-not-matched), 12 candidates, 13 fragments, 8 PDFs / physical pages. The source P3 archive is included unchanged under `inputs/` and has SHA-256 `73e231ec306c6d017d3acb2720ea92428d90b89353e2d315e053c44789d7a62c`.

## Key outputs

- `p5-population-inventory.json`, `p5-blinded-evidence-packet.jsonl`
- `a1-text-occurrence-evidence.jsonl`, `a2-pdf-token-items.jsonl`, `a2-visual-observations.csv`
- `a3-provenance-evidence.csv`, `extraction-path-assessment.md`
- `primary-source-anchor-review.csv`, `independent-source-anchor-review.csv`, `review-reconciliation.csv`
- `anchor-failure-family-summary.csv`, `evidence-sufficiency-matrix.csv`
- `pdf-renders/` contains the 8 source-page renders at 150 DPI with a render manifest.
- `input-output-hashes.json`, `validation.json`

The original complete Raw Text files were not materialized in the canonical data directory. P5 uses exact P3 frozen line snapshots and the prior P3 source-span validation. No P4 ZIP was restored or recreated.

## Reproduction

See `p5-protocol.md`. The two scripts under `reproduction/` reproduce the fixed population and A1/A2 machine evidence using the included P3 ZIP, the tracked P3 crosswalk, and read-only source PDFs. The primary and independent visual reviews are human observations and are preserved separately.
