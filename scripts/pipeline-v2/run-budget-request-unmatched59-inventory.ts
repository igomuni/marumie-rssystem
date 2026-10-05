/**
 * 行別 inventory: frozen unmatched 59 項を 1 項ずつ source evidence（全 82 PDF の走査結果）で分類する。新しい抽出 rule は無い。分類規則は protocol §4 と本ファイルの classify() に固定（結果を見て変更しない）。
 * protocol: docs/tasks/20261006_0830_Budget_Request_Unmatched_59_Source_Failure_Inventory_Protocol.md
 * 使い方: node --max-old-space-size=8192 --import tsx scripts/pipeline-v2/run-budget-request-unmatched59-inventory.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as zlib from 'zlib';

const FX = 'tests/fixtures';
const OUT = `${FX}/budget-request-unmatched-59/2024`, MC = `${FX}/budget-request-mext-continuation/2024`;
const FROZEN: Record<string, string> = {
  [`${OUT}/baseline.json`]: '7f7e219245849b4dcec9a7352dfdda70eeb09f0f404047d18f5a979ff1e24bb4', [`${MC}/baseline.json`]: 'b8362971a408304d37065a753183a2c3b0e969db40797de004673794b6ad4a90',
  'docs/tasks/20261006_0830_Budget_Request_Unmatched_59_Source_Failure_Inventory_Protocol.md': '047427e984ad8cb0350b58a5610b6a75e943447e6c13bb7d558d99e93ab4bcca',
};
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(fs.readFileSync(f));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortDeep = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => cmp(a, b)).map(([k, x]) => [k, sortDeep(x)])) : v);
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

interface Pdf { localPath: string; sha256: string; pages: number; publisherAuthority: string; accountType: string; rotation: Record<string, number>; tokens: number; asciiDigitTokens: number; pagesWithoutTokens: number; representation: string }
interface Hit { pdfPath: string; page: number; kind: string; tokens: { index: number; text: string }[]; leftCode: { text: string; shape: string } | null; universeRow: { isCandidate: boolean; nameClass: string; ruleStatus: string; deltaX01: string | null; currentCandidateName: string | null; candidateId: string } | null }
const BLOCKED = new Set(['DRAWING_PATH_TEXT', 'RASTER_IMAGE_ONLY', 'TEXT_PRESENT_UNICODE_UNRESOLVED']);

function main() {
  for (const [p, h] of Object.entries(FROZEN)) if (fileSha(p) !== h) throw new Error(`frozen input の hash 不一致（STOP）: ${p}`);
  const baseline = readJson<{ unmatched: number; exactCovered: number; unmatchedMof: { mofSectionId: string; ministry: string; organization: string; code: string; name: string; normalized: string }[] }>(`${OUT}/baseline.json`);
  const mextBase = new Map(readJson<{ mextUnmatched: { mofSectionId: string; sourceClass: string }[] }>(`${MC}/baseline.json`).mextUnmatched.map(m => [m.mofSectionId, m.sourceClass]));
  const scan = readJson<{ hitsGzSha256: string; pdfs: Pdf[] }>(`${OUT}/source-pdf-scan.json`);
  const hitsBytes = fs.readFileSync(`${OUT}/source-search-hits.json.gz`);
  if (sha(hitsBytes) !== scan.hitsGzSha256) throw new Error('走査 artifact が一致しない（STOP）');
  const H = JSON.parse(zlib.gunzipSync(hitsBytes).toString('utf8')) as { hitCounts: Record<string, number>; hits: Record<string, Hit[]>; nearTextStemHits: Record<string, { pdfPath: string; page: number; tokenText: string; stemKinds: string[] }[]> };
  if (baseline.unmatched !== 59 || baseline.unmatchedMof.length !== 59) throw new Error('unmatched 59 を再現できない（STOP）');
  const pdfBy = new Map(scan.pdfs.map(p => [p.localPath, p]));

  const rows = baseline.unmatchedMof.map(m => {
    const auth = new Set([m.ministry, m.organization]);
    const authPdfs = scan.pdfs.filter(p => auth.has(p.publisherAuthority));
    const hits = H.hits[m.mofSectionId] ?? [];
    const sameAuthHits = hits.filter(h => auth.has(pdfBy.get(h.pdfPath)!.publisherAuthority));
    const otherAuthHits = hits.filter(h => !auth.has(pdfBy.get(h.pdfPath)!.publisherAuthority));
    const itemLike = (h: Hit) => h.leftCode?.shape === 'plain3' && (h.kind === 'SINGLE_TOKEN_EXACT' || h.kind === 'MULTI_TOKEN_NAME_CELL_CONTINUATION') && pdfBy.get(h.pdfPath)!.accountType === 'general';
    const sameAuthItem = sameAuthHits.filter(itemLike);
    const blocked = authPdfs.filter(p => BLOCKED.has(p.representation));
    const readable = authPdfs.filter(p => p.representation === 'TEXT_GEOMETRY_AVAILABLE');
    const mextKnown = mextBase.get(m.mofSectionId) === 'SOURCE_FULL_NAME_ABSENT';
    const stems = H.nearTextStemHits[m.mofSectionId] ?? [];
    const evidenceRefs = { scanArtifact: 'source-pdf-scan.json', hitsArtifact: 'source-search-hits.json.gz', baselineArtifact: 'baseline.json', mextBaselineArtifact: mextBase.has(m.mofSectionId) ? 'budget-request-mext-continuation/2024/baseline.json' : null };
    const base = { mofRowId: m.mofSectionId, mofCode: m.code, mofNameRaw: m.name, mofNameNormalized: m.normalized, mofMinistry: m.ministry, mofOrganization: m.organization, authorityPdfPaths: authPdfs.map(p => p.localPath).sort(), exactHitCountAllPdfs: H.hitCounts[m.mofSectionId] ?? 0, exactHitCountSameAuthority: sameAuthHits.length, exactHitsOtherAuthority: otherAuthHits.slice(0, 5).map(h => ({ pdfPath: h.pdfPath, page: h.page, kind: h.kind, leftCode: h.leftCode, pdfAccountType: pdfBy.get(h.pdfPath)!.accountType })), nearTextEvidence: stems.slice(0, 5), evidenceRefs };
    let r: Record<string, unknown>;
    if (sameAuthItem.length > 0) {
      const pdfs = [...new Set(sameAuthItem.map(h => h.pdfPath))].sort();
      const h0 = sameAuthItem.sort((a, b) => cmp(a.pdfPath, b.pdfPath) || a.page - b.page)[0];
      const cand = h0.universeRow?.isCandidate ?? false;
      r = { sourceAssignmentStatus: pdfs.length === 1 ? 'SOURCE_ASSIGNMENT_RESOLVED' : 'SOURCE_ASSIGNMENT_PARTIAL', sourcePdfPath: pdfs.length === 1 ? pdfs[0] : null, sourcePage: pdfs.length === 1 ? h0.page : null, sourceEvidence: `exact name found as an item-like row (plain 3-digit code at left) in ${pdfs.length} same-authority general-account PDF(s)`,
        pdfRepresentationClass: pdfBy.get(h0.pdfPath)!.representation, sourceFullNameStatus: h0.kind === 'SINGLE_TOKEN_EXACT' ? 'SOURCE_FULL_NAME_SINGLE_LINE' : 'SOURCE_FULL_NAME_MULTILINE_CONTIGUOUS',
        currentCandidateStatus: cand ? (h0.universeRow!.currentCandidateName ? 'CANDIDATE_PRESENT_NAME_MISMATCH' : 'CANDIDATE_PRESENT_NAME_UNAVAILABLE') : 'SOURCE_ITEM_PRESENT_CANDIDATE_MISSING', currentCandidateName: h0.universeRow?.currentCandidateName ?? null, currentCandidatePage: cand ? h0.page : null,
        failureClass: cand ? 'F4' : 'F3', failureDetail: cand ? `candidate present but not exact (nameClass=${h0.universeRow?.nameClass})` : `item row exists in source but is not a current candidate (universe row: ${h0.universeRow ? `ruleStatus=${h0.universeRow.ruleStatus}, deltaX01=${h0.universeRow.deltaX01}, nameClass=${h0.universeRow.nameClass}` : 'none'})`, recoverabilityClass: 'RECOVERABLE_WITH_CURRENT_TEXT_GEOMETRY' };
    } else if (mextKnown && readable.length > 0 && sameAuthHits.length === 0) {
      r = { sourceAssignmentStatus: 'SOURCE_ASSIGNMENT_PARTIAL', sourcePdfPath: null, sourcePage: null, sourceEvidence: 'authority-level only (same-authority readable PDFs scanned; no exact name hit); the independent check of the detail PDF found no full name (baseline sourceClass)', pdfRepresentationClass: 'TEXT_GEOMETRY_AVAILABLE', sourceFullNameStatus: 'SOURCE_FULL_NAME_ABSENT', currentCandidateStatus: 'SOURCE_ITEM_NOT_OBSERVED', currentCandidateName: null, currentCandidatePage: null,
        failureClass: 'F2', failureDetail: `baseline independent check = SOURCE_FULL_NAME_ABSENT; this scan: 0 exact hits in ${readable.length} readable same-authority PDF(s); same name found in other-authority PDFs: ${otherAuthHits.length > 0 ? 'yes' : 'no'}; MOF fiscal-year amount 0 is NOT used`, recoverabilityClass: 'NOT_CURRENTLY_RECOVERABLE_FROM_SOURCE' };
    } else if (sameAuthHits.length === 0 && blocked.length > 0) {
      r = { sourceAssignmentStatus: 'SOURCE_ASSIGNMENT_PARTIAL', sourcePdfPath: null, sourcePage: null, sourceEvidence: `authority-level only: no exact name hit in readable same-authority PDFs; same-authority PDF(s) with unreadable representation: ${blocked.map(b => `${b.localPath} (${b.representation})`).join('; ')}. Item-level assignment cannot be shown because the text is unreadable`, pdfRepresentationClass: blocked[0].representation, sourceFullNameStatus: 'SOURCE_TEXT_UNREADABLE', currentCandidateStatus: 'CANDIDATE_STATUS_UNRESOLVED', currentCandidateName: null, currentCandidatePage: null,
        failureClass: 'F1', failureDetail: `blocked same-authority PDF(s): ${blocked.map(b => b.localPath.split('/').pop()).join(', ')} (pages=${blocked.map(b => b.pages).join(',')}, tokens=${blocked.map(b => b.tokens).join(',')})`, authorityLevelBlockerPdfs: blocked.map(b => b.localPath), recoverabilityClass: 'REQUIRES_NEW_REPRESENTATION_SUPPORT' };
    } else if (sameAuthHits.length > 0) {
      r = { sourceAssignmentStatus: 'SOURCE_ASSIGNMENT_PARTIAL', sourcePdfPath: null, sourcePage: null, sourceEvidence: `exact name found in same-authority PDF(s) but not as a general-account item row: ${sameAuthHits.slice(0, 3).map(h => `${h.pdfPath.split('/').pop()}#${h.page} (${h.kind}, left=${h.leftCode?.shape ?? 'none'}, ${pdfBy.get(h.pdfPath)!.accountType})`).join('; ')}`, pdfRepresentationClass: 'TEXT_GEOMETRY_AVAILABLE', sourceFullNameStatus: 'SOURCE_FULL_NAME_PRESENT_ELSEWHERE', currentCandidateStatus: 'SOURCE_ITEM_NOT_OBSERVED', currentCandidateName: null, currentCandidatePage: null,
        failureClass: 'F7', failureDetail: 'same name present in same-authority PDF but not as a general-account item row (e.g. special-account PDF, embedded text); identity with the MOF general-account item is not asserted', recoverabilityClass: 'UNRESOLVED' };
    } else {
      r = { sourceAssignmentStatus: authPdfs.length > 0 ? 'SOURCE_ASSIGNMENT_PARTIAL' : 'SOURCE_ASSIGNMENT_UNRESOLVED', sourcePdfPath: null, sourcePage: null, sourceEvidence: authPdfs.length > 0 ? `authority-level only: ${readable.length} readable same-authority PDF(s) scanned, 0 exact name hits (absence is not asserted: no positive evidence)` : 'no same-authority PDF in the corpus', pdfRepresentationClass: readable.length > 0 ? 'TEXT_GEOMETRY_AVAILABLE' : 'UNKNOWN', sourceFullNameStatus: 'SOURCE_FULL_NAME_UNRESOLVED', currentCandidateStatus: 'SOURCE_ITEM_NOT_OBSERVED', currentCandidateName: null, currentCandidatePage: null,
        failureClass: 'F0', failureDetail: `no exact hit in ${readable.length} readable same-authority PDF(s); other-authority exact hits: ${otherAuthHits.length}; near-text (descriptive, not used for classification): ${stems.length}`, recoverabilityClass: 'UNRESOLVED' };
    }
    return sortDeep({ ...base, ...r });
  }).sort((a, b) => cmp((a as { mofRowId: string }).mofRowId, (b as { mofRowId: string }).mofRowId));
  const ids = new Set(rows.map(r => (r as { mofRowId: string }).mofRowId));
  if (ids.size !== 59 || rows.length !== 59 || baseline.unmatchedMof.some(m => !ids.has(m.mofSectionId))) throw new Error('inventory の件数・identity が不一致（STOP）');
  const gz = zlib.gzipSync(Buffer.from(rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8'), { level: 9 });
  fs.writeFileSync(`${OUT}/unmatched-59-inventory.jsonl.gz`, gz);
  // source-pdf-inventory（確認した全 PDF）
  const assignedItem: Record<string, string[]> = {}, assignedAuthority: Record<string, string[]> = {};
  for (const r of rows as { mofRowId: string; sourcePdfPath: string | null; authorityLevelBlockerPdfs?: string[] }[]) { if (r.sourcePdfPath) (assignedItem[r.sourcePdfPath] ??= []).push(r.mofRowId); for (const p of r.authorityLevelBlockerPdfs ?? []) (assignedAuthority[p] ??= []).push(r.mofRowId); }
  const pdfInv = scan.pdfs.map(p => ({ path: p.localPath, sha256: p.sha256, pages: p.pages, rotation: p.rotation, representation: p.representation, publisherAuthority: p.publisherAuthority, accountType: p.accountType, tokens: p.tokens, asciiDigitTokens: p.asciiDigitTokens, pagesWithoutTokens: p.pagesWithoutTokens, assignedUnmatchedMofRowsItemLevel: (assignedItem[p.localPath] ?? []).sort(), assignedUnmatchedMofRowsAuthorityLevelOnly: (assignedAuthority[p.localPath] ?? []).sort(), evidence: BLOCKED.has(p.representation) ? `representation=${p.representation}: tokens=${p.tokens}, pagesWithoutTokens=${p.pagesWithoutTokens}/${p.pages}` : `readable: tokens=${p.tokens}` }));
  fs.writeFileSync(`${OUT}/source-pdf-inventory.json`, `${JSON.stringify(sortDeep({ schema: 'budget-request-unmatched59-source-pdf-inventory/v0', note: '確認した全 82 PDF。item レベルの assignment は名称が item らしい行で確認できたもののみ。authority レベルのみは所管の一致だけを根拠にした記述で item の assignment ではない', pdfs: pdfInv }), null, 1)}\n`);
  console.log(JSON.stringify({ inventoryGz: sha(gz), rows: rows.length, classes: (rows as { failureClass: string }[]).reduce((m: Record<string, number>, r) => { m[r.failureClass] = (m[r.failureClass] ?? 0) + 1; return m; }, {}) }));
}
main();
