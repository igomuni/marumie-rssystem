# P5 Raw Text Extraction Path Assessment

## Source facts

- `raw-text-manifest.json` identifies `scripts/pipeline-v2/build-budget-request-raw-text.ts` and records Poppler `pdftotext` 26.09.0 with `-layout -enc UTF-8`, form-feed page splitting, and manifest/base-input metadata. The frozen manifest SHA-256 is `d58e048b43a38b29d035ff07dbd2d664ad5bea28c50fed4e0c30c61052c3573`.
- The currently available producer source at P5 base is commit `e67613391407e7b60b58b4080e3c1cb66617dd05`; the producer file SHA-256 is `003b771244f583b688d80c8b7bba17b0d2b9f73a64ba1d5d39ba0d61974d77be`. Its helper `budget-request-raw-text.ts` has SHA-256 `42642b1eb0e768251c527f49b7f967b775ad82222ae6e89063a0b17d84007756`.
- The manifest's `frozenInput.baseCommit` is `663847fda868d8558084482e03a45b1f8a18f4ed`. The named generator source is not present at that commit; it was added in later PR #379. The manifest records tool/version/options but does not pin the generator source hash. Therefore the current source describes the recorded extraction path, but exact code identity at the original corpus generation is not independently established by the manifest.
- The current producer invokes `pdftotext -layout -enc UTF-8 <pdf> -`, then passes the returned string to page splitting and `buildPageRawText`. `PageRawText` stores page number, text, text hash, counts, status, and derived line strings/indexes. It does not store PDF text-object IDs, glyph IDs, item offsets, coordinates, or a per-character provenance map.
- P3 recorded the selected Raw Text lines/fragments and hashes in its frozen input packet. Its prefreeze validation checked selected source spans against the original Raw Text files. The complete original TXT files are not materialized in the current canonical `data/work` directory; P5 uses those exact frozen line snapshots and prior span-validation record. A fresh full-file TXT hash check was unavailable.
- P3's pdf.js 5.4.296 source-token manifest stores content-item indexes, text, item-local offsets, transforms, and item-level bboxes. It is a separate extraction representation; the stored P3 evidence contains no Poppler-output-offset to pdf.js item/glyph identity trace.

## Evidence-independence assessment

| Level | P5 evidence | Sufficiency limit |
|---|---|---|
| I1 independent reviewer | Required 17-segment review is recorded separately. | Repeats an observation; does not create a source-to-output trace. |
| I2 independent extraction | The Raw Text manifest identifies Poppler; P3 token metadata is from pdf.js; P5 rendered the source pages with Poppler. No second extraction output was used to select a token. | Same-PDF extractor agreement or coordinates alone do not directly link a Raw Text UTF-16 offset to a PDF identity. |
| I3 transformation provenance | Producer command, version, and page/line processing are documented; P3 verifies the selected span against frozen Raw Text snapshots. | No retained or reproducible character-offset-to-PDF-source-token trace was found. The exact generator code hash at original generation is also absent. |

## P5 conclusion for A3

The available evidence supports the Raw Text snapshots and P3 PDF-native text occurrences as separate observations. It does not prove which PDF source identity produced any particular Raw Text UTF-16 offset. Therefore all 17 A3 outcomes remain `UNDETERMINABLE`; none is `REJECTED`. This is an evidence limitation, not a claim that the text is absent or that a mapping is false. No Raw Text regeneration, alternate matching, or resolver was performed.
