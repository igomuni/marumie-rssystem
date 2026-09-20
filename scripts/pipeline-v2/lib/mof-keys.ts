/**
 * MOF行の識別キー生成（normalize-mof.tsから副作用の無い部分を切り出し、テスト可能にしたもの）。
 * Python参照実装 pipeline_v2/normalize_mof.py の _scope/_section_natural_key/
 * _legacy_section_key/_scope_name_item_key と同じロジック。
 */
import { normalizeText } from './stable-id';
import type { MofAccountType } from '../types';

export interface MofScope {
  ministry: string;
  organization: string;
  specialAccount: string;
  subAccount: string;
  agency: string;
}

/** 会計種別ごとに、CSV列のどれが所管/組織/勘定に相当するかを切り分ける */
export function scopeOf(row: Record<string, string>, accountType: MofAccountType): MofScope {
  if (accountType === 'general') {
    return { ministry: row['所管'] ?? '', organization: row['組織'] ?? '', specialAccount: '', subAccount: '', agency: '' };
  }
  if (accountType === 'special') {
    return { ministry: row['所管'] ?? '', organization: '', specialAccount: row['特別会計'] ?? '', subAccount: row['勘定'] ?? '', agency: '' };
  }
  return { ministry: '', organization: '', specialAccount: '', subAccount: row['業務'] ?? '', agency: row['政府関係機関'] ?? '' };
}

function scopeParts(accountType: MofAccountType, scope: MofScope): string[] {
  if (accountType === 'general') return [accountType, scope.ministry, scope.organization];
  if (accountType === 'special') return [accountType, scope.ministry, scope.specialAccount, scope.subAccount];
  return [accountType, scope.agency, scope.subAccount];
}

/** 項の同一性キー（項名を含む）。同一コードが複数の項名で再利用されるケースを区別できる */
export function sectionNaturalKey(accountType: MofAccountType, scope: MofScope, code: string, name: string): string {
  return [...scopeParts(accountType, scope), code, name].map(normalizeText).join('|');
}

/** 項コードのみの同一性キー（項名を含まない）。同名衝突を意図的に許す比較専用キー */
export function legacySectionKey(accountType: MofAccountType, scope: MofScope, code: string): string {
  return [...scopeParts(accountType, scope), code].map(normalizeText).join('|');
}

/** コードを含まない識別キー。RS側にコードが無いためMOF↔RSリンクに使う */
export function scopeNameItemKey(accountType: MofAccountType, scope: MofScope, sectionName: string, subItemName: string): string {
  return [...scopeParts(accountType, scope), sectionName, subItemName].map(normalizeText).join('|');
}

export function findHeader(headers: string[], needles: string[], exclude: string[] = []): string | undefined {
  return headers.find(h => needles.every(n => h.includes(n)) && !exclude.some(x => h.includes(x)));
}

/** 初年度額の列。「予算額/要求額/予定額」を含み、前年度・比較・成立・改を除いた最初の列 */
export function standardAmountColumn(headers: string[]): string {
  const candidates = headers.filter(h => {
    if (h.includes('前年度') || h.includes('比較') || h.includes('成立') || h.startsWith('改')) return false;
    if (!h.includes('年度')) return false;
    return ['予算額', '要求額', '予定額'].some(w => h.includes(w));
  });
  if (candidates.length === 0) throw new Error(`本年度額の列が見つかりません: ${headers.join(', ')}`);
  return candidates[0];
}

export function isExpenditureHeaders(headers: string[]): boolean {
  return headers.some(h => h.includes('主要経費別分類') || h.includes('使途別分類'));
}
