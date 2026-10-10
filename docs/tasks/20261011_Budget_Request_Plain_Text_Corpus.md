# FY2024 Budget Request Plain Text Corpus

## Purpose and scope

Add a separate PDF-to-plain-text entry point for future CSV analysis. It uses the existing FY2024 acquisition manifest to enumerate physical PDFs and the frozen `raw-text-manifest.json` only to validate source PDF hashes, page counts, and per-page text hashes.

For every PDF the producer runs exactly `pdftotext -layout -enc UTF-8 <pdf> -`, captures stdout as a `Buffer`, validates UTF-8, counts form-feed bytes against `pdfinfo` page count, and checks each page chunk SHA-256 against the frozen record. The required terminal form feed is retained in the output; only the final empty chunk created by splitting on that terminal byte is excluded from page counting. Output bytes are written unchanged to `data/work/budget-request-plain-text/2024/<deterministic-pdf-slug>.txt`.

Whitespace, newlines, Unicode encoding, and form feeds are preserved. There is no trimming, normalization, line joining, page JSON/JSONL record, or JSONL intermediate in this path. Source PDFs are checked against frozen hashes before extraction and after extraction.

## Coexistence contract

Plain-text files are an additional input format for future CSV analysis. The existing JSONL producer and its consumers remain unchanged during coexistence. Caller migration is outside this change; no CSV, Cover, or TOC implementation is included.

The frozen raw-text fixture and source PDFs are immutable validation inputs. Full TXT outputs live under `data/work/` and remain untracked.

## Entry point and tests

Run with `npx tsx scripts/pipeline-v2/build-budget-request-plain-text.ts` (an optional `--out-root=<dir>` supports isolated runs). Unit tests in `scripts/pipeline-v2/lib/budget-request-plain-text.test.ts` exercise byte boundaries, empty pages, Unicode/layout whitespace, errors, slug determinism, and collisions.
