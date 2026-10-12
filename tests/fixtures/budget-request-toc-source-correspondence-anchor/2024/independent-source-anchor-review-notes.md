# Independent P5 review notes

- Population: 17 unique P3 segment IDs from the supplied blinded packet; all 17 have frozen P3 M0 status `UNIQUE_TEXT_OCCURRENCE` and occurrence count 1. P3 M1 is recorded as descriptive metadata only.
- A1: confirmed from frozen P3 M0 evidence only; matching was not rerun. Per-row stream hash, normalized stream offset, pdf.js item span, and item-local offsets are summarized in the CSV.
- A2: inspected all eight supplied 150-DPI renders. Visible page/table-row text agrees with the frozen native text. Available localization is item-level/page-row level; item boxes are not character boxes, and no character-level bbox is claimed.
- A3: `UNDETERMINABLE` for all 17. The manifest and producer identify Poppler `pdftotext -layout -enc UTF-8`, page splitting, source PDFs and hashes, but provide no auditable Raw Text UTF-16 offset to stable PDF token/glyph identity trace. Therefore I3 is absent; visual observation and text uniqueness do not establish correspondence.
- I1: this independent observation was performed. I2: producer/tool metadata was examined, but a separate Poppler `-bbox-layout` extraction was not performed and is not claimed. I3: no direct trace found.
- Method/tools: reviewed only the supplied P5 protocol, manifest, blinded packet, frozen P3 M0/M1, token manifest, Raw Text manifest, producer source and eight renders; inspected the rendered PNGs with local image viewing. Poppler version recorded by render manifest: 26.09.0; renders at 150 DPI. No prohibited prior review/failure artifacts were opened.
- Source access: all eight renders were available and visually inspected. No access failure encountered. P5 packet states complete original Plain Text files are not materialized here; this review therefore used hash-bound P3 line snapshots rather than freshly hashing those full TXT files.
- No ownership, semantic assembly, or correspondence conclusion was inferred. No tracked files were changed.
