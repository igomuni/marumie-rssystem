/**
 * H1 structural hierarchy: deterministic GT sampling frame + A/B annotation comparison (no resolver).
 *
 *   npx tsx scripts/pipeline-v2/prepare-budget-request-total-table-h1-gt.ts prepare [zipPath] [outputDir]
 *   npx tsx scripts/pipeline-v2/prepare-budget-request-total-table-h1-gt.ts compare [zipPath] [outputDir] [--annotators=a,b]
 *   npx tsx scripts/pipeline-v2/prepare-budget-request-total-table-h1-gt.ts stability [zipPath] [outputDir] --pairs=a:a2,b:b2
 *
 * prepare: re-parses the frozen archive with v0 + P0 survey (unchanged), canonicalizes exact duplicate blocks,
 *          writes review/sample-manifest.csv and the annotator input package (annotation-input/).
 * compare: reads annotation-<x>/ and annotation-<y>/ (two isolated annotators; default a,b) and writes the human review
 *          package under review/. Human decision fields are always left empty.
 * stability: diagnostic only (never GT input). Agreement between annotation rounds of the same role, written to
 *          review/stability.json.
 * Spec of v0: docs/budget-request-total-table-csv.md
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { csvCell, parseSource, type LogicalRow, type SourceResult } from './lib/budget-request-total-table';
import { findAmbiguities, surveySource, type ContextSurvey, type RowSurvey } from './lib/budget-request-total-table-hierarchy-p0';
import {
  blockFingerprint, blockRawExcerpt, blockRowsForAnnotation, buildSample, canonicalizeBlocks, normalizeChildren, parseCsv,
  relationAgreement, SCOPE_STATUSES, selectAudit, sha256, STATUSES, totalAgreement, validateAnnotations,
  type RelationAnnotation, type SampleUnit, type TotalAnnotation,
} from './lib/budget-request-total-table-h1-gt-sampling';

const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = (name: string) => process.argv.slice(2).find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = positional[0];
const zipPath = positional[1] ?? 'data/work/budget-request-plain-text.zip';
const root = positional[2] ?? 'data/work/budget-request-total-table-h1-gt/2024';
const annotators = (flag('annotators') ?? 'a,b').split(',');
const ANNOTATOR_ID = /^[a-z][a-z0-9]*$/u;
if (annotators.length !== 2 || annotators[0] === annotators[1] || !annotators.every(a => ANNOTATOR_ID.test(a))) throw new Error('--annotators must name two distinct ids, e.g. a2,b2');
const FROZEN_ZIP_SHA256 = '268f1020957b58362e1b224197b16944855c139efa1524c343a77abdf754e533';
const FROZEN = { sources: 82, blocks: 69, rows: 3531, ambiguities: 1286 };
if (mode !== 'prepare' && mode !== 'compare' && mode !== 'stability') throw new Error('usage: prepare|compare|stability [zipPath] [outputDir] [--annotators=a,b] [--pairs=a:a2,b:b2]');

const toCsv = <T extends object>(items: T[], columns?: (keyof T)[]) => {
  const cols = columns ?? (items.length ? Object.keys(items[0]) as (keyof T)[] : []);
  return [cols.join(','), ...items.map(it => cols.map(c => csvCell(it[c])).join(','))].join('\n') + '\n';
};
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
  return [rel, sha256(content)] as const;
};
const safe = (blockId: string) => blockId.replace(/[^A-Za-z0-9_.#-]/gu, '_').replace(/#/gu, '__');

const GUIDE_COMMON = `
## parent_ref の書き方

- \`context\`: そのブロックの CONTEXT 行（ブロック先頭の所管・特別会計の行）を親とする
- \`row:<row_index>\`: 同じブロックの \`rows.csv\` の row_index（親は対象行より前の HIER / CODE3 / DETAIL に限る）
- RESOLVED 以外は空欄

## status

| status | 使う場面 |
|---|---|
| RESOLVED | 許可された証拠だけで、親が1つに決まる |
| AMBIGUOUS | 候補が複数残る。金額が非判別的（全0・単一の子で同額）。証拠が衝突し、決め手がない |
| NO_PARENT | 構造上の根で親がない（CONTEXT 行の単位で使う） |
| NOT_APPLICABLE | 親子関係の評価対象外 |

## TOTAL 単位（unit_kind = TOTAL_SCOPE）

- scope_status: RESOLVED（直接の子の集合が1つに決まる）／AMBIGUOUS
- direct_child_row_indices: RESOLVED のとき、その TOTAL が閉じる範囲の**直接の子**の row_index を \`;\` 区切りで（孫以下は含めない。7セルの合計が TOTAL と一致することを確認する）
- 単一の子で同額であることだけでは範囲の根拠にしない

## evidence_codes（\`;\` 区切り）

CONTEXT, ORDER, TOTAL, AMOUNT, GRAMMAR, PAGE_CARRY, INDENT_SUPPLEMENTARY, NON_DISCRIMINATING_ZERO, NON_DISCRIMINATING_SINGLE_CHILD, OTHER

## 判定の規則

- 決めるのは構造上の親子だけ。所管・会計・勘定・組織・項・目・要求経費などの意味ラベルは付けない・使わない（「これは項のはず」で決めない）
- 字下げ（生の列位置）は補助証拠だけ。字下げだけで親を決めない。ページをまたいで列位置を比べない
- コード桁数（2桁・3桁など）だけで親や役割を決めない
- 金額の一致だけで親を決めない。全0の行、単一の子で同額の行は非判別的
- 合計を確かめるときは直接の子だけを足す（DETAIL とその下の CODE3 を同時に足さない）
- ページ境界は階層の境界ではない（親が前のページにあってよい）
- 親は同じブロック内で対象行より前の行に限る
- 一意に決まらなければ AMBIGUOUS。推測で RESOLVED にしない
`;

const ANNOTATION_GUIDE = `# H1 structural relation annotation guide

FY2024 概算要求「歳出概算要求額総表」の論理行について、**構造上の直接の親**を判定する。

## 入力（このディレクトリだけを使う）

- \`units.csv\`: 判定対象。unit_kind = RELATION（行の親）／TOTAL_SCOPE（TOTAL 行が閉じる範囲）／CONTEXT_ROOT（CONTEXT 行がブロックの根か）
- \`blocks/<block>.rows.csv\`: ブロックの全論理行（row_index 順）。金額7セルは千円単位の符号付き整数（△は負）
- \`blocks/<block>.raw.txt\`: そのブロックのページの生テキスト（\`p<ページ> L<行>|\` 付き）

使ってよい証拠: 生テキスト、ページ境界、CONTEXT 行、論理行と行の順序、行の書式、抽出済みの7セル、TOTAL 行。
使ってはいけない: Web、PDF の目視、予算書・RS・MOF などの外部知識、記憶、意味ラベルからの推測、計算による値の補完。

## 出力

- \`relation-annotation-<x>.csv\`: \`sample_id,status,parent_ref,evidence_codes,notes\`（RELATION と CONTEXT_ROOT の全 unit）
- \`total-scope-annotation-<x>.csv\`: \`sample_id,scope_status,direct_child_row_indices,evidence_codes,notes\`（TOTAL_SCOPE の全 unit）

CONTEXT_ROOT は、その CONTEXT 行がブロックの根なら status = NO_PARENT、根と確認できなければ AMBIGUOUS（notes に理由）。
${GUIDE_COMMON}`;

const REVIEW_GUIDE = `# H1 GT human review guide

\`human-review.csv\` の各行について、構造上の親子関係（または TOTAL の範囲）を確定する。**意味ラベル（組織・項・目など）は判定しない。** 状態は \`PENDING_HUMAN_GT_REVIEW\`。

## 何をレビューするか

- \`review_required_reason\` が空でない行は必須: DISAGREEMENT（A/B 不一致、全件）、AGREEMENT_AUDIT（一致した単位の層ごと25%、SHA-256 で事前固定）、CONTEXT_AUDIT（全件）
- AGREEMENT_AUDIT で consensus candidate の誤りが1件でも見つかった層は、その層の全単位をレビューする（escalation）

## 記入欄

- human_decision: RESOLVED / AMBIGUOUS / NO_PARENT / NOT_APPLICABLE（TOTAL_SCOPE は RESOLVED / AMBIGUOUS）
- human_parent_or_scope: RELATION は \`context\` か \`row:<row_index>\`、TOTAL_SCOPE は直接の子の row_index を \`;\` 区切り
- human_notes: 根拠（evidence_codes と同じ語彙を推奨）
- human_review_status: REVIEWED

## 証拠の範囲

raw text から一意に決まらない場合は AMBIGUOUS とする（PDF の目視で救済しない）。annotation-input/ の rows.csv・raw.txt と同じ証拠だけを使う。
${GUIDE_COMMON}`;

// ---------- corpus (frozen v0 + P0 survey) ----------
if (createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex') !== FROZEN_ZIP_SHA256) throw new Error('input archive hash differs from the frozen v0 evaluation input');
const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\n').filter(e => /^budget-request-plain-text\/2024\/[^/]+\.txt$/u.test(e)).sort();
const decoder = new TextDecoder('utf-8', { fatal: true });
const texts = new Map<string, string>();
const v0Results: SourceResult[] = [];
const survey: RowSurvey[] = [];
const contexts: ContextSurvey[] = [];
for (const entry of entries) {
  const text = decoder.decode(execFileSync('unzip', ['-p', zipPath, entry.replace(/[[\]*?\\]/gu, '\\$&')], { maxBuffer: 1 << 28 }));
  texts.set(entry, text);
  const v0 = parseSource(text, entry, path.basename(entry, '.txt'));
  v0Results.push(v0);
  const s = surveySource(text, v0);
  survey.push(...s.rows);
  contexts.push(...s.contexts);
}
const v0Rows: LogicalRow[] = v0Results.flatMap(r => r.rows);
const blockList = v0Results.flatMap(r => r.blocks.map(b => ({ src: r, block: b })));
const ambiguities = findAmbiguities(survey, contexts);
if (entries.length !== FROZEN.sources || blockList.length !== FROZEN.blocks || v0Rows.length !== FROZEN.rows || ambiguities.length !== FROZEN.ambiguities) {
  throw new Error(`corpus differs from frozen baseline: ${entries.length}/${blockList.length}/${v0Rows.length}/${ambiguities.length}`);
}

const blockRefs = blockList.map(({ src, block }) => {
  const rows = v0Rows.filter(r => r.table_block_id === block.table_block_id);
  const ctx = contexts.find(c => c.table_block_id === block.table_block_id && c.line_class === 'CONTEXT')?.text_compact ?? '';
  return { source_file: src.source_file, table_block_id: block.table_block_id, fingerprint: blockFingerprint(ctx, rows), row_count: rows.length };
});
const { canonical, groups } = canonicalizeBlocks(blockRefs);
const { units, populations } = buildSample({ survey, v0Rows, ambiguities, contexts, canonical });

// The annotator package never contains strata, P0 candidate rules or ambiguity flags.
const annotatorUnit = (u: SampleUnit) => ({
  sample_id: u.sample_id, unit_kind: u.unit_kind, table_block_id: u.table_block_id, block_files: `blocks/${safe(u.table_block_id)}.*`,
  target_row_index: u.target_row_index, target_row_type: u.target_row_type, target_code_raw: u.target_code_raw,
  target_name_compact: u.target_name_compact, source_page: u.source_page, source_line_start: u.source_line_start,
});

if (mode === 'prepare') {
  for (const d of ['review', 'annotation-input']) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  const manifest: (readonly [string, string])[] = [];
  manifest.push(write('review/sample-manifest.csv', toCsv(units)));
  manifest.push(write('review/duplicate-groups.csv', toCsv(groups.flatMap(g => g.members.map(m => ({
    fingerprint: g.fingerprint, canonical_table_block_id: g.canonical_table_block_id, member_source_file: m.source_file,
    member_table_block_id: m.table_block_id, row_count: m.row_count, is_canonical: m.table_block_id === g.canonical_table_block_id,
  }))))));
  manifest.push(write('annotation-input/units.csv', toCsv(units.map(annotatorUnit))));
  for (const blockId of [...new Set(units.map(u => u.table_block_id))].sort()) {
    const { src, block } = blockList.find(b => b.block.table_block_id === blockId)!;
    manifest.push(write(`annotation-input/blocks/${safe(blockId)}.rows.csv`, toCsv(blockRowsForAnnotation(v0Rows.filter(r => r.table_block_id === blockId)))));
    manifest.push(write(`annotation-input/blocks/${safe(blockId)}.raw.txt`, blockRawExcerpt(texts.get(src.source_file)!, block.pages)));
  }
  manifest.push(write('annotation-input/annotation-guide.md', ANNOTATION_GUIDE));
  const summary = {
    input: { zipSha256: FROZEN_ZIP_SHA256, ...FROZEN },
    blocks: blockList.length, canonicalBlocks: canonical.size,
    duplicateGroups: groups.map(g => ({ canonical: g.canonical_table_block_id, members: g.members.map(m => m.table_block_id), rows: g.members[0].row_count })),
    populations,
    sampled: Object.fromEntries(Object.keys(populations).map(s => [s, units.filter(u => u.stratum === s).length])),
    forcedInclusions: units.filter(u => u.forced_inclusion).map(u => u.sample_id),
    sampleBlocks: new Set(units.map(u => u.table_block_id)).size,
    sampleManifestSha256: manifest[0][1],
  };
  manifest.push(write('review/sampling-summary.json', JSON.stringify(summary, null, 2) + '\n'));
  write('prepare-manifest.json', JSON.stringify(Object.fromEntries([...manifest].sort(([a], [b]) => (a < b ? -1 : 1))), null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

const readAnnotations = (who: string) => {
  const read = (rel: string) => parseCsv(fs.readFileSync(path.join(root, rel), 'utf8'));
  return {
    rel: read(`annotation-${who}/relation-annotation-${who}.csv`) as unknown as RelationAnnotation[],
    tot: read(`annotation-${who}/total-scope-annotation-${who}.csv`) as unknown as TotalAnnotation[],
  };
};

if (mode === 'compare') {
  const manifestIds = parseCsv(fs.readFileSync(path.join(root, 'review/sample-manifest.csv'), 'utf8'));
  if (sha256(toCsv(units)) !== sha256(fs.readFileSync(path.join(root, 'review/sample-manifest.csv'), 'utf8'))) throw new Error('sample manifest differs from the frozen sampling rule');
  const relIds = manifestIds.filter(u => u.unit_kind !== 'TOTAL_SCOPE').map(u => u.sample_id);
  const totIds = manifestIds.filter(u => u.unit_kind === 'TOTAL_SCOPE').map(u => u.sample_id);
  const [whoA, whoB] = annotators;
  const A = readAnnotations(whoA);
  const B = readAnnotations(whoB);
  const errors = [
    ...validateAnnotations(A.rel, relIds, r => r.status, STATUSES).map(e => `${whoA} relation ${e}`),
    ...validateAnnotations(B.rel, relIds, r => r.status, STATUSES).map(e => `${whoB} relation ${e}`),
    ...validateAnnotations(A.tot, totIds, r => r.scope_status, SCOPE_STATUSES).map(e => `${whoA} total ${e}`),
    ...validateAnnotations(B.tot, totIds, r => r.scope_status, SCOPE_STATUSES).map(e => `${whoB} total ${e}`),
  ];
  if (errors.length) throw new Error(`annotation validation failed:\n${errors.join('\n')}`);

  const byId = <T extends { sample_id: string }>(xs: T[]) => new Map(xs.map(x => [x.sample_id, x]));
  const [aR, bR, aT, bT] = [byId(A.rel), byId(B.rel), byId(A.tot), byId(B.tot)];
  const fmtRel = (x: RelationAnnotation) => `${x.status}${x.status === 'RESOLVED' ? ` ${x.parent_ref}` : ''}`;
  const fmtTot = (x: TotalAnnotation) => `${x.scope_status}${x.scope_status === 'RESOLVED' ? ` [${normalizeChildren(x.direct_child_row_indices)}]` : ''}`;
  const compared = units.map(u => {
    const isTot = u.unit_kind === 'TOTAL_SCOPE';
    const agree = isTot ? totalAgreement(aT.get(u.sample_id)!, bT.get(u.sample_id)!) : relationAgreement(aR.get(u.sample_id)!, bR.get(u.sample_id)!);
    const ca = isTot ? fmtTot(aT.get(u.sample_id)!) : fmtRel(aR.get(u.sample_id)!);
    const cb = isTot ? fmtTot(bT.get(u.sample_id)!) : fmtRel(bR.get(u.sample_id)!);
    return { u, agree, ca, cb };
  });
  const audit = selectAudit(compared.filter(c => c.agree && c.u.unit_kind !== 'CONTEXT_ROOT').map(c => c.u));
  const reason = (c: typeof compared[number]) =>
    !c.agree ? 'DISAGREEMENT' : c.u.unit_kind === 'CONTEXT_ROOT' ? 'CONTEXT_AUDIT' : audit.has(c.u.sample_id) ? 'AGREEMENT_AUDIT' : '';
  const excerpt = (u: SampleUnit) => {
    const lines = texts.get(u.source_file)!.split('\n');
    const r = v0Rows.find(x => x.table_block_id === u.table_block_id && x.row_index === u.target_row_index);
    const [s, e] = r ? [r.source_line_start, r.source_line_end] : [u.source_line_start, u.source_line_start];
    return lines.slice(s - 1, e).map(l => l.replace(/\f/gu, '').trim().replace(/\s+/gu, ' ')).join(' / ');
  };

  const files: (readonly [string, string])[] = [];
  for (const who of annotators) {
    for (const kind of ['relation', 'total-scope'] as const) {
      files.push(write(`review/${kind}-annotation-${who}.csv`, fs.readFileSync(path.join(root, `annotation-${who}/${kind}-annotation-${who}.csv`), 'utf8')));
    }
  }
  const base = (c: typeof compared[number]) => ({
    sample_id: c.u.sample_id, unit_kind: c.u.unit_kind, stratum: c.u.stratum, source_file: c.u.source_file, table_block_id: c.u.table_block_id,
    target: `${c.u.target_row_index === '' ? 'context' : `row:${c.u.target_row_index}`} ${c.u.target_row_type} ${c.u.target_code_raw} ${c.u.target_name_compact}`.trim(),
  });
  files.push(write('review/consensus-candidates.csv', toCsv(compared.filter(c => c.agree).map(c => ({ ...base(c), consensus_candidate: c.ca, label: 'CONSENSUS_CANDIDATE' })))));
  files.push(write('review/disagreements.csv', toCsv(compared.filter(c => !c.agree).map(c => ({ ...base(c), candidate_a: c.ca, candidate_b: c.cb })))));
  files.push(write('review/human-review.csv', toCsv(compared.map(c => ({
    ...base(c), raw_excerpt: excerpt(c.u), candidate_a: c.ca, candidate_b: c.cb, consensus_candidate: c.agree ? c.ca : '',
    review_required_reason: reason(c), human_decision: '', human_parent_or_scope: '', human_notes: '', human_review_status: '',
  })))));
  files.push(write('review/review-guide.md', REVIEW_GUIDE));
  const strata = [...new Set(units.map(u => u.stratum))];
  const stats = {
    units: units.length,
    agreement: compared.filter(c => c.agree).length,
    disagreement: compared.filter(c => !c.agree).length,
    perStratum: Object.fromEntries(strata.map(s => {
      const cs = compared.filter(c => c.u.stratum === s);
      return [s, { units: cs.length, agree: cs.filter(c => c.agree).length, disagree: cs.filter(c => !c.agree).length, audit: cs.filter(c => audit.has(c.u.sample_id)).length }];
    })),
    requiredHumanReview: compared.filter(c => reason(c) !== '').length,
    byReason: Object.fromEntries(['DISAGREEMENT', 'AGREEMENT_AUDIT', 'CONTEXT_AUDIT'].map(r => [r, compared.filter(c => reason(c) === r).length])),
    statusCounts: {
      a: countBy([...A.rel.map(r => r.status), ...A.tot.map(r => `SCOPE_${r.scope_status}`)]),
      b: countBy([...B.rel.map(r => r.status), ...B.tot.map(r => `SCOPE_${r.scope_status}`)]),
    },
    state: 'PENDING_HUMAN_GT_REVIEW',
  };
  files.push(write('review/comparison-summary.json', JSON.stringify(stats, null, 2) + '\n'));
  const prepare = JSON.parse(fs.readFileSync(path.join(root, 'prepare-manifest.json'), 'utf8')) as Record<string, string>;
  const all = Object.fromEntries([...Object.entries(prepare).filter(([k]) => k.startsWith('review/')), ...files].sort(([a], [b]) => (a < b ? -1 : 1)));
  const content = JSON.stringify(all, null, 2) + '\n';
  write('review/package-manifest.json', content);
  console.log(JSON.stringify({ ...stats, annotators: { a: whoA, b: whoB }, packageManifestSha256: sha256(content) }, null, 2));
}

if (mode === 'stability') {
  // Diagnostic only: how stable each annotator role is across rounds. Never an input to GT or to the human review.
  const pairs = (flag('pairs') ?? '').split(',').filter(Boolean).map(p => p.split(':'));
  if (!pairs.length || pairs.some(p => p.length !== 2 || !p.every(a => ANNOTATOR_ID.test(a)))) throw new Error('--pairs must look like a:a2,b:b2');
  const result = Object.fromEntries(pairs.map(([x, y]) => {
    const X = readAnnotations(x);
    const Y = readAnnotations(y);
    const yR = new Map(Y.rel.map(r => [r.sample_id, r]));
    const yT = new Map(Y.tot.map(r => [r.sample_id, r]));
    const rel = X.rel.filter(r => yR.has(r.sample_id));
    const tot = X.tot.filter(r => yT.has(r.sample_id));
    const transitions = countBy([
      ...rel.map(r => `${r.status}->${yR.get(r.sample_id)!.status}`),
      ...tot.map(r => `SCOPE_${r.scope_status}->SCOPE_${yT.get(r.sample_id)!.scope_status}`),
    ]);
    return [`${x}:${y}`, {
      units: rel.length + tot.length,
      agreement: rel.filter(r => relationAgreement(r, yR.get(r.sample_id)!)).length + tot.filter(r => totalAgreement(r, yT.get(r.sample_id)!)).length,
      transitions,
    }];
  }));
  const content = JSON.stringify({ diagnosticOnly: true, pairs: result }, null, 2) + '\n';
  write('review/stability.json', content);
  console.log(content);
}

function countBy(xs: string[]) {
  const m: Record<string, number> = {};
  for (const x of [...xs].sort()) m[x] = (m[x] ?? 0) + 1;
  return m;
}

