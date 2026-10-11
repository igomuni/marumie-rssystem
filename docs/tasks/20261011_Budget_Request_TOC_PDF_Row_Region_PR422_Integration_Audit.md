# FY2024 Budget Request TOC P2 — PR #422 Integration / Audit Remediation

## Scope and status

This integration preserves the P2 study result. It reconstructs the three original PR #422 commits, in their original order, on the latest main observed for this audit. It does not change the P2 hypotheses, freeze, candidate inventory, matching rule, or ownership labels.

## Preflight

- PR #422 was OPEN / Draft / unmerged, based on `main`, with head `c77e923688018adec8580b0ddb66a860516a6e4c`; GitHub reported `CONFLICTING` / `DIRTY`.
- Latest main was `ff634d7197ce626f2a21ac6b41255f00d38d598f`.
- The original PR worktree was clean and at the expected head. It was left unchanged.
- Freeze document SHA-256: `c9ce012cd9c52240bd92d1067ec9d809189c9c19af209d8c721a89397fc5cdbb`.
- Candidate inventory SHA-256: `0dcf19a039de8ae79258405b3e1464dae63fb3b0b3f118a5a924f3e95723b438`.
- Candidate manifest SHA-256: `83ef9495efff3f15af84db3005d8e79b84b22180b0d55958ab0503266396e7ed`.
- Original P2 result ZIP SHA-256 before the audit-field correction: `df8bd61d8c50542d150478678fa2b8f614210cc4a42e5bda46927d90852a9b84`.
- Corrected P2 result ZIP SHA-256: `c02500e61178535699c377d431272814460043d310b1e3151e0f12c336da78f4`.

## Commit reconstruction and conflict

On a new Orca-managed branch based on latest main, the original commits were cherry-picked in order with `-x`:

1. `4d050b6cf7e25caa4825e70b726686a8c4091ebd` → `3edc625`
2. `dc51059ddd6cf591af805494170e9cb263ee8a95` → `a12f216`
3. `c77e923688018adec8580b0ddb66a860516a6e4c` → `048c38b`

Both cherry-pick conflicts were limited to `docs/tasks/INDEX.md`. The integration index retains main's total-table P0 entry and both distinct P2 entries (tool assessment and results). No total-table research file was edited.

All ten original PR-added P2 files other than the shared index were byte-equivalent between the original PR head and the reconstructed branch. The three frozen candidate source files retain their original SHA-256 values. Commit trailers preserve the source commit IDs. The original PR branch and worktree were not reset, rebased, amended, deleted, or force-pushed.

## Audit A — text matching reproducibility

An independent read-only rerun reproduced the reported aggregate over 185 segments: 72 unique text matches, 113 multiple matches, and 0 unmatched. The reconstruction used the documented outline: split candidate fragments on runs of at least two whitespace characters; concatenate pdf.js text items in content-stream order; ignore whitespace and normalize the observed U+2011 / ASCII-hyphen difference for comparison.

The original scratch script is absent. Therefore the aggregate has been independently reproduced under the documented reconstruction, while exact original normalization details and byte-identical recreation of the first run remain unverified. No geometry was collected and no ownership judgment was made in this audit.

## Audit B — prior integrated ownership provenance

The frozen candidate inventory has a non-empty `previous_integrated_ownership` field for all 50 candidates: 31 `SAME_ITEM`, 16 `DISTINCT_ITEMS`, and 3 `AMBIGUOUS`. The corrected export maps that field verbatim to the run artifact's `prior_integrated_ownership` column and validates the equality candidate by candidate. This copies prior labels only; it does not adjudicate or modify them.

## Validation and limits

- Reconstructed branch starts at `ff634d7197ce626f2a21ac6b41255f00d38d598f` and contains the source commits in order.
- Original P2 files except `docs/tasks/INDEX.md`: byte-equivalent.
- Freeze/input hashes: unchanged.
- INDEX keeps main's total-table entry and one entry for each distinct P2 document.
- P2 geometry remains `0/50`; no Layer B relation or new Layer C ownership decision was made.
- Exact matching-script normalization remains unverified because the original scratch script was unavailable.

The integration branch makes the preserved P2 evidence reviewable against latest main. It does not claim that the geometry comparison was completed.

## Final remediation addendum

### P2 Results restored

The P2 Results document is byte-equivalent to the file at original PR #422 head `c77e923688018adec8580b0ddb66a860516a6e4c`. Its Git blob is `6a8ed1c81a643ecff2b5caa64d57b40163642beb`. The post-P2 matching audit, ownership-provenance correction, and corrected-ZIP reference are recorded here instead of in the P2 Results document. The P2 freeze and findings remain unchanged.

### ZIP artifact identity and custody

Both archives are preserved as byte copies under distinct names in `data/work/exports/`:

| Artifact | File | SHA-256 | CRC | Contents and distinction |
|---|---|---|---|---|
| Original P2 ZIP | `20261011_2105_FY2024_TOC_P2_ORIGINAL.zip` | `df8bd61d8c50542d150478678fa2b8f614210cc4a42e5bda46927d90852a9b84` | PASS | Original stop inventory; `prior_integrated_ownership` is blank for all 50 rows. |
| Audited P2 ZIP | `20261011_2105_FY2024_TOC_P2_AUDITED.zip` | `c02500e61178535699c377d431272814460043d310b1e3151e0f12c336da78f4` | PASS | Audit correction copies prior ownership labels: 31 `SAME_ITEM`, 16 `DISTINCT_ITEMS`, 3 `AMBIGUOUS`. |

The original ZIP was copied byte-for-byte from the user-provided archive; the audited ZIP was copied byte-for-byte from the previously saved corrected archive. SHA-256 was checked before and after copying. Both ZIP CRC checks pass. Each archive's `input-output-hashes.json` entries match the corresponding archive members and frozen external input hashes. The audited ZIP also contains a `__pycache__` entry absent from the original archive; this packaging difference does not change the corrected status CSV or frozen inputs. The ownership-field transfer is a verbatim copy of prior classifications, not a new ownership judgment.

### Scope of the post-P2 audit

The documented reconstruction independently reproduces the aggregate `185 / 72 / 113 / 0` (segments / unique matches / multiple matches / unmatched). The original scratch script is unavailable; its exact normalization details and byte-equivalence of segment-level output remain unverified. This is a limited post-P2 audit acceptance, not a claim of complete reproduction and not a change to the P2 preregistration or frozen acceptance criteria.

P2 remains a source-to-coordinate mapping feasibility stop: all 50 candidates remain `STOP_NON_UNIQUE_TEXT_MAPPING`; geometry collection is `0/50`; no new Layer B relation or Layer C ownership judgment was made. P3 preregistration and implementation have not started. This audit is a separate supplementary record; it does not modify the original P2 result or freeze.

### Final integration checks

- The original #422 branch, worktree, and commits were left unchanged; its worktree is clean at `c77e923688018adec8580b0ddb66a860516a6e4c`.
- The original three commits remain ordered on this integration branch and retain their `cherry-pick -x` provenance: `4d050b6cf7e25caa4825e70b726686a8c4091ebd` → `3edc625`; `dc51059ddd6cf591af805494170e9cb263ee8a95` → `a12f216`; `c77e923688018adec8580b0ddb66a860516a6e4c` → `048c38b`.
- Latest main remains `ff634d7197ce626f2a21ac6b41255f00d38d598f`; its total-table research changes are preserved.
- Frozen P2 hashes remain: freeze document `c9ce012cd9c52240bd92d1067ec9d809189c9c19af209d8c721a89397fc5cdbb`, candidate inventory `0dcf19a039de8ae79258405b3e1464dae63fb3b0b3f118a5a924f3e95723b438`, and candidate manifest `83ef9495efff3f15af84db3005d8e79b84b22180b0d55958ab0503266396e7ed`.
- No source matching, PDF geometry, Row / Region Relation, or Assembly experiment was run as part of this final remediation.
