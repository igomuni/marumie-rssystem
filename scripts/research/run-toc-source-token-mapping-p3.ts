#!/usr/bin/env node
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractPageTokens, pdfjsVersion } from '../pipeline-v2/lib/budget-request-pdf-page';
import type { SourceToken } from '../pipeline-v2/lib/budget-request-source-token';
import {
  codePointSpans,
  isUnicodeWhitespace,
  matchesContextRange,
  normalize,
  occurrences,
  splitSegments,
  statusM0,
  statusM1,
} from './toc-source-token-mapping-p3-core';

type BlindFragment = {
  mappingCandidateId: string;
  fragmentId: string;
  sourcePdf: string;
  physicalPage: number;
  rawLineIndexPageLocal: number;
  sourceSpanUtf16: [number, number];
  exactSourceFragment: string;
  exactFullRawLine: string;
  sourcePdfSha256: string;
  rawTextFile: string;
  rawTextFileSha256: string;
};

type CharacterOrigin = {
  itemIndex: number;
  itemCodePointOffset: number;
  itemUtf16Offset: number;
  originalCodePoint: string;
};

type StreamPage = {
  sourcePdf: string;
  physicalPage: number;
  sourcePdfSha256: string;
  normalizedStream: string;
  streamHash: string;
  origins: CharacterOrigin[];
  manifest: Record<string, unknown>;
};

function digest(buffer: Buffer | string): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sourceLines(pageText: string): string[] {
  if (pageText.length === 0) return [];
  const lines = pageText.split(/\r\n|[\n\v\f\r\x1c-\x1e\u0085\u2028\u2029]/u);
  if (/[\n\v\f\r\x1c-\x1e\u0085\u2028\u2029]$/u.test(pageText)) lines.pop();
  return lines;
}

function parseArgs(argv: string[]): { packet: string; pdfRoot: string; rawTextRoot: string; outDir: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: tsx scripts/research/run-toc-source-token-mapping-p3.ts --packet FILE --pdf-root DIR --raw-text-root DIR --out-dir DIR\n',
      );
      process.exit(0);
    }
    if (!arg.startsWith('--') || !argv[i + 1]) throw new Error(`Invalid argument near ${arg}`);
    values.set(arg.slice(2), argv[i + 1]);
    i += 1;
  }
  for (const key of ['packet', 'pdf-root', 'raw-text-root', 'out-dir']) {
    if (!values.has(key)) throw new Error(`Missing --${key}`);
  }
  return {
    packet: path.resolve(values.get('packet')!),
    pdfRoot: path.resolve(values.get('pdf-root')!),
    rawTextRoot: path.resolve(values.get('raw-text-root')!),
    outDir: path.resolve(values.get('out-dir')!),
  };
}

function verifySourceInputs(items: BlindFragment[], pdfRoot: string, rawTextRoot: string): void {
  const checkedPdfs = new Map<string, string>();
  const checkedTextFiles = new Map<string, string>();
  for (const item of items) {
    const pdfPath = path.join(pdfRoot, item.sourcePdf);
    const pdfHash = checkedPdfs.get(pdfPath) ?? digest(fs.readFileSync(pdfPath));
    if (pdfHash !== item.sourcePdfSha256) throw new Error(`PDF source hash mismatch: ${item.sourcePdf}`);
    checkedPdfs.set(pdfPath, pdfHash);

    const relativeTextPath = item.rawTextFile.replace(/^data\/work\/budget-request-plain-text\/2024\//u, '');
    const textPath = path.join(rawTextRoot, relativeTextPath);
    const textHash = checkedTextFiles.get(textPath) ?? digest(fs.readFileSync(textPath));
    if (textHash !== item.rawTextFileSha256) throw new Error(`Raw Text file hash mismatch: ${item.rawTextFile}`);
    checkedTextFiles.set(textPath, textHash);

    const text = fs.readFileSync(textPath, 'utf8');
    const pages = text.split('\f');
    const pageText = pages[item.physicalPage - 1];
    if (pageText === undefined) throw new Error(`Plain Text page missing: ${item.sourcePdf} p${item.physicalPage}`);
    const lines = sourceLines(pageText);
    const line = lines[item.rawLineIndexPageLocal];
    if (line === undefined || line !== item.exactFullRawLine) {
      throw new Error(`Raw line mismatch: ${item.fragmentId} line ${item.rawLineIndexPageLocal}`);
    }
    if (line.slice(item.sourceSpanUtf16[0], item.sourceSpanUtf16[1]) !== item.exactSourceFragment) {
      throw new Error(`Raw source span mismatch: ${item.fragmentId}`);
    }
  }
}

function buildStream(tokens: SourceToken[], itemVersion: string, pageInfo: { pdf: string; page: number; hash: string }): StreamPage {
  const streamParts: string[] = [];
  const origins: CharacterOrigin[] = [];
  const tokenRows: Array<Record<string, unknown>> = [];
  let streamOffset = 0;
  for (const token of tokens) {
    const normalizedStart = streamOffset;
    let normalizedText = '';
    const originalPoints = codePointSpans(token.rawText);
    for (const original of originalPoints) {
      if (isUnicodeWhitespace(original.value)) continue;
      const value = original.value === '\u2011' ? '-' : original.value;
      normalizedText += value;
      for (const normalizedPoint of value) {
        streamParts.push(normalizedPoint);
        origins.push({
          itemIndex: token.index,
          itemCodePointOffset: original.codePointIndex,
          itemUtf16Offset: original.utf16Start,
          originalCodePoint: original.value,
        });
        streamOffset += 1;
      }
    }
    tokenRows.push({
      itemIndex: token.index,
      originalText: token.rawText,
      normalizedText,
      normalizedStreamStart: normalizedStart,
      normalizedStreamEnd: streamOffset,
      bbox: token.bbox,
      transform: token.transform,
      hasEOL: token.hasEOL,
    });
  }
  const normalizedStream = streamParts.join('');
  return {
    sourcePdf: pageInfo.pdf,
    physicalPage: pageInfo.page,
    sourcePdfSha256: pageInfo.hash,
    normalizedStream,
    streamHash: digest(normalizedStream),
    origins,
    manifest: {
      sourcePdf: pageInfo.pdf,
      physicalPage: pageInfo.page,
      sourcePdfSha256: pageInfo.hash,
      pdfjsVersion: itemVersion,
      extraction: { getTextContentOptions: { disableNormalization: true }, itemOrder: 'pdf.js content-stream order' },
      serialization: 'Concatenate item original strings in item order with no inserted separator; then remove Unicode whitespace and map U+2011 to U+002D.',
      tokenCount: tokens.length,
      normalizedStreamCodePointLength: origins.length,
      normalizedStreamSha256: digest(normalizedStream),
      normalizedStream,
      tokens: tokenRows,
    },
  };
}

function mappedOccurrence(range: { start: number; end: number }, page: StreamPage): Record<string, unknown> {
  const mapped = page.origins.slice(range.start, range.end);
  if (mapped.length !== range.end - range.start || mapped.length === 0) {
    return { ...range, tokenAttributionStatus: 'TOKEN_ATTRIBUTION_UNRESOLVED', tokenSpans: [] };
  }
  const spans: Array<{ itemIndex: number; startCodePoint: number; endCodePointExclusive: number; startUtf16: number; endUtf16Exclusive: number }> = [];
  for (const origin of mapped) {
    const last = spans.at(-1);
    if (
      last &&
      last.itemIndex === origin.itemIndex &&
      last.endCodePointExclusive === origin.itemCodePointOffset &&
      last.endUtf16Exclusive === origin.itemUtf16Offset
    ) {
      last.endCodePointExclusive += 1;
      last.endUtf16Exclusive += origin.originalCodePoint.length;
    } else {
      spans.push({
        itemIndex: origin.itemIndex,
        startCodePoint: origin.itemCodePointOffset,
        endCodePointExclusive: origin.itemCodePointOffset + 1,
        startUtf16: origin.itemUtf16Offset,
        endUtf16Exclusive: origin.itemUtf16Offset + origin.originalCodePoint.length,
      });
    }
  }
  return {
    ...range,
    tokenAttributionStatus: 'TOKEN_ATTRIBUTION_MAPPED',
    itemIndexRange: [Math.min(...mapped.map((item) => item.itemIndex)), Math.max(...mapped.map((item) => item.itemIndex))],
    tokenSpans: spans,
    characterOrigins: mapped,
  };
}

function writeJson(pathname: string, value: unknown): void {
  fs.writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(pathname: string, values: unknown[]): void {
  fs.writeFileSync(pathname, values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : ''), 'utf8');
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replace(/"/gu, '""')}"`;
}

function writeCsv(pathname: string, columns: string[], rows: Array<Record<string, unknown>>): void {
  const output = [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))];
  fs.writeFileSync(pathname, `${output.join('\n')}\n`, 'utf8');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const packetText = fs.readFileSync(args.packet, 'utf8');
  const fragments = packetText.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as BlindFragment);
  if (fragments.length !== 24) throw new Error(`Expected 24 blinded fragments, found ${fragments.length}`);
  verifySourceInputs(fragments, args.pdfRoot, args.rawTextRoot);

  const pdfjs = await pdfjsVersion();
  if (pdfjs !== '5.4.296') throw new Error(`Unexpected pdf.js version ${pdfjs}; expected 5.4.296`);
  const pageKeys = [...new Map(fragments.map((item) => [`${item.sourcePdf}\u0000${item.physicalPage}`, item])).values()];
  const pageStreams = new Map<string, StreamPage>();
  for (const item of pageKeys) {
    const pdfPath = path.join(args.pdfRoot, item.sourcePdf);
    const extracted = await extractPageTokens(pdfPath, item.physicalPage);
    const key = `${item.sourcePdf}\u0000${item.physicalPage}`;
    pageStreams.set(key, buildStream(extracted.tokens, pdfjs, { pdf: item.sourcePdf, page: item.physicalPage, hash: item.sourcePdfSha256 }));
  }

  const segments = splitSegments(fragments.map((item) => ({
    ...item,
    sourceLineIndexPageLocal: item.rawLineIndexPageLocal,
  })));
  const m0Rows: Array<Record<string, unknown>> = [];
  const m1Rows: Array<Record<string, unknown>> = [];
  const segmentRows: Array<Record<string, unknown>> = [];
  for (const segment of segments) {
    const page = pageStreams.get(`${segment.sourcePdf}\u0000${segment.physicalPage}`);
    if (!page) throw new Error(`Token stream unavailable for ${segment.sourcePdf} p${segment.physicalPage}`);
    const m0 = occurrences(page.normalizedStream, segment.normalizedSegment);
    const hasContext = Boolean(segment.contextBefore || segment.contextAfter);
    const m1 = hasContext
      ? m0.filter((range) => matchesContextRange(page.normalizedStream, range, segment.contextBefore, segment.contextAfter))
      : m0;
    const m0Mapped = m0.map((range) => mappedOccurrence(range, page));
    const m1Mapped = m1.map((range) => mappedOccurrence(range, page));
    const base = {
      ...segment,
      pageNormalizedStreamSha256: page.streamHash,
      m0Status: statusM0(m0),
      occurrenceCount: m0.length,
      occurrences: m0Mapped,
    };
    const contextStatus = !hasContext && m0.length === 0 ? 'CONTEXT_NOT_MATCHED' : statusM1(m1);
    m0Rows.push(base);
    m1Rows.push({
      ...segment,
      pageNormalizedStreamSha256: page.streamHash,
      m0OccurrenceCount: m0.length,
      m1Status: contextStatus,
      contextBefore: segment.contextBefore,
      contextAfter: segment.contextAfter,
      contextUsed: hasContext,
      occurrenceCount: m1.length,
      occurrences: m1Mapped,
      note: !hasContext && m0.length === 0 ? 'M0 had no occurrence; context could not be applied.' : undefined,
    });
    segmentRows.push({
      ...segment,
      m0Status: statusM0(m0),
      m0OccurrenceCount: m0.length,
      m1Status: contextStatus,
      m1OccurrenceCount: m1.length,
      m0UniqueTokenAttribution: m0.length === 1 && (m0Mapped[0] as { tokenAttributionStatus: string }).tokenAttributionStatus === 'TOKEN_ATTRIBUTION_MAPPED',
      m1UniqueTokenAttribution: m1.length === 1 && (m1Mapped[0] as { tokenAttributionStatus: string }).tokenAttributionStatus === 'TOKEN_ATTRIBUTION_MAPPED',
    });
  }

  const fragmentRows: Array<Record<string, unknown>> = fragments.map((fragment) => {
    const rows = segmentRows.filter((row) => row.fragmentId === fragment.fragmentId);
    const m0Unique = rows.length > 0 && rows.every((row) => row.m0Status === 'UNIQUE_TEXT_OCCURRENCE');
    const m1Unique = rows.length > 0 && rows.every((row) => row.m1Status === 'UNIQUE_CONTEXT_OCCURRENCE');
    return {
      mappingCandidateId: fragment.mappingCandidateId,
      fragmentId: fragment.fragmentId,
      sourcePdf: fragment.sourcePdf,
      physicalPage: fragment.physicalPage,
      segmentCount: rows.length,
      m0FragmentStatus: m0Unique ? 'TEXT_UNIQUE_UNVERIFIED' : 'UNRESOLVED',
      m1FragmentStatus: m1Unique ? 'TEXT_UNIQUE_UNVERIFIED' : 'UNRESOLVED',
      m0AllSegmentsTextUnique: m0Unique,
      m1AllSegmentsTextUnique: m1Unique,
      tokenAttributionUnresolvedM0: rows.filter((row) => row.m0Status === 'UNIQUE_TEXT_OCCURRENCE' && !row.m0UniqueTokenAttribution).length,
      tokenAttributionUnresolvedM1: rows.filter((row) => row.m1Status === 'UNIQUE_CONTEXT_OCCURRENCE' && !row.m1UniqueTokenAttribution).length,
    };
  });
  const candidateRows: Array<Record<string, unknown>> = [...new Set(fragments.map((fragment) => fragment.mappingCandidateId))].map((candidateId) => {
    const rows = fragmentRows.filter((row) => row.mappingCandidateId === candidateId);
    return {
      mappingCandidateId: candidateId,
      fragmentCount: rows.length,
      m0CandidateStatus: rows.length === 2 && rows.every((row) => row.m0FragmentStatus === 'TEXT_UNIQUE_UNVERIFIED') ? 'BOTH_FRAGMENTS_TEXT_UNIQUE_UNVERIFIED' : 'PARTIAL_OR_UNRESOLVED',
      m1CandidateStatus: rows.length === 2 && rows.every((row) => row.m1FragmentStatus === 'TEXT_UNIQUE_UNVERIFIED') ? 'BOTH_FRAGMENTS_TEXT_UNIQUE_UNVERIFIED' : 'PARTIAL_OR_UNRESOLVED',
    };
  });

  fs.mkdirSync(args.outDir, { recursive: true });
  fs.copyFileSync(args.packet, path.join(args.outDir, 'blinded-mapping-input.jsonl'));
  writeJson(path.join(args.outDir, 'source-token-manifest.json'), {
    schema: 'toc-p3-pdf-source-token-manifest/v1',
    pdfjsVersion: pdfjs,
    pages: [...pageStreams.values()].map((page) => page.manifest),
  });
  writeJsonl(path.join(args.outDir, 'm0-segment-matches.jsonl'), m0Rows);
  writeJsonl(path.join(args.outDir, 'm1-segment-matches.jsonl'), m1Rows);
  const statusColumns = [
    'mappingCandidateId','fragmentId','sourcePdf','physicalPage','sourceLineIndexPageLocal','sourceSpanUtf16','rawSegment','normalizedSegment','contextBefore','contextAfter','m0Status','m0OccurrenceCount','m1Status','m1OccurrenceCount','m0UniqueTokenAttribution','m1UniqueTokenAttribution',
  ];
  writeCsv(path.join(args.outDir, 'segment-mapping-status.csv'), statusColumns, segmentRows);
  writeCsv(path.join(args.outDir, 'fragment-mapping-status.csv'), Object.keys(fragmentRows[0] ?? {}), fragmentRows);
  writeCsv(path.join(args.outDir, 'candidate-mapping-status.csv'), Object.keys(candidateRows[0] ?? {}), candidateRows);

  const count = (field: 'm0Status' | 'm1Status', value: string) => segmentRows.filter((row) => row[field] === value).length;
  const summary = {
    schema: 'toc-p3-source-token-mapping-summary/v1',
    researchPosition: 'exploratory development; not held-out; text occurrence is not source correspondence or ownership',
    candidateCount: candidateRows.length,
    fragmentCount: fragments.length,
    segmentCount: segments.length,
    pdfCount: new Set(fragments.map((item) => item.sourcePdf)).size,
    physicalPdfPageCount: pageStreams.size,
    pdfjsVersion: pdfjs,
    m0: {
      unique: count('m0Status', 'UNIQUE_TEXT_OCCURRENCE'),
      multiple: count('m0Status', 'MULTIPLE_TEXT_OCCURRENCES'),
      unmatched: count('m0Status', 'NO_TEXT_OCCURRENCE'),
    },
    m1: {
      unique: count('m1Status', 'UNIQUE_CONTEXT_OCCURRENCE'),
      multiple: count('m1Status', 'MULTIPLE_CONTEXT_OCCURRENCES'),
      unmatchedOrContextNotMatched: count('m1Status', 'CONTEXT_NOT_MATCHED'),
    },
    transitions: {
      m0MultipleToM1Unique: segmentRows.filter((row) => row.m0Status === 'MULTIPLE_TEXT_OCCURRENCES' && row.m1Status === 'UNIQUE_CONTEXT_OCCURRENCE').length,
      m0UniqueToM1ContextNotMatched: segmentRows.filter((row) => row.m0Status === 'UNIQUE_TEXT_OCCURRENCE' && row.m1Status === 'CONTEXT_NOT_MATCHED').length,
      occurrenceCountUnchanged: segmentRows.filter((row) => row.m0OccurrenceCount === row.m1OccurrenceCount).length,
      m0MultipleToM1Multiple: segmentRows.filter((row) => row.m0Status === 'MULTIPLE_TEXT_OCCURRENCES' && row.m1Status === 'MULTIPLE_CONTEXT_OCCURRENCES').length,
      m0UniqueToM1Unique: segmentRows.filter((row) => row.m0Status === 'UNIQUE_TEXT_OCCURRENCE' && row.m1Status === 'UNIQUE_CONTEXT_OCCURRENCE').length,
    },
    tokenAttribution: {
      m0UniqueMapped: segmentRows.filter((row) => row.m0UniqueTokenAttribution).length,
      m0UniqueUnresolved: segmentRows.filter((row) => row.m0Status === 'UNIQUE_TEXT_OCCURRENCE' && !row.m0UniqueTokenAttribution).length,
      m1UniqueMapped: segmentRows.filter((row) => row.m1UniqueTokenAttribution).length,
      m1UniqueUnresolved: segmentRows.filter((row) => row.m1Status === 'UNIQUE_CONTEXT_OCCURRENCE' && !row.m1UniqueTokenAttribution).length,
    },
    fragmentStatuses: {
      m0TextUniqueUnverified: fragmentRows.filter((row) => row.m0FragmentStatus === 'TEXT_UNIQUE_UNVERIFIED').length,
      m0Unresolved: fragmentRows.filter((row) => row.m0FragmentStatus === 'UNRESOLVED').length,
      m1TextUniqueUnverified: fragmentRows.filter((row) => row.m1FragmentStatus === 'TEXT_UNIQUE_UNVERIFIED').length,
      m1Unresolved: fragmentRows.filter((row) => row.m1FragmentStatus === 'UNRESOLVED').length,
    },
    candidateStatuses: {
      m0BothFragmentsTextUniqueUnverified: candidateRows.filter((row) => row.m0CandidateStatus === 'BOTH_FRAGMENTS_TEXT_UNIQUE_UNVERIFIED').length,
      m1BothFragmentsTextUniqueUnverified: candidateRows.filter((row) => row.m1CandidateStatus === 'BOTH_FRAGMENTS_TEXT_UNIQUE_UNVERIFIED').length,
      m0PartialOrUnresolved: candidateRows.filter((row) => row.m0CandidateStatus === 'PARTIAL_OR_UNRESOLVED').length,
      m1PartialOrUnresolved: candidateRows.filter((row) => row.m1CandidateStatus === 'PARTIAL_OR_UNRESOLVED').length,
    },
    matchingInputsHadOwnershipLabels: false,
    geometryUsedForSelection: false,
    assemblyPerformed: false,
  };
  writeJson(path.join(args.outDir, 'exploratory-summary.json'), summary);
  writeJson(path.join(args.outDir, 'run-metadata.json'), {
    command: 'npx tsx scripts/research/run-toc-source-token-mapping-p3.ts --packet <blinded-mapping-input.jsonl> --pdf-root <repo-data-root> --raw-text-root <plain-text-2024-root> --out-dir <output-directory>',
    sourcePdfRoot: args.pdfRoot,
    sourceRawTextRoot: args.rawTextRoot,
    packetSha256: digest(packetText),
    sourcePdfHashes: Object.fromEntries([...new Set(fragments.map((item) => item.sourcePdf))].map((pdf) => [pdf, fragments.find((item) => item.sourcePdf === pdf)!.sourcePdfSha256])),
    sourceRawTextHashes: Object.fromEntries([...new Set(fragments.map((item) => item.rawTextFile))].map((text) => [text, fragments.find((item) => item.rawTextFile === text)!.rawTextFileSha256])),
    outputFiles: Object.fromEntries(fs.readdirSync(args.outDir).filter((name) => name !== 'run-metadata.json').sort().map((name) => [name, digest(fs.readFileSync(path.join(args.outDir, name))) ])),
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
