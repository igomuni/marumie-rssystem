/**
 * 明細表 CSV（DETAIL 行）× MOF 事項の deterministic な突合。J1（所管・事項名の exact）が単一候補のときだけ、
 * K2（source から取った項 X と MOF の sectionName の exact 一致）で確認できたものを採用する。
 * J1 複数は AMBIGUOUS のまま（K2 適用後の候補数は diagnostic）。正規化・金額・コード・部分一致は使わない。
 * 仕様: docs/budget-request-detail-table-mof-match.md。純関数（fs・network に触れない）。
 */

export interface DetailCsvRow { 事項: string; row_type: string; row_index: string; source_page: string; 頁: string }
export interface MofJikouRecord {
  ministry: string; organization: string; sectionCode: string; sectionName: string; jikouName: string; col4Raw: string;
}

export type MatchStatus =
  | 'K2_SUPPORTED'
  | 'UNRESOLVED_SECTION_MISMATCH'
  | 'UNRESOLVED_NO_X'
  | 'AMBIGUOUS_J1_MULTI'
  | 'UNRESOLVED_J1_NO_CANDIDATE'
  | 'OUT_OF_SCOPE_NO_CONTEXT'
  | 'OUT_OF_SCOPE_SPECIAL_ACCOUNT'
  | 'OUT_OF_SCOPE_CONTEXT_NOT_MINISTRY'
  | 'OUT_OF_SCOPE_DETAIL_CODE_PATTERN';

export interface MatchRow {
  source: string;
  row_index: string;
  source_page: string;
  頁: string;
  detail_code: string;
  detail_name: string;
  ministry: string;
  x_source: 'immediate' | 'anchor' | '';
  x: string;
  j1_candidates: number;
  /** J1 候補のうち sectionName == X の数（X が無ければ空）。J1 複数では diagnostic のみ */
  k2_candidates: number | null;
  status: MatchStatus;
  mof: MofJikouRecord | null;
}

const DETAIL = /^([0-9]{2})[‑-]([0-9]{2}) (.*)$/u;
const MINISTRY_CONTEXT = /^[0-9]{2}\s+(.+?)所管/u;
const SPECIAL_ACCOUNT_CONTEXT = /^[0-9]{4}\s/u;
const SECTION = /^([0-9]{2,3}) (.+)$/u;

/** DETAIL の直前の行が CODE3/CODE2 の `NN[N] 名称` なら、その名称（immediate X） */
function immediateX(rows: DetailCsvRow[], n: number): string | null {
  if (n === 0 || (rows[n - 1].row_type !== 'CODE3' && rows[n - 1].row_type !== 'CODE2')) return null;
  return SECTION.exec(rows[n - 1].事項)?.[2] ?? null;
}

/** immediate X が無いとき、上に戻って immediate X を持つ直近の先行 DETAIL の X（anchor carry）。MOF は見ない */
function anchorX(rows: DetailCsvRow[], n: number): string | null {
  for (let k = n - 1; k >= 0; k--) {
    if (rows[k].row_type !== 'DETAIL') continue;
    const x = immediateX(rows, k);
    if (x !== null) return x;
  }
  return null;
}

export function indexMofByMinistryName(records: MofJikouRecord[]): Map<string, MofJikouRecord[]> {
  const index = new Map<string, MofJikouRecord[]>();
  for (const r of records) {
    const key = `${r.ministry}\u0000${r.jikouName}`;
    const list = index.get(key);
    if (list) list.push(r); else index.set(key, [r]);
  }
  return index;
}

export function matchDetailSource(source: string, rows: DetailCsvRow[], mofIndex: Map<string, MofJikouRecord[]>): MatchRow[] {
  const context = rows.find(r => r.row_type === 'CONTEXT')?.事項 ?? null;
  const sourceStatus: MatchStatus | null = context === null ? 'OUT_OF_SCOPE_NO_CONTEXT'
    : SPECIAL_ACCOUNT_CONTEXT.test(context) ? 'OUT_OF_SCOPE_SPECIAL_ACCOUNT'
      : MINISTRY_CONTEXT.test(context) ? null : 'OUT_OF_SCOPE_CONTEXT_NOT_MINISTRY';
  const ministry = context !== null && sourceStatus === null ? MINISTRY_CONTEXT.exec(context)![1] : '';
  const out: MatchRow[] = [];
  rows.forEach((r, n) => {
    if (r.row_type !== 'DETAIL') return;
    const base = { source, row_index: r.row_index, source_page: r.source_page, 頁: r.頁, detail_code: r.事項.slice(0, 5) };
    const empty = { ministry, x_source: '' as const, x: '', j1_candidates: 0, k2_candidates: null, mof: null };
    if (sourceStatus) { out.push({ ...base, detail_name: '', ...empty, status: sourceStatus }); return; }
    const d = DETAIL.exec(r.事項);
    if (!d) { out.push({ ...base, detail_name: '', ...empty, status: 'OUT_OF_SCOPE_DETAIL_CODE_PATTERN' }); return; }
    const name = d[3];
    const imm = immediateX(rows, n);
    const x = imm ?? anchorX(rows, n);
    const candidates = mofIndex.get(`${ministry}\u0000${name}`) ?? [];
    const k2 = x === null ? [] : candidates.filter(c => c.sectionName === x);
    const status: MatchStatus = candidates.length === 0 ? 'UNRESOLVED_J1_NO_CANDIDATE'
      : candidates.length > 1 ? 'AMBIGUOUS_J1_MULTI'
        : x === null ? 'UNRESOLVED_NO_X'
          : k2.length === 1 ? 'K2_SUPPORTED' : 'UNRESOLVED_SECTION_MISMATCH';
    out.push({
      ...base, detail_name: name, ministry,
      x_source: imm !== null ? 'immediate' : x !== null ? 'anchor' : '', x: x ?? '',
      j1_candidates: candidates.length, k2_candidates: x === null ? null : k2.length,
      status, mof: status === 'K2_SUPPORTED' ? candidates[0] : null,
    });
  });
  return out;
}

export const MATCH_CSV_COLUMNS = [
  'source', 'row_index', 'source_page', '頁', 'detail_code', 'detail_name', 'ministry', 'x_source', 'x',
  'j1_candidates', 'k2_candidates', 'status',
  'mof_organization', 'mof_sectionCode', 'mof_sectionName', 'mof_jikouName', 'mof_col4Raw',
] as const;

const cell = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n\r]/u.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function renderMatchCsv(rows: MatchRow[]): string {
  const body = rows.map(r => [
    r.source, r.row_index, r.source_page, r.頁, r.detail_code, r.detail_name, r.ministry, r.x_source, r.x,
    r.j1_candidates, r.k2_candidates ?? '', r.status,
    r.mof?.organization, r.mof?.sectionCode, r.mof?.sectionName, r.mof?.jikouName, r.mof?.col4Raw,
  ].map(cell).join(','));
  return [MATCH_CSV_COLUMNS.join(','), ...body].join('\n') + '\n';
}

/** RFC 4180 の CSV（明細表 CSV の出力形式）。値は trim しない */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = '';
  let rec: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { rec.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rec.push(field); field = '';
      if (rec.length > 1 || rec[0] !== '') records.push(rec); // 空行は読み飛ばす（csv.DictReader と同じ）
      rec = [];
    } else field += c;
  }
  if (field !== '' || rec.length) { rec.push(field); records.push(rec); }
  const [header, ...body] = records;
  return body.map(r => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
}
