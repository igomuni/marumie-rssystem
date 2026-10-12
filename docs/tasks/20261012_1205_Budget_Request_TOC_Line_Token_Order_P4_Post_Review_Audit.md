# P4 Post-Review Audit Supplement

## Scope

This is an audit supplement to the P4 result. It does not alter the frozen P4 protocol, population, observations, P3 outputs, independent-review original, or the original P4 export ZIP. It records a post-review ID-level comparison after both primary and independent classifications had been finalized.

## Classification reconciliation

The independent review's fixed sample contains 28 of the 43 P4 segments: all 20 M1 `CONTEXT_NOT_MATCHED` segments, plus the first four M1 `MULTIPLE_CONTEXT_OCCURRENCES` and first four M1 `UNIQUE_CONTEXT_OCCURRENCE` segments by P3 segment ID. All 28 IDs occur in the primary classification.

| Classification pair | Count |
|---|---:|
| Primary F6 / Independent F6 | 20 |
| Primary `NO_CONTEXT_FAILURE_OBSERVED` / Independent `NO_CONTEXT_FAILURE_OBSERVED` | 8 |
| Disagreement | 0 |
| **Total compared** | **28** |

Thus, classification records agree 28/28 in the fixed reviewed subset. The independent reviewer remained blinded to primary classifications during source review; the comparison was performed afterward. This is label agreement between two records, not proof that F6 or any causal explanation is objectively correct. The independent CSV's contemporaneous field `NOT_ASSESSABLE_WITHOUT_PRIMARY_CLASSIFICATION` remains unchanged because it accurately describes what the reviewer could assess while blinded.

The row-level reconciliation is stored at `tests/fixtures/budget-request-toc-line-token-order-p4-audit/2024/classification-reconciliation.csv` (SHA-256: `a4b988fecc99de2eb2d1f4d0c348dd3cdecdc459bba2f6a0d21d899645d21d48`). It contains only the 28 shared P3 segment IDs and the agreement interpretation limit.

## Intermediate classification attempts

Two intermediate review artifacts used F1/F4 labels that did not consistently satisfy the frozen P4 family definitions. A later source-verified review applied the strict criteria: context mismatch alone did not establish F1, and item-boundary crossing alone did not establish F4. The intermediate artifacts remain preserved in the external P4 audit export as process history; their family counts are excluded from the final P4 classification and from the reconciliation above. No frozen P4 observation or review original was rewritten.

## Boundary

The 28/28 result is limited to classification-record agreement for the fixed review subset. It does not convert the 20 F6 observations into identified causes, does not establish mapping accuracy, and does not change the P4 conclusion that the causal mechanism remains unresolved. The original P4 ZIP and its hash remain unchanged.
