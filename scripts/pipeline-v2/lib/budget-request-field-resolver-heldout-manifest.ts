/**
 * FieldResolver v0 held-out の選定 manifest の検証（評価側。推論側は読まない）。
 * 事前登録: 4 省庁 × 4 カテゴリ（A normal / B blank-zero / C auxiliary / D structural）、development Golden の省庁は使わない。
 */
export const HELDOUT_MANIFEST_SCHEMA = 'budget-request-field-resolver-heldout-manifest/v0';
export const FREEZE_COMMIT = 'abc57b9f8296df7dc8eb87bd98a6eaf7f050bee9';
export const HELDOUT_CATEGORIES = ['normal', 'blank-zero-rich', 'auxiliary-heavy', 'structural-template-boundary'] as const;
const DEVELOPMENT_DOMAINS = ['meti.go.jp', 'mhlw.go.jp', 'mext.go.jp', 'cfa.go.jp'];

export interface HeldoutManifest {
  schema: string;
  freezeCommit: string;
  selectionPolicyVersion: string;
  selectionMethod: string;
  documents: {
    documentId: string;
    ministry: string;
    canonicalUrl: string;
    localPath: string;
    totalPages: number;
    candidatePagesViewed: number[];
    pages: { physicalPage: number; category: string; printedPageLabel: string; selectionBasis: string }[];
  }[];
}

export function validateHeldoutManifest(m: HeldoutManifest): string[] {
  const errors: string[] = [];
  if (m.schema !== HELDOUT_MANIFEST_SCHEMA) errors.push(`schema: ${m.schema}`);
  if (m.freezeCommit !== FREEZE_COMMIT) errors.push('freezeCommit が事前登録と異なる');
  if (m.documents.length < 3) errors.push('省庁が3未満');
  const ids = new Set<string>();
  for (const d of m.documents) {
    if (ids.has(d.documentId)) errors.push(`documentId 重複: ${d.documentId}`);
    ids.add(d.documentId);
    if (DEVELOPMENT_DOMAINS.some(x => d.canonicalUrl.includes(x))) errors.push(`${d.documentId}: development Golden の省庁は使えない`);
    const pages = d.pages.map(p => p.physicalPage);
    if (new Set(pages).size !== pages.length) errors.push(`${d.documentId}: ページ重複`);
    for (const p of d.pages) {
      if (!Number.isInteger(p.physicalPage) || p.physicalPage < 1 || p.physicalPage > d.totalPages) errors.push(`${d.documentId}: ページ範囲外 ${p.physicalPage}`);
      if (!(HELDOUT_CATEGORIES as readonly string[]).includes(p.category)) errors.push(`${d.documentId} p${p.physicalPage}: category ${p.category}`);
      if (!p.selectionBasis.startsWith('human visual PDF inspection only')) errors.push(`${d.documentId} p${p.physicalPage}: selectionBasis`);
      if (!d.candidatePagesViewed.includes(p.physicalPage)) errors.push(`${d.documentId} p${p.physicalPage}: 目視した候補に含まれない`);
    }
    const cats = d.pages.map(p => p.category).sort();
    if (JSON.stringify(cats) !== JSON.stringify([...HELDOUT_CATEGORIES].sort())) errors.push(`${d.documentId}: 4カテゴリが1ページずつではない`);
  }
  if (/FieldResolver (output|diagnostic)s? (was|were) used/i.test(m.selectionMethod)) errors.push('selectionMethod');
  return errors;
}
