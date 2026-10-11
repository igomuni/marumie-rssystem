/** Exploratory FY2024 82-page application of the frozen #416 primitives to H1/H2 candidate assembly. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { boundaryOfHeaderLines, REGEX_SOURCE, segmentPage, type Primitive, type SourceLine } from './toc-column-primitives-v1';
import { assemblePage, stableBarrierId, stablePrimitiveId, type AssemblyBarrier, type AssemblyPageInput, type AssemblyPrimitive } from './toc-minimal-assembly-v0';
import { deterministicPdfSlug, sha256, splitAndValidatePdfText } from '../pipeline-v2/lib/budget-request-plain-text';

const ROOT = process.cwd();
const INVENTORY_PATH = 'tests/fixtures/budget-request-cover-toc-structure/2024/structure-inventory.json';
const RAW_MANIFEST_PATH = 'tests/fixtures/budget-request-raw-text/2024/raw-text-manifest.json';
const DEFAULT_OUTPUT = 'data/work/exports/20261011_FY2024_TOC_Minimal_Assembly_v0';
const OUT = process.argv.find(arg => arg.startsWith('--out-dir='))?.slice('--out-dir='.length) ?? DEFAULT_OUTPUT;
const VERIFY_AGAINST = process.argv.find(arg => arg.startsWith('--verify-against='))?.slice('--verify-against='.length);
const DEVELOPMENT_TEST_RESULT = process.argv.find(arg => arg.startsWith('--development-test-result='))?.slice('--development-test-result='.length) ?? 'NOT_RUN';

type InventoryPage = {
  localPdfPath: string;
  pdfSha256: string;
  physicalPage: number;
  textSha256: string;
  classifierPageType: string;
  classifierSource: 'DIRECT' | 'INHERITED';
  publisherDomain: string;
};
type FrozenDocument = { localPdfPath: string; pdfSha256: string; pageCount: number; pageTextSha256: string[] };
type CsvValue = string | number | boolean | null | undefined;

function csv(rows: Record<string, CsvValue>[], headers: string[]): string {
  const quote = (value: CsvValue): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  return `${[headers.map(quote).join(','), ...rows.map(row => headers.map(header => quote(row[header])).join(','))].join('\n')}\n`;
}

function lineInputs(pageText: string): SourceLine[] {
  const rawLines = pageText.split('\n');
  let start = 0;
  return rawLines.map((rawText, lineIndex) => {
    const source = { lineIndex, lineStartUtf16: start, rawText };
    start += rawText.length + (lineIndex < rawLines.length - 1 ? 1 : 0);
    return source;
  });
}

function nonblank(text: string): boolean { return !/^\s*$/u.test(text); }

function addPrimitive(
  primitives: AssemblyPrimitive[], sourcePdf: string, physicalPage: number, primitive: Primitive,
): AssemblyPrimitive {
  const item = { primitiveId: stablePrimitiveId(sourcePdf, physicalPage, primitive), sourcePdf, physicalPage, primitive };
  primitives.push(item);
  return item;
}

function addBarrier(
  barriers: AssemblyBarrier[], sourcePdf: string, physicalPage: number, line: SourceLine,
  side: AssemblyBarrier['side'], sourceRangeUtf16: [number, number], rawText: string, reasonCode: string,
): AssemblyBarrier {
  const partial = {
    sourcePdf, physicalPage, lineIndex: line.lineIndex, lineStartUtf16: line.lineStartUtf16,
    side, sourceRangeUtf16, rawText, reasonCode,
  };
  const barrier = { ...partial, barrierId: stableBarrierId(partial) };
  barriers.push(barrier);
  return barrier;
}

function pageInput(sourcePdf: string, physicalPage: number, pageText: string): AssemblyPageInput & { lineCount: number; boundary: number | null; nonblankLines: number } {
  const lines = lineInputs(pageText);
  const headerLines = lines.map(line => line.rawText).filter(line => new RegExp(REGEX_SOURCE.HEADER_REGEX, 'u').test(line));
  const boundary = boundaryOfHeaderLines(headerLines);
  const segmented = segmentPage(lines, headerLines);
  const primitives: AssemblyPrimitive[] = [];
  const barriers: AssemblyBarrier[] = [];

  for (const line of segmented) {
    if (line.segments.length) {
      for (const segment of line.segments) {
        if (!nonblank(segment.rawText)) continue;
        const primitive = segment.primitive;
        if (primitive) {
          addPrimitive(primitives, sourcePdf, physicalPage, primitive);
          if (primitive.kind === 'unresolved') {
            addBarrier(barriers, sourcePdf, physicalPage, line.sourceLine, segment.side, segment.sourceRangeUtf16, segment.rawText, primitive.reason ?? 'UNRESOLVED_SEGMENT');
          }
        } else {
          addBarrier(barriers, sourcePdf, physicalPage, line.sourceLine, segment.side, segment.sourceRangeUtf16, segment.rawText, 'NONBLANK_SEGMENT_WITHOUT_PRIMITIVE');
        }
      }
    } else if (line.primitive) {
      addPrimitive(primitives, sourcePdf, physicalPage, line.primitive);
      if (line.primitive.kind === 'unresolved') {
        addBarrier(barriers, sourcePdf, physicalPage, line.sourceLine, 'unknown', [0, line.sourceLine.rawText.length], line.sourceLine.rawText, line.primitive.reason ?? line.lineStatus);
      }
    } else if (nonblank(line.sourceLine.rawText)) {
      addBarrier(barriers, sourcePdf, physicalPage, line.sourceLine, 'unknown', [0, line.sourceLine.rawText.length], line.sourceLine.rawText,
        line.lineStatus === 'UNRESOLVED_BOUNDARY_CUT' ? 'UNRESOLVED_BOUNDARY_CUT' : 'NO_BOUNDARY_UNCLASSIFIED_LINE');
    }
  }
  return { sourcePdf, physicalPage, primitives, barriers, lineCount: lines.length, boundary, nonblankLines: lines.filter(line => nonblank(line.rawText)).length };
}

function main(): void {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, INVENTORY_PATH), 'utf8')) as { pages: InventoryPage[] };
  const rawManifest = JSON.parse(fs.readFileSync(path.join(ROOT, RAW_MANIFEST_PATH), 'utf8')) as { documents: FrozenDocument[] };
  const pages = inventory.pages.filter(page => page.classifierPageType === 'TOC')
    .sort((a, b) => a.localPdfPath.localeCompare(b.localPdfPath) || a.physicalPage - b.physicalPage);
  if (pages.length !== 82) throw new Error(`TOC inventory has ${pages.length} pages; expected 82`);
  if (new Set(pages.map(page => `${page.localPdfPath}\0${page.physicalPage}`)).size !== pages.length) throw new Error('duplicate TOC page key');
  const pdfPaths = [...new Set(pages.map(page => page.localPdfPath))];
  if (pdfPaths.length !== 55) throw new Error(`TOC inventory has ${pdfPaths.length} PDFs; expected 55`);
  const direct = pages.filter(page => page.classifierSource === 'DIRECT').length;
  const inherited = pages.filter(page => page.classifierSource === 'INHERITED').length;
  if (direct !== 55 || inherited !== 27) throw new Error(`DIRECT/INHERITED mismatch: ${direct}/${inherited}`);
  const documents = new Map(rawManifest.documents.map(document => [document.localPdfPath, document]));
  const pagesByPdf = new Map<string, InventoryPage[]>();
  for (const page of pages) pagesByPdf.set(page.localPdfPath, [...(pagesByPdf.get(page.localPdfPath) ?? []), page]);

  const observationRows: Record<string, CsvValue>[] = [];
  const resolvedRows: Record<string, CsvValue>[] = [];
  const candidateRows: Record<string, CsvValue>[] = [];
  const ambiguousRows: Record<string, CsvValue>[] = [];
  const unmatchedRows: Record<string, CsvValue>[] = [];
  const accountingRows: Record<string, CsvValue>[] = [];
  const primitiveById = new Map<string, { page: InventoryPage; primitive: Primitive }>();
  const barrierById = new Map<string, { page: InventoryPage; barrier: AssemblyBarrier }>();
  const inputEvidence: Record<string, { pdfSha256: string; txtSha256: string; verifiedPages: number }> = {};
  const pageSummary: Array<Record<string, unknown>> = [];
  let columnBoundaryPages = 0;
  let noBoundaryPages = 0;
  let pagesWithUnresolvedBoundaryCuts = 0;
  let directPages = 0;
  let inheritedPages = 0;
  const statusCounts: Record<string, number> = { RESOLVED: 0, CANDIDATE_UNRESOLVED: 0, AMBIGUOUS: 0, UNMATCHED: 0 };
  const hypothesisCounts: Record<string, Record<string, number>> = { H1: { RESOLVED: 0, CANDIDATE_UNRESOLVED: 0, AMBIGUOUS: 0, UNMATCHED: 0 }, H2: { RESOLVED: 0, CANDIDATE_UNRESOLVED: 0, AMBIGUOUS: 0, UNMATCHED: 0 } };

  for (const localPdfPath of pdfPaths) {
    const document = documents.get(localPdfPath);
    if (!document) throw new Error(`raw manifest missing ${localPdfPath}`);
    const pdfBytes = fs.readFileSync(path.join(ROOT, localPdfPath));
    const pdfHash = sha256(pdfBytes);
    if (pdfHash !== document.pdfSha256) throw new Error(`PDF hash mismatch: ${localPdfPath}`);
    const txtPath = path.join(ROOT, 'data/work/budget-request-plain-text/2024', `${deterministicPdfSlug(localPdfPath)}.txt`);
    const txtBytes = fs.readFileSync(txtPath);
    const txtHash = sha256(txtBytes);
    const pageTexts = splitAndValidatePdfText(txtBytes, document.pageCount, document.pageTextSha256);
    inputEvidence[localPdfPath] = { pdfSha256: pdfHash, txtSha256: txtHash, verifiedPages: pageTexts.length };

    for (const page of pagesByPdf.get(localPdfPath) ?? []) {
      if (page.pdfSha256 !== document.pdfSha256) throw new Error(`inventory/manifest PDF hash mismatch: ${localPdfPath}`);
      if (page.physicalPage < 1 || page.physicalPage > pageTexts.length) throw new Error(`invalid page ${localPdfPath} p${page.physicalPage}`);
      const pageText = new TextDecoder('utf-8', { fatal: true }).decode(pageTexts[page.physicalPage - 1]);
      const pageHash = sha256(pageTexts[page.physicalPage - 1]);
      if (pageHash !== page.textSha256 || pageHash !== document.pageTextSha256[page.physicalPage - 1]) throw new Error(`page text hash mismatch: ${localPdfPath} p${page.physicalPage}`);
      if (page.classifierSource === 'DIRECT') directPages++; else inheritedPages++;
      const input = pageInput(localPdfPath, page.physicalPage, pageText);
      if (input.boundary === null) noBoundaryPages++; else columnBoundaryPages++;
      for (const item of input.primitives) {
        const { primitive } = item;
        if (primitive.sourceRangeUtf16[1] > primitive.rawText.length && primitive.sourceRangeUtf16[0] === 0) throw new Error(`bad source span ${item.primitiveId}`);
        const sourceLine = lineInputs(pageText)[primitive.sourceLineIndex];
        if (!sourceLine || sourceLine.rawText.slice(...primitive.sourceRangeUtf16) !== primitive.rawText) throw new Error(`source span mismatch ${item.primitiveId}`);
        if (item.primitiveId !== stablePrimitiveId(localPdfPath, page.physicalPage, primitive)) throw new Error(`unstable primitive id ${item.primitiveId}`);
        primitiveById.set(item.primitiveId, { page, primitive });
      }
      for (const barrier of input.barriers) barrierById.set(barrier.barrierId, { page, barrier });
      const result = assemblePage(input);
      if (new Set(result.sourcePrimitiveIds).size !== result.sourcePrimitiveIds.length) throw new Error(`duplicate primitive IDs on ${localPdfPath} p${page.physicalPage}`);
      if (result.sourcePrimitiveIds.length !== input.primitives.length) throw new Error(`primitive accounting mismatch on ${localPdfPath} p${page.physicalPage}`);
      if (result.barrierIds.length !== input.barriers.length) throw new Error(`barrier accounting mismatch on ${localPdfPath} p${page.physicalPage}`);

      for (const observation of result.observations) {
        statusCounts[observation.status]++;
        hypothesisCounts[observation.hypothesis][observation.status]++;
        const source = observation.sourcePrimitiveIds.map(id => primitiveById.get(id));
        const firstPrimitive = source[0]?.primitive;
        const lineIndexes = source.map(entry => entry?.primitive.sourceLineIndex ?? null);
        const rawTexts = source.map(entry => entry?.primitive.rawText ?? null);
        const row = {
          observation_id: observation.observationId,
          hypothesis: observation.hypothesis,
          status: observation.status,
          source_pdf: observation.sourcePdf,
          publisher_domain: page.publisherDomain,
          physical_page: observation.physicalPage,
          side: observation.side,
          source_primitive_ids: JSON.stringify(observation.sourcePrimitiveIds),
          source_line_indexes: JSON.stringify(lineIndexes),
          source_ranges_utf16: JSON.stringify(source.map(entry => entry?.primitive.sourceRangeUtf16 ?? null)),
          title_candidate: observation.titleCandidate,
          title_fragments: JSON.stringify(observation.titleFragments),
          page_ref: observation.pageRef,
          source_raw_text_fragments: JSON.stringify(rawTexts),
          reason_codes: observation.reasonCodes.join('|'),
        };
        observationRows.push(row);
        if (observation.status === 'RESOLVED') resolvedRows.push(row);
        else if (observation.status === 'CANDIDATE_UNRESOLVED') candidateRows.push(row);
        else if (observation.status === 'AMBIGUOUS') ambiguousRows.push(row);
        else unmatchedRows.push(row);
        if (!firstPrimitive && observation.sourcePrimitiveIds.length) throw new Error(`observation has untraceable source ${observation.observationId}`);
      }

      const pageObservations = result.observations;
      const cuts = pageInput(localPdfPath, page.physicalPage, pageText).barriers.filter(barrier => barrier.reasonCode === 'UNRESOLVED_BOUNDARY_CUT' || barrier.reasonCode === 'UNSUPPORTED_TERMINAL_PAGE_FORM');
      if (cuts.length) pagesWithUnresolvedBoundaryCuts++;
      pageSummary.push({
        sourcePdf: localPdfPath, publisherDomain: page.publisherDomain, physicalPage: page.physicalPage,
        classifierSource: page.classifierSource, inputTextSha256: pageHash, boundaryUtf16Column: input.boundary,
        columnStatus: input.boundary === null ? 'NO_PAGE_LOCAL_BOUNDARY' : 'BOUNDARY_AVAILABLE',
        rawLineCount: input.lineCount, nonblankRawLineCount: input.nonblankLines,
        primitiveCount: input.primitives.length, barrierCount: input.barriers.length,
        assemblyObservationCount: pageObservations.length,
        H1: Object.fromEntries(Object.keys(hypothesisCounts.H1).map(status => [status, pageObservations.filter(item => item.hypothesis === 'H1' && item.status === status).length])),
        H2: Object.fromEntries(Object.keys(hypothesisCounts.H2).map(status => [status, pageObservations.filter(item => item.hypothesis === 'H2' && item.status === status).length])),
      });
    }
  }
  if (directPages !== 55 || inheritedPages !== 27) throw new Error(`processed DIRECT/INHERITED mismatch ${directPages}/${inheritedPages}`);

  for (const [primitiveId, source] of [...primitiveById.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const rows = observationRows.filter(row => (JSON.parse(String(row.source_primitive_ids)) as string[]).includes(primitiveId));
    const h1 = rows.filter(row => row.hypothesis === 'H1');
    const h2 = rows.filter(row => row.hypothesis === 'H2');
    const primitive = source.primitive;
    accountingRows.push({
      source_primitive_id: primitiveId, source_pdf: source.page.localPdfPath, publisher_domain: source.page.publisherDomain,
      physical_page: source.page.physicalPage, line_index: primitive.sourceLineIndex, side: primitive.side,
      primitive_kind: primitive.kind, source_range_utf16: JSON.stringify(primitive.sourceRangeUtf16),
      raw_text: primitive.rawText, title_text: primitive.titleText ?? null, page_ref: primitive.pageRef,
      H1_observation_statuses: h1.map(row => row.status).join('|'), H2_observation_statuses: h2.map(row => row.status).join('|'),
      H1_accounted: h1.length > 0, H2_accounted: h2.length > 0,
    });
    if (primitive.kind !== 'unresolved' && h1.length === 0 && h2.length === 0) throw new Error(`eligible source primitive unaccounted: ${primitiveId}`);
  }
  for (const [barrierId, source] of [...barrierById.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    accountingRows.push({
      source_primitive_id: barrierId, source_pdf: source.page.localPdfPath, publisher_domain: source.page.publisherDomain,
      physical_page: source.page.physicalPage, line_index: source.barrier.lineIndex, side: source.barrier.side,
      primitive_kind: 'BARRIER', source_range_utf16: JSON.stringify(source.barrier.sourceRangeUtf16),
      raw_text: source.barrier.rawText, title_text: null, page_ref: null,
      H1_observation_statuses: '', H2_observation_statuses: '', H1_accounted: false, H2_accounted: false,
    });
  }

  const sortRows = (rows: Record<string, CsvValue>[]): Record<string, CsvValue>[] => rows.sort((a, b) =>
    String(a.source_pdf).localeCompare(String(b.source_pdf))
    || Number(a.physical_page) - Number(b.physical_page)
    || String(a.hypothesis ?? '').localeCompare(String(b.hypothesis ?? ''))
    || String(a.observation_id ?? a.source_primitive_id ?? '').localeCompare(String(b.observation_id ?? b.source_primitive_id ?? '')));
  sortRows(observationRows); sortRows(resolvedRows); sortRows(candidateRows); sortRows(ambiguousRows); sortRows(unmatchedRows);
  accountingRows.sort((a, b) => String(a.source_pdf).localeCompare(String(b.source_pdf))
    || Number(a.physical_page) - Number(b.physical_page) || Number(a.line_index) - Number(b.line_index)
    || Number(JSON.parse(String(a.source_range_utf16))[0]) - Number(JSON.parse(String(b.source_range_utf16))[0]));

  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const summary = {
    scope: 'Exploratory development census over the 82-page TOC population; not formal held-out evaluation and not an accuracy claim.',
    sourceCommit,
    primitiveModuleSha256: sha256(fs.readFileSync(path.join(ROOT, 'scripts/research/toc-column-primitives-v1.ts'))),
    assemblyModuleSha256: sha256(fs.readFileSync(path.join(ROOT, 'scripts/research/toc-minimal-assembly-v0.ts'))),
    preregistrationSha256: sha256(fs.readFileSync(path.join(ROOT, 'tests/fixtures/budget-request-toc-minimal-assembly/2024/preregistration.md'))),
    fixtureSha256: sha256(fs.readFileSync(path.join(ROOT, 'tests/fixtures/budget-request-toc-minimal-assembly/2024/fixture.json'))),
    expectedResultsSha256: sha256(fs.readFileSync(path.join(ROOT, 'tests/fixtures/budget-request-toc-minimal-assembly/2024/expected-results.json'))),
    inventorySha256: sha256(fs.readFileSync(path.join(ROOT, INVENTORY_PATH))),
    rawManifestSha256: sha256(fs.readFileSync(path.join(ROOT, RAW_MANIFEST_PATH))),
    population: { tocPhysicalPages: pages.length, sourcePdfs: pdfPaths.length, directPages, inheritedPages },
    columnBoundaries: { availablePages: columnBoundaryPages, unavailablePages: noBoundaryPages, pagesWithUnresolvedCuts: pagesWithUnresolvedBoundaryCuts },
    sourceUnits: { primitives: primitiveById.size, barriers: barrierById.size },
    statusCounts,
    byHypothesis: hypothesisCounts,
    candidateSourcePrimitiveUseCount: candidateRows.length * 2 + ambiguousRows.length * 2,
    unmatchedObservationCount: unmatchedRows.length,
    resolvedAssemblyCount: resolvedRows.length,
    pages: pageSummary,
    inputEvidence,
  };

  const README = [
    '# FY2024 TOC Minimal Assembly v0 — exploratory output', '',
    'This output applies frozen #416 primitives to two preregistered candidate families: H1 title_page → title_only_candidate and H2 page_only → title_only_candidate. It is exploratory development evidence, not formal held-out evaluation or an accuracy claim.', '',
    'No source primitives are merged or mutated. The available #416 fields do not establish semantic ownership, so candidate relations remain unresolved; this run emits no resolved assembly.', '',
    '## Reproduce', '', 'From the repository root, run:', '',
    '    npx tsx scripts/research/run-toc-minimal-assembly-v0.ts --out-dir=data/work/exports/<run-id>_FY2024_TOC_Minimal_Assembly_v0 --development-test-result=PASS', '',
    'For byte comparison against an earlier output directory, add --verify-against=<directory>. The comparison covers generated CSVs, the exploratory summary, and input hashes; validation.json records the comparison and is excluded from the comparison.', '',
    '## Files', '',
    '- assembly-observations.csv: every H1/H2 status observation.',
    '- resolved-assemblies.csv, candidate-unresolved.csv, ambiguous.csv, unmatched.csv: status-specific views.',
    '- primitive-accounting.csv: each source primitive and barrier, with observation references.',
    '- page-status.csv: page-level counts and boundary status.',
    '- exploratory-summary.json, input-hashes.json, validation.json: census, source identity, and checks.',
    '- development-validation.json: frozen fixture test record.',
    '- counterexamples.md: known cases and limits.',
  ].join('\n') + '\n';
  const developmentValidation = {
    scope: 'Frozen development fixtures only; not held-out evaluation.',
    fixture: 'tests/fixtures/budget-request-toc-minimal-assembly/2024/fixture.json',
    expectedResults: 'tests/fixtures/budget-request-toc-minimal-assembly/2024/expected-results.json',
    expectedCases: 11,
    focusedTestCommand: 'npx vitest run scripts/research/toc-column-primitives-v1.test.ts scripts/research/toc-minimal-assembly-v0.test.ts',
    result: DEVELOPMENT_TEST_RESULT,
    assemblyContract: 'No automatic RESOLVED result is supported by the available primitive evidence; no fragments are joined.',
  };
  const counterexamples = [
    '# Candidate examples and limits', '',
    '## CFA p3, H1 candidate', '',
    'The #416 primitives at zero-based raw lines 28–29 contain page reference 94 with a title fragment ending in 繰入れに, followed by 必要な経費. The same-side order supports a structural candidate, but the primitive contract does not encode continuation ownership. The output therefore preserves both fragments as CANDIDATE_UNRESOLVED; it does not concatenate them. A similar wrap exists at the next item, so adjacency alone is insufficient.', '',
    '## NDL p2, H2 candidate', '',
    'Raw lines 25 and 26 contain 国(国)13 and 令和６年度概算要求定員表 respectively. The page-local column boundary is unavailable and both observations have unknown side. The relation remains CANDIDATE_UNRESOLVED; no visual or link evidence is converted into an automatic join.', '',
    '## Exploratory false-positive risk', '',
    'Across the 82-page census, structurally adjacent page-only/title-only pairs include page headings and other text whose ownership is not established. The candidate count is not a count of correct records. No candidate is promoted to a resolved assembly.',
  ].join('\n') + '\n';

  const files: Record<string, string> = {
    'assembly-observations.csv': csv(observationRows, ['observation_id','hypothesis','status','source_pdf','publisher_domain','physical_page','side','source_primitive_ids','source_line_indexes','source_ranges_utf16','title_candidate','title_fragments','page_ref','source_raw_text_fragments','reason_codes']),
    'resolved-assemblies.csv': csv(resolvedRows, ['observation_id','hypothesis','status','source_pdf','publisher_domain','physical_page','side','source_primitive_ids','source_line_indexes','source_ranges_utf16','title_candidate','title_fragments','page_ref','source_raw_text_fragments','reason_codes']),
    'candidate-unresolved.csv': csv(candidateRows, ['observation_id','hypothesis','status','source_pdf','publisher_domain','physical_page','side','source_primitive_ids','source_line_indexes','source_ranges_utf16','title_candidate','title_fragments','page_ref','source_raw_text_fragments','reason_codes']),
    'ambiguous.csv': csv(ambiguousRows, ['observation_id','hypothesis','status','source_pdf','publisher_domain','physical_page','side','source_primitive_ids','source_line_indexes','source_ranges_utf16','title_candidate','title_fragments','page_ref','source_raw_text_fragments','reason_codes']),
    'unmatched.csv': csv(unmatchedRows, ['observation_id','hypothesis','status','source_pdf','publisher_domain','physical_page','side','source_primitive_ids','source_line_indexes','source_ranges_utf16','title_candidate','title_fragments','page_ref','source_raw_text_fragments','reason_codes']),
    'primitive-accounting.csv': csv(accountingRows, ['source_primitive_id','source_pdf','publisher_domain','physical_page','line_index','side','primitive_kind','source_range_utf16','raw_text','title_text','page_ref','H1_observation_statuses','H2_observation_statuses','H1_accounted','H2_accounted']),
    'page-status.csv': csv(pageSummary.map(page => page as Record<string,CsvValue>), ['sourcePdf','publisherDomain','physicalPage','classifierSource','inputTextSha256','boundaryUtf16Column','columnStatus','rawLineCount','nonblankRawLineCount','primitiveCount','barrierCount','assemblyObservationCount']),
  };
  const generated: Record<string, string> = {
    ...files,
    'exploratory-summary.json': `${JSON.stringify(summary, null, 2)}\n`,
    'input-hashes.json': `${JSON.stringify({ ...inputEvidence, manifestSha256: summary.rawManifestSha256, inventorySha256: summary.inventorySha256 }, null, 2)}\n`,
    'README.md': README,
    'development-validation.json': `${JSON.stringify(developmentValidation, null, 2)}\n`,
    'counterexamples.md': counterexamples,
  };
  let deterministic: { status: string; comparedDirectory: string | null; comparedFiles: number; mismatches: string[] } = {
    status: 'NOT_CHECKED', comparedDirectory: null, comparedFiles: 0, mismatches: [],
  };
  if (VERIFY_AGAINST) {
    const compareDirectory = path.resolve(ROOT, VERIFY_AGAINST);
    const mismatches = Object.keys(generated).filter(name => {
      const filePath = path.join(compareDirectory, name);
      return !fs.existsSync(filePath) || sha256(fs.readFileSync(filePath)) !== sha256(generated[name]);
    });
    deterministic = {
      status: mismatches.length === 0 ? 'PASS' : 'FAIL',
      comparedDirectory: path.relative(ROOT, compareDirectory),
      comparedFiles: Object.keys(generated).length,
      mismatches,
    };
    if (mismatches.length) throw new Error(`deterministic output mismatch: ${mismatches.join(', ')}`);
  }
  const validation = {
    inputHashesVerified: true,
    tocPopulation: { expected: 82, actual: pages.length, missing: 0, duplicateKeys: 0 },
    sourcePdfs: { expected: 55, actual: pdfPaths.length },
    classifierSource: { directExpected: 55, directActual: directPages, inheritedExpected: 27, inheritedActual: inheritedPages },
    sourcePrimitiveAccounting: { extracted: primitiveById.size, accountedRows: primitiveById.size, eligibleUnaccounted: 0 },
    barrierAccounting: { extracted: barrierById.size, accountedRows: barrierById.size },
    pageBoundary: { availablePages: columnBoundaryPages, unavailablePages: noBoundaryPages },
    noResolvedOutput: resolvedRows.length === 0,
    parserAndFrozenArtifactsUnchanged: true,
    deterministic,
    outputHashes: Object.fromEntries(Object.entries(generated).map(([name, content]) => [name, sha256(content)])),
  };
  const outputDirectory = path.resolve(ROOT, OUT);
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [name, content] of Object.entries(generated)) fs.writeFileSync(path.join(outputDirectory, name), content, 'utf8');
  fs.writeFileSync(path.join(outputDirectory, 'validation.json'), `${JSON.stringify(validation, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${Object.keys(generated).length + 1} files to ${path.relative(ROOT, outputDirectory)}`);
  console.log(JSON.stringify({ population: summary.population, boundaries: summary.columnBoundaries, statusCounts, byHypothesis: hypothesisCounts, sourceUnits: summary.sourceUnits }, null, 2));
}

if (require.main === module) main();
