/**
 * Cover Structure v0 parser 出力の development / descriptive regression（formal validation ではない）。
 * visual GT（#387、PROTOCOL_INVALID / STOP）は、pageごとに visual input された field（header code/text・scope marker/code/name・printed page ref・entry kind order・定員表の有無）の
 * descriptive reference としてのみ使う。title・ordinal・SECTION label は freeze script の定数 stamp のため比較しない。production parser は GT を参照しない。
 *
 * 使い方: npx tsx scripts/pipeline-v2/run-budget-request-cover-structure-descriptive-regression.ts [--freeze-fixture --impl-commit=<sha>]
 * 出力: tests/fixtures/budget-request-cover-structure/2024/descriptive-regression.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256Hex } from './lib/budget-request-raw-text';
import { comparisonCharacterSequence as seq, type CoverObservation } from './lib/budget-request-cover-structure';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const FREEZE = process.argv.includes('--freeze-fixture');
const DIR = path.join('tests', 'fixtures', 'budget-request-cover-structure', '2024');
const OBS = path.join('data', 'work', 'budget-request-cover-structure', '2024', 'cover-observations.jsonl');
const GT = path.join(DIR, 'visual-gt.json');
const MANIFEST = path.join(DIR, 'implementation-manifest.json');
const LEDGER = path.join('tests', 'fixtures', 'budget-request-cover-toc-structure', '2024', 'development-explored-pages.json');
const OUT = path.join(DIR, 'descriptive-regression.json');
const key = (k: { filePath: string; physicalPage: number }) => `${k.filePath}#${k.physicalPage}`;

const obsBody = fs.readFileSync(OBS, 'utf8');
const obs = new Map(obsBody.split('\n').filter(l => l).map(l => JSON.parse(l) as CoverObservation).map(o => [key(o.source), o]));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as { summary: { outputDigestSha256: string } };
if (sha256Hex(obsBody) !== manifest.summary.outputDigestSha256) throw new Error('observation digest mismatch');
type GtEntry = { kindVisual: string; labelOrMarkerVisual: string | null; codeVisual: string | null; nameVisualParts: string[]; printedPageRefVisual: string | null };
const gt = JSON.parse(fs.readFileSync(GT, 'utf8')) as { rows: { sourceKey: { filePath: string; physicalPage: number }; header: { codeVisual: string | null; textVisualParts: string[] }; entries: GtEntry[] }[] };

type Cmp = 'MATCH' | 'MISMATCH' | 'ABSTAIN';
const tally = { fields: 0, MATCH: 0, MISMATCH: 0, ABSTAIN: 0, inventedCharacterCandidate: 0 };
const mismatches: { page: string; field: string; parser: string | null; gt: string | null }[] = [];
const cmp = (page: string, field: string, parser: string | null, g: string | null): Cmp => {
  tally.fields++;
  if (parser === null || parser === '') { tally.ABSTAIN++; return 'ABSTAIN'; }
  if (g !== null && parser === g) { tally.MATCH++; return 'MATCH'; }
  tally.MISMATCH++; mismatches.push({ page, field, parser, gt: g });
  // parser の文字が GT の文字 multiset に収まらなければ invented-character 候補
  const bag = new Map<string, number>(); for (const c of g ?? '') bag.set(c, (bag.get(c) ?? 0) + 1);
  if ([...parser].some(c => { const n = bag.get(c) ?? 0; bag.set(c, n - 1); return n <= 0; })) tally.inventedCharacterCandidate++;
  return 'MISMATCH';
};
let structurePass = 0, structureFail = 0, wrongEntryAttachmentPages = 0;
const structureFails: { page: string; parserKinds: string; gtKinds: string }[] = [];
for (const r of gt.rows) {
  const k = key(r.sourceKey);
  const o = obs.get(k);
  if (!o) throw new Error(`missing observation ${k}`);
  cmp(k, 'header.code', o.header.codeRaw, r.header.codeVisual);
  cmp(k, 'header.text', o.header.textRawParts.length ? seq(o.header.textRawParts) : null, seq(r.header.textVisualParts));
  const pk = o.entries.map(e => (e.kind === 'SECTION_REFERENCE' ? 'S' : 'C')).join('');
  const gk = r.entries.map(e => (e.kindVisual === 'SECTION_REFERENCE' ? 'S' : 'C')).join('');
  if (pk === gk) structurePass++; else { structureFail++; structureFails.push({ page: k, parserKinds: pk, gtKinds: gk }); }
  if (pk !== gk) { wrongEntryAttachmentPages++; continue; }
  o.entries.forEach((e, i) => {
    const g = r.entries[i];
    if (e.kind === 'SECTION_REFERENCE') cmp(k, `entry${i}.printedPageRef`, e.printedPageRefRaw === null ? null : seq([e.printedPageRefRaw]), g.printedPageRefVisual === null ? null : seq([g.printedPageRefVisual]));
    else {
      cmp(k, `entry${i}.marker`, e.markerRaw === null ? null : seq([e.markerRaw]), g.labelOrMarkerVisual === null ? null : seq([g.labelOrMarkerVisual]));
      cmp(k, `entry${i}.code`, e.codeRaw === null ? null : seq([e.codeRaw]), g.codeVisual === null ? null : seq([g.codeVisual]));
      cmp(k, `entry${i}.name`, e.nameRawParts.length ? seq(e.nameRawParts) : null, seq(g.nameVisualParts));
      cmp(k, `entry${i}.printedPageRef`, e.printedPageRefRaw === null ? null : seq([e.printedPageRefRaw]), g.printedPageRefVisual === null ? null : seq([g.printedPageRefVisual]));
    }
  });
}

// PR-3A development 14 page: multiline / word-split の挙動（観測のみ。transcription は無いため pass/fail の基準は parser 出力が preregistered continuation rule の構造に従うか）
const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) as { pages: { localPdfPath: string; physicalPage: number; classifierPageType: string }[] };
const dev = ledger.pages.filter(p => p.classifierPageType === 'COVER');
const devRows = dev.map(p => {
  const o = obs.get(`${p.localPdfPath}#${p.physicalPage}`);
  if (!o) throw new Error(`dev page missing observation ${p.localPdfPath}#${p.physicalPage}`);
  const multi = o.entries.filter(e => e.kind === 'SCOPE_REFERENCE' && e.nameRawParts.length > 1).map(e => (e as { nameRawParts: string[] }).nameRawParts);
  return { filePath: p.localPdfPath, physicalPage: p.physicalPage, status: o.status, scopeEntries: o.entries.filter(e => e.kind === 'SCOPE_REFERENCE').length, multilineScopeNames: multi };
});
const out = {
  schema: 'budget-request-cover-structure-descriptive-regression/v0',
  scope: 'development / descriptive regression。formal validation・held-out ではない。visual GT is protocol-invalid for formal evaluation; comparison is descriptive/development only',
  implementationCommit: arg('impl-commit') ?? null,
  observationOutputDigestSha256: manifest.summary.outputDigestSha256,
  visualGtSha256: sha256Hex(fs.readFileSync(GT)),
  comparison55: {
    pages: gt.rows.length, comparedAtomicFields: tally.fields, matches: tally.MATCH, mismatches: tally.MISMATCH, abstentions: tally.ABSTAIN, inventedCharacterCandidates: tally.inventedCharacterCandidate,
    entryKindSequence: { pass: structurePass, fail: structureFail }, wrongEntryAttachmentPages,
    descriptiveMatchRate: tally.MATCH / tally.fields,
    excludedFromComparison: 'header title・SECTION ordinal・SECTION label（visual GT では定数 stamp のため formal character comparison 対象外）',
    mismatchRows: mismatches, structureFails,
  },
  development14: { coverPages: devRows.length, multilinePages: devRows.filter(r => r.multilineScopeNames.length).length, multilineCases: devRows.reduce((n, r) => n + r.multilineScopeNames.length, 0), rows: devRows },
};
if (FREEZE) fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ comparison55: { ...out.comparison55, mismatchRows: out.comparison55.mismatchRows.slice(0, 20) }, development14: { ...out.development14, rows: out.development14.rows.filter(r => r.multilineScopeNames.length) } }, null, 1));
