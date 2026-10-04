/**
 * item-shaped row candidate detector の development 比較（hierarchy 契約を持つ 8 PDF の hierarchy 区間のみ）。
 * 候補は hierarchy=null の artifact（hierarchy-isolation の OFF 出力）だけから検出し、ON の recordKind=item（baseline artifact）は妥当性確認用ラベルとして anchor で突き合わせるだけ。
 * 規則の調整には使わない（規則は lib の定数として事前登録）。74 PDF の候補は数えない。
 * 使い方: npx tsx scripts/pipeline-v2/evaluate-budget-request-item-candidate-development.ts
 * 出力: tests/fixtures/budget-request-pdf-item-candidate-count/2024/development-comparison.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { countCandidates, detectCandidates, referenceX, ITEM_INDENT_STEP, ITEM_X_TOLERANCE, MIN_REFERENCE_REQUESTS, type CandidateSourceRecord } from './lib/budget-request-item-candidate';

const ISO = path.join('tests', 'fixtures', 'budget-request-hierarchy-failure-isolation', '2024');
const OUT = path.join('tests', 'fixtures', 'budget-request-pdf-item-candidate-count', '2024', 'development-comparison.json');
const BASE_WORK = path.join('data', 'work', 'budget-request-corpus-baseline', '2024');
const OFF_WORK = path.join('data', 'work', 'budget-request-hierarchy-failure-isolation', '2024', 'off');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const inc = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };
const slugOf = (p: string) => p.replace(/^data\/download\//, '').replace(/[/]/g, '__');
const readGz = <T>(f: string): T[] => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
interface OnRec { anchor: { page: number; logicalRowIndex: number }; recordKind: string }
interface PDoc { localPath: string; publisherAuthority: string; accountType: string; class: string; hierarchySegment: [number, number]; baselineOnRecordsSha256: string }

function main() {
  const manifestBytes = fs.readFileSync(path.join(ISO, 'paired-manifest.json'));
  if (sha(manifestBytes) !== '4fb70f3ab49c6a823cd45dad8c05d6b395f6fffb8ab9ca8009b196445616d5e1') throw new Error('paired manifest が frozen 値と一致しない（STOP）');
  const off = JSON.parse(fs.readFileSync(path.join(ISO, 'off-diagnostic.json'), 'utf8')) as { documents: { localPath: string; recordsSha256: string }[] };
  const docs = (JSON.parse(manifestBytes.toString('utf8')) as { documents: PDoc[] }).documents.filter(d => d.class === 'paired_evaluable');
  const per: Record<string, unknown>[] = [];
  const tot = { candidates: 0, existingItems: 0, itemsInCandidates: 0, candidatesNotItem: 0, itemsNotCandidate: 0, ambiguous: 0, unique: 0, duplicates: 0 };
  const nonItemOnKind: Record<string, number> = {};
  const nonItemNameStatus: Record<string, number> = {};
  const missedItemInfo: string[] = [];
  for (const d of docs) {
    const [a, b] = d.hierarchySegment;
    const offFile = path.join(OFF_WORK, slugOf(d.localPath), `seg-${a}-${b}.records.jsonl.gz`);
    const onFile = path.join(BASE_WORK, slugOf(d.localPath), `seg-${a}-${b}.records.jsonl.gz`);
    if (sha(fs.readFileSync(offFile)) !== off.documents.find(x => x.localPath === d.localPath)?.recordsSha256) throw new Error(`OFF artifact の hash 不一致: ${offFile}`);
    if (sha(fs.readFileSync(onFile)) !== d.baselineOnRecordsSha256) throw new Error(`ON artifact の hash 不一致: ${onFile}`);
    const offRecs = readGz<CandidateSourceRecord>(offFile);
    const on = readGz<OnRec>(onFile);
    const onKind = new Map(on.map(r => [`${r.anchor.page}:${r.anchor.logicalRowIndex}`, r.recordKind]));
    const { refX, requests } = referenceX(offRecs);
    const cands = refX === null ? [] : detectCandidates(offRecs, refX);
    const c = countCandidates(cands);
    const candKeys = new Set(cands.map(x => `${x.anchor.page}:${x.anchor.logicalRowIndex}`));
    const items = on.filter(r => r.recordKind === 'item');
    const inCand = items.filter(r => candKeys.has(`${r.anchor.page}:${r.anchor.logicalRowIndex}`)).length;
    const notItem = cands.filter(x => onKind.get(`${x.anchor.page}:${x.anchor.logicalRowIndex}`) !== 'item');
    for (const x of notItem) { inc(nonItemOnKind, onKind.get(`${x.anchor.page}:${x.anchor.logicalRowIndex}`) ?? 'missing'); inc(nonItemNameStatus, x.nameStatus); }
    for (const r of items) if (!candKeys.has(`${r.anchor.page}:${r.anchor.logicalRowIndex}`)) missedItemInfo.push(`${d.localPath.split('/').pop()}:p${r.anchor.page}r${r.anchor.logicalRowIndex}`);
    tot.candidates += cands.length; tot.existingItems += items.length; tot.itemsInCandidates += inCand; tot.candidatesNotItem += notItem.length; tot.itemsNotCandidate += items.length - inCand;
    tot.ambiguous += c.ambiguous; tot.unique += c.withinDocumentUnique; tot.duplicates += c.duplicateRows;
    per.push({ localPath: d.localPath, publisherAuthority: d.publisherAuthority, accountType: d.accountType, segment: d.hierarchySegment, referenceX: refX, referenceRequests: requests, candidates: c, existingItems: items.length, itemsInCandidates: inCand, candidatesNotItem: notItem.length });
  }
  const out = {
    schema: 'budget-request-item-candidate-development/v0',
    scope: 'hierarchy 契約を持つ 8 PDF の hierarchy 区間。候補は hierarchy=null の artifact から検出し、ON の recordKind=item は妥当性確認用ラベル（規則の調整には使わない）',
    rule: { step: ITEM_INDENT_STEP, tolerance: ITEM_X_TOLERANCE, minReferenceRequests: MIN_REFERENCE_REQUESTS },
    totals: tot, candidatesNotExistingItemByOnKind: nonItemOnKind, candidatesNotExistingItemNameStatus: nonItemNameStatus, existingItemsMissedByCandidate: missedItemInfo, perPdf: per,
  };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  fs.writeFileSync(OUT, text);
  console.log(JSON.stringify({ sha256: sha(text), totals: tot, onKind: nonItemOnKind, nameStatus: nonItemNameStatus, missed: missedItemInfo, per: per.map(p => ({ f: (p.localPath as string).split('/').pop(), ref: p.referenceX, c: (p.candidates as { rows: number }).rows, items: p.existingItems, inC: p.itemsInCandidates })) }, null, 1));
}

main();
