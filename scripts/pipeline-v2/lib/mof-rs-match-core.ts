/**
 * MOF↔RSリンクのneutralなmatching core。production（mof-rs-links.tsのbuildMofRsLinks）と
 * validation（lib/validation/mof-rs-linkage.tsのD-5 shadow diagnostic）の両方から参照される、
 * どちらにも依存しない共有ロジック層。
 *
 * このモジュールは意図的に:
 * - Finding型・validate-checks.tsを一切importしない（診断findingを作らない）
 * - ファイルI/Oを行わない
 * - production/validationいずれの上位モジュールもimportしない（循環依存防止）
 *
 * P1（構造化key完全一致）primitiveと、P2（supplementalInfoからの復元＝
 * 41_p2-shadow-validator-spec.md準拠）のparser/scope判定/target解決/reconciliationを
 * 純粋関数としてここに集約する。P2のproduction昇格（53_sonnet-p2-shared-core-extraction-
 * instructions.md）に向けて、production/validation双方が同一実装を参照できるようにするため
 * の抽出であり、このファイル自体はいかなる挙動も変更していない
 * （lib/mof-rs-links.ts・lib/validation/mof-rs-linkage.tsからの単純な移動）。
 */
import { normalizeText } from './stable-id';
import type { MofBudgetItemRecord, RsBudgetItemRecordV2 } from '../types';

// ============================================================
// P1: 構造化key完全一致のmatching primitive
// ============================================================

export type Stage = readonly [phase: 'initial' | 'supplement', revision: number | null];

export function stageKey(stage: Stage): string {
  return `${stage[0]}\x1f${stage[1] ?? ''}`;
}

export function mofKeyFrom(m: MofBudgetItemRecord): string | null {
  if (!m.sectionName || !m.subItemName) return null;
  let parts: string[];
  if (m.accountType === 'general') {
    parts = ['general', m.ministry ?? '', m.organization ?? '', m.sectionName, m.subItemName];
  } else if (m.accountType === 'special') {
    parts = ['special', m.ministry ?? '', m.specialAccount ?? '', m.subAccount ?? '', m.sectionName, m.subItemName];
  } else {
    return null;
  }
  return parts.map(normalizeText).join('|');
}

export function rsKeyFrom(r: RsBudgetItemRecordV2): string | null {
  if (!r.sectionName || !r.subItemName || !r.budgetMinistry) return null;
  let parts: string[];
  if (r.accountType === 'general') {
    parts = ['general', r.budgetMinistry, r.organizationOrAccount ?? '', r.sectionName, r.subItemName];
  } else if (r.accountType === 'special') {
    parts = ['special', r.budgetMinistry, r.account ?? '', r.subAccount ?? '', r.sectionName, r.subItemName];
  } else {
    return null;
  }
  return parts.map(normalizeText).join('|');
}

export function rsPhase(r: RsBudgetItemRecordV2): Stage | null {
  const bt = r.budgetType ?? '';
  if (bt === '当初予算') return ['initial', null];
  const m = /^第(\d+)次補正予算$/.exec(bt);
  if (m) return ['supplement', Number(m[1])];
  return null;
}

// ============================================================
// D-5 / P2: Supplemental Exact matching core（41_p2-shadow-validator-spec.md準拠）
//
// 設計原則:
// - target選択に金額を使わない（金額はreconciliationにのみ使う）
// - substring/suffix/fuzzy matchingは禁止。normalizeText()後のtoken完全一致のみ
// - 明示scope（所管/会計/勘定等）がMOF targetと矛盾する場合は、項・目と金額が
//   一致しても安全候補へ昇格しない（explicit-scope-conflict）
// - review時点RS scopeと過年度MOF scopeの差は自動補正せずP2c（shadow/manual）に分離する
// ============================================================

export type SupplementalExactParseKind = 'labeled' | 'slash-path' | 'fwspace-pair' | 'slash-pair';
export type SupplementalExactTargetResolution =
  | 'explicit-scope-exact' | 'pair-unique' | 'rs-scope-resolved' | 'historical-scope-mismatch' | 'explicit-scope-conflict';
export type SupplementalExactReconciliation = 'exact' | 'improve' | 'no-improve' | 'overcount';

export interface SupplementalExactCandidate {
  rsRecordId: string;
  projectId: string;
  parseKind: SupplementalExactParseKind;
  parsedSectionName: string;
  parsedSubItemName: string;
  targetResolution: SupplementalExactTargetResolution;
  targetNaturalKey: string;
  mofRecordIds: string[];
  existingRsAmountYen: number;
  candidateGroupAmountYen: number;
  reconstructedRsAmountYen: number;
  mofAmountYen: number;
  differenceBeforeYen: number;
  differenceAfterYen: number;
  reconciliation: SupplementalExactReconciliation;
}

export interface SupplementalExactSummary {
  parsedCandidateCount: number;
  p2aFullPathExactCount: number;
  p2bPairUniqueCount: number;
  p2bRsScopeResolvedCount: number;
  p2cHistoricalScopeMismatchCount: number;
  explicitScopeConflictCount: number;
  ambiguousTargetCount: number;
  parseRejectedCount: number;
  exactReconciliationRecordCount: number;
  exactReconciliationGroupCount: number;
  safeExactRecordCount: number;
  safeExactGroupCount: number;
}

interface ExplicitScope { ministry?: string; organization?: string; specialAccount?: string; subAccount?: string }
interface ParsedSupplementalInfo {
  kind: SupplementalExactParseKind;
  sectionName: string;
  subItemName: string;
  explicitScope?: ExplicitScope;
}
interface MofScope { accountType: 'general' | 'special'; ministry: string; organization: string; specialAccount: string; subAccount: string }

function isRejectedFragment(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (t === 'その他') return true;
  if (/^(当初予算|第\d+次補正予算)$/.test(t)) return true;
  return false;
}

/** RS labeled `会計`ラベルは「〜会計」を含むがMOF specialAccountフィールドは末尾の会計/特別会計を含まない */
function stripAccountSuffix(s: string): string {
  return s.replace(/特別会計$/, '').replace(/会計$/, '');
}

/** A. `（項）.../（目）...`等のラベル型（（所管）（組織）（会計）（勘定）も明示scopeとして拾う） */
function parseLabeled(s: string, accountType: 'general' | 'special'): ParsedSupplementalInfo | null {
  const segments = s.split(/[／/]/).map(seg => seg.trim()).filter(seg => seg.length > 0);
  const labelMap: Partial<Record<'所管' | '組織' | '会計' | '勘定' | '項' | '目', string>> = {};
  let hasAnyLabel = false;
  for (const seg of segments) {
    const m = /^[（(](所管|組織|会計|勘定|項|目)[）)]\s*(.*)$/.exec(seg);
    if (m) { labelMap[m[1] as '所管'] = m[2].trim(); hasAnyLabel = true; }
  }
  if (!hasAnyLabel) return null;
  const section = labelMap['項'];
  const item = labelMap['目'];
  if (!section || !item || isRejectedFragment(section) || isRejectedFragment(item)) return null;

  const explicitScope: ExplicitScope = {};
  if (labelMap['所管']) explicitScope.ministry = labelMap['所管'];
  if (labelMap['組織']) explicitScope.organization = labelMap['組織'];
  // review指摘: 一般会計行に（会計）一般会計のようなラベルが付くケースでは、これは単なる
  // account種別の確認であり実在するspecialAccount値ではない。一般会計にspecialAccount/subAccountは
  // 存在しないため、specialアカウントの行でのみ（会計）（勘定）ラベルをscopeとして採用する
  // （一般会計行でstripAccountSuffix("一般会計")="一般"をspecialAccountとして格納すると、
  // scopeIsConsistent()がMOF targetのspecialAccount=""と比較して誤ってexplicit-scope-conflictにする）
  if (accountType === 'special') {
    if (labelMap['会計']) explicitScope.specialAccount = stripAccountSuffix(labelMap['会計']);
    if (labelMap['勘定']) explicitScope.subAccount = labelMap['勘定'];
  }
  return { kind: 'labeled', sectionName: section, subItemName: item, explicitScope: Object.keys(explicitScope).length > 0 ? explicitScope : undefined };
}

/**
 * B. full path表記。`一般会計/特別会計`マーカーの有無、先頭の`※新規予算項目`等のnoteの有無に
 * 関わらず、末尾2tokenを項・目、残りをscope componentとして accountType別に位置で割り当てる
 * （review指摘: RS実データでは`一般会計`マーカーを伴わない`所管/組織/項/目`4token表記や、
 * `※新規予算項目／一般会計／所管／組織／項／目`のようなnote付きが多数を占める。マーカー必須の
 * 実装ではこれらを丸ごと取りこぼしていた）。
 */
function parseSlashPath(s: string, accountType: 'general' | 'special'): ParsedSupplementalInfo | null {
  let tokens = s.split(/[／/]/).map(t => t.trim()).filter(t => t.length > 0);
  if (tokens.length > 0 && tokens[0].startsWith('※')) tokens = tokens.slice(1);
  if (tokens.length > 0 && (tokens[0] === '一般会計' || tokens[0] === '特別会計')) tokens = tokens.slice(1);
  if (tokens.length < 3) return null;

  const section = tokens[tokens.length - 2];
  const item = tokens[tokens.length - 1];
  if (isRejectedFragment(section) || isRejectedFragment(item)) return null;
  const rest = tokens.slice(0, -2);

  const explicitScope: ExplicitScope = {};
  if (accountType === 'general') {
    if (rest.length === 2) { explicitScope.ministry = rest[0]; explicitScope.organization = rest[1]; }
    else if (rest.length === 1) { explicitScope.ministry = rest[0]; }
    else return null;
  } else {
    // 実データ確認済みの順序: specialAccount / ministry / subAccount（"特別会計"マーカー無し）
    if (rest.length === 3) { explicitScope.specialAccount = stripAccountSuffix(rest[0]); explicitScope.ministry = rest[1]; explicitScope.subAccount = rest[2]; }
    else if (rest.length === 2) { explicitScope.specialAccount = stripAccountSuffix(rest[0]); explicitScope.subAccount = rest[1]; }
    else if (rest.length === 1) { explicitScope.specialAccount = stripAccountSuffix(rest[0]); }
    else return null;
  }
  return { kind: 'slash-path', sectionName: section, subItemName: item, explicitScope };
}

/** C. `項名　目名`（U+3000区切り、厳密2token） */
function parseFwspacePair(s: string): ParsedSupplementalInfo | null {
  const tokens = s.split('　').map(t => t.trim()).filter(t => t.length > 0);
  if (tokens.length !== 2) return null;
  const [section, item] = tokens;
  if (isRejectedFragment(section) || isRejectedFragment(item)) return null;
  return { kind: 'fwspace-pair', sectionName: section, subItemName: item };
}

/** D. `項/目` または `項／目`（厳密2token） */
function parseSlashPair(s: string): ParsedSupplementalInfo | null {
  const tokens = s.split(/[／/]/).map(t => t.trim()).filter(t => t.length > 0);
  if (tokens.length !== 2) return null;
  const [section, item] = tokens;
  if (isRejectedFragment(section) || isRejectedFragment(item)) return null;
  return { kind: 'slash-pair', sectionName: section, subItemName: item };
}

/** parser優先順位: labeled → slash-path → fwspace-pair → slash-pair */
export function parseSupplementalExactInfo(raw: string, accountType: 'general' | 'special'): ParsedSupplementalInfo | null {
  const s = (raw ?? '').trim();
  if (!s || isRejectedFragment(s)) return null;
  return parseLabeled(s, accountType) ?? parseSlashPath(s, accountType) ?? parseFwspacePair(s) ?? parseSlashPair(s);
}

/**
 * review指摘: 補足情報の（所管）／full pathの所管は明示scopeであり、RS共通ministry列
 * （structuralScopeMatches側でministry/organizationいずれかに一致すればOKとする曖昧な列）とは
 * 性質が異なる。R5「明示scopeは弱めない」を守るため、明示ministryはMOFのministryフィールドと
 * のみexact比較する（organizationへのfallbackを許すと、例えば補足情報「（所管）観光庁」が
 * MOFのministry=国土交通省/organization=観光庁と矛盾なしと判定されてしまう）
 */
function scopeIsConsistent(scope: MofScope, explicit: ExplicitScope): boolean {
  if (explicit.ministry !== undefined && normalizeText(explicit.ministry) !== normalizeText(scope.ministry)) return false;
  if (explicit.organization !== undefined && normalizeText(explicit.organization) !== normalizeText(scope.organization)) return false;
  if (explicit.specialAccount !== undefined && normalizeText(explicit.specialAccount) !== normalizeText(scope.specialAccount)) return false;
  if (explicit.subAccount !== undefined && normalizeText(explicit.subAccount) !== normalizeText(scope.subAccount)) return false;
  return true;
}

/**
 * RS共通`ministry`列は「国土交通省　観光庁」のように所管+外局・部局名が
 * 全角スペース区切りで連結されている場合がある。normalizeText()は全角スペースも
 * 除去してしまい1トークンに潰れて比較不能になるため、空白でtoken分割してから
 * 各tokenをnormalizeText()した集合で比較する（substring一致ではなくtoken完全一致）。
 */
function ministryTokens(raw: string): string[] {
  return raw.split(/[\s　]+/).map(normalizeText).filter(Boolean);
}

/** RSの構造化scope列（budgetMinistryではなくministry/account/subAccount）とMOF targetのscopeが一致するか */
function structuralScopeMatches(accountType: 'general' | 'special', scope: MofScope, r: RsBudgetItemRecordV2): boolean {
  if (accountType === 'general') {
    if (!r.ministry) return false;
    const tokens = ministryTokens(r.ministry);
    return tokens.includes(normalizeText(scope.ministry)) || tokens.includes(normalizeText(scope.organization));
  }
  if (!r.account) return false;
  if (normalizeText(r.account) !== normalizeText(scope.specialAccount)) return false;
  if (r.subAccount) return normalizeText(r.subAccount) === normalizeText(scope.subAccount);
  return true;
}

/** R4判定用: 構造化scope（r.ministry等）が「対象で無い」ことをスコープ材料が無いだけで断定しないための緩い一致判定 */
function structuralScopeIsConsistent(accountType: 'general' | 'special', scope: MofScope, r: RsBudgetItemRecordV2): boolean {
  if (accountType === 'general') {
    if (!r.ministry) return true;
    const tokens = ministryTokens(r.ministry);
    if (tokens.length === 0) return true;
    return tokens.includes(normalizeText(scope.ministry)) || tokens.includes(normalizeText(scope.organization));
  }
  if (!r.account) return true;
  if (normalizeText(r.account) !== normalizeText(scope.specialAccount)) return false;
  if (r.subAccount) return normalizeText(r.subAccount) === normalizeText(scope.subAccount);
  return true;
}

function buildExpectedNaturalKey(accountType: 'general' | 'special', section: string, item: string, scope: ExplicitScope): string | null {
  if (accountType === 'general') {
    if (!scope.ministry || !scope.organization) return null;
    return ['general', scope.ministry, scope.organization, section, item].map(normalizeText).join('|');
  }
  if (!scope.ministry || !scope.specialAccount || !scope.subAccount) return null;
  return ['special', scope.ministry, scope.specialAccount, scope.subAccount, section, item].map(normalizeText).join('|');
}

function classifyReconciliation(mofAmountYen: number, existingRsAmountYen: number, reconstructedRsAmountYen: number): SupplementalExactReconciliation {
  const differenceBeforeYen = mofAmountYen - existingRsAmountYen;
  const differenceAfterYen = mofAmountYen - reconstructedRsAmountYen;
  if (differenceBeforeYen === 0) return differenceAfterYen === 0 ? 'exact' : 'overcount';
  if (differenceAfterYen === 0) return 'exact';
  if (differenceAfterYen < 0) return 'overcount';
  if (Math.abs(differenceAfterYen) < Math.abs(differenceBeforeYen)) return 'improve';
  return 'no-improve';
}

export const SAFE_TARGET_RESOLUTIONS = new Set<SupplementalExactTargetResolution>(['explicit-scope-exact', 'pair-unique', 'rs-scope-resolved']);

/**
 * P2 Supplemental Exact matchingの純粋評価関数。missing-link-key（`rsKeyFrom(r) === null`）の
 * RS行のうち`supplementalInfo`からMOF targetを復元できるものを抽出・分類・金額検算する。
 * Finding生成やファイルI/Oは一切行わない（呼び出し元がvalidation findingへ変換する）。
 */
export function evaluateSupplementalExact(
  mofRows: MofBudgetItemRecord[], rsRowsForYear: RsBudgetItemRecordV2[], fiscalYear: number
): { candidates: SupplementalExactCandidate[]; summary: SupplementalExactSummary } {
  // MOF側index: stage+naturalKey -> 金額/recordIds、naturalKey -> scope、stage+accountType+section+item -> naturalKey候補集合
  const mofAmountByGroup = new Map<string, number>();
  const mofRecordIdsByGroup = new Map<string, string[]>();
  const mofScopeByNaturalKey = new Map<string, MofScope>();
  const mofCandidatesBySectionItem = new Map<string, Set<string>>();

  for (const m of mofRows) {
    let stage: Stage;
    let amount: number;
    if (m.phase === 'initial' && m.budgetStatus === 'enacted') { stage = ['initial', null]; amount = m.amountYen ?? 0; }
    else if (m.phase === 'supplement') { stage = ['supplement', m.revision ?? 0]; amount = m.supplementDeltaYen ?? 0; }
    else continue;
    if (m.accountType !== 'general' && m.accountType !== 'special') continue;
    const key = mofKeyFrom(m);
    if (!key) continue;
    const sk = stageKey(stage);
    const groupKey = `${sk}\x1f${key}`;
    mofAmountByGroup.set(groupKey, (mofAmountByGroup.get(groupKey) ?? 0) + amount);
    const ids = mofRecordIdsByGroup.get(groupKey) ?? [];
    ids.push(m.recordId);
    mofRecordIdsByGroup.set(groupKey, ids);
    if (!mofScopeByNaturalKey.has(key)) {
      mofScopeByNaturalKey.set(key, {
        accountType: m.accountType, ministry: m.ministry ?? '', organization: m.organization ?? '',
        specialAccount: m.specialAccount ?? '', subAccount: m.subAccount ?? '',
      });
    }
    if (!m.sectionName || !m.subItemName) continue;
    const sectionItemKey = `${sk}\x1f${m.accountType}\x1f${normalizeText(m.sectionName)}\x1f${normalizeText(m.subItemName)}`;
    const set = mofCandidatesBySectionItem.get(sectionItemKey) ?? new Set<string>();
    set.add(key);
    mofCandidatesBySectionItem.set(sectionItemKey, set);
  }

  // 既存P1でlink済みのRS金額（P2 reconciliationのexisting baseに使う。この評価関数自体は
  // production linkを一切変更しない）
  const rsLinkedAmountByGroup = new Map<string, number>();
  for (const r of rsRowsForYear) {
    const stage = rsPhase(r);
    if (!stage) continue;
    const key = rsKeyFrom(r);
    if (!key) continue;
    const groupKey = `${stageKey(stage)}\x1f${key}`;
    if (!mofAmountByGroup.has(groupKey)) continue;
    rsLinkedAmountByGroup.set(groupKey, (rsLinkedAmountByGroup.get(groupKey) ?? 0) + (r.budgetAmountYen ?? 0));
  }

  // P2対象: fiscalYear一致 / rsPhase有効 / rsKeyFrom===null（missing-link-keyのみ） / supplementalInfoが非空
  const targetRows = rsRowsForYear.filter(r =>
    r.fiscalYear === fiscalYear && rsPhase(r) !== null && rsKeyFrom(r) === null && (r.supplementalInfo ?? '').trim() !== ''
  );

  let parsedCandidateCount = 0;
  let parseRejectedCount = 0;
  let ambiguousTargetCount = 0;

  interface ResolvedRow {
    r: RsBudgetItemRecordV2; parseKind: SupplementalExactParseKind; sectionName: string; subItemName: string;
    targetResolution: SupplementalExactTargetResolution; targetNaturalKey: string; mofRecordIds: string[]; mofAmountYen: number;
  }
  const resolvedRows: ResolvedRow[] = [];

  for (const r of targetRows) {
    if (r.accountType !== 'general' && r.accountType !== 'special') { parseRejectedCount++; continue; }
    const accountType: 'general' | 'special' = r.accountType;
    const parsed = parseSupplementalExactInfo(r.supplementalInfo, accountType);
    if (!parsed) { parseRejectedCount++; continue; }
    parsedCandidateCount++;

    const stage = rsPhase(r)!;
    const sk = stageKey(stage);
    const sectionItemKey = `${sk}\x1f${accountType}\x1f${normalizeText(parsed.sectionName)}\x1f${normalizeText(parsed.subItemName)}`;
    const candidateKeys = mofCandidatesBySectionItem.get(sectionItemKey) ?? new Set<string>();

    const pushResolved = (targetResolution: SupplementalExactTargetResolution, naturalKey: string) => {
      const groupKey = `${sk}\x1f${naturalKey}`;
      resolvedRows.push({
        r, parseKind: parsed.kind, sectionName: parsed.sectionName, subItemName: parsed.subItemName,
        targetResolution, targetNaturalKey: naturalKey,
        mofRecordIds: mofRecordIdsByGroup.get(groupKey) ?? [], mofAmountYen: mofAmountByGroup.get(groupKey) ?? 0,
      });
    };

    // R1: explicit-scope-exact — 明示scopeからfull natural keyが一意に組み立てられ、実在するMOF groupと完全一致する
    if (parsed.explicitScope) {
      const expectedKey = buildExpectedNaturalKey(accountType, parsed.sectionName, parsed.subItemName, parsed.explicitScope);
      if (expectedKey && mofAmountByGroup.has(`${sk}\x1f${expectedKey}`)) {
        pushResolved('explicit-scope-exact', expectedKey);
        continue;
      }
    }

    if (candidateKeys.size === 0) continue; // section/itemに一致するMOF targetが無い（parse成功だが候補無し）

    if (candidateKeys.size === 1) {
      const onlyKey = [...candidateKeys][0];
      const scope = mofScopeByNaturalKey.get(onlyKey)!;
      // R5: 明示scopeが宣言されているのに、唯一の候補のscopeと矛盾する → 項・目と金額が一致しても安全候補にしない
      if (parsed.explicitScope && !scopeIsConsistent(scope, parsed.explicitScope)) {
        pushResolved('explicit-scope-conflict', onlyKey);
        continue;
      }
      // R4: 明示scopeは無い（または矛盾なし）が、review時点RS構造化scope（r.ministry等）が過年度MOF scopeと一致しない
      if (structuralScopeIsConsistent(accountType, scope, r)) {
        pushResolved('pair-unique', onlyKey); // R2
      } else {
        pushResolved('historical-scope-mismatch', onlyKey); // R4 → P2c（shadow/manual review、safeから除外）
      }
      continue;
    }

    // candidateKeys.size > 1: 明示scope（無ければRS構造化scope）で1件へ絞り込めた場合のみR3として解決する
    const narrowed = parsed.explicitScope
      ? [...candidateKeys].filter(k => scopeIsConsistent(mofScopeByNaturalKey.get(k)!, parsed.explicitScope!))
      : [...candidateKeys].filter(k => structuralScopeMatches(accountType, mofScopeByNaturalKey.get(k)!, r));
    if (narrowed.length === 1) {
      pushResolved('rs-scope-resolved', narrowed[0]); // R3
    } else {
      ambiguousTargetCount++; // 0件または複数残る場合はambiguous-target（安全候補にしない）
    }
  }

  // target group単位（stage+resolutionバケット+targetNaturalKey）でP2候補を合算し、reconciliationを1回だけ算出する。
  // review指摘: safe（explicit-scope-exact/pair-unique/rs-scope-resolved）は「同じtargetへの
  // 安全な候補」という意味で1つのbucketにまとめて合算しないと、同一targetに複数のsafe候補が
  // 別々のresolution種別で乗った場合に、それぞれが独立に（過小な）金額でexact判定されてしまう
  // （例: MOF1000円のtargetにpair-unique 1000円とrs-scope-resolved 1000円が両方乗ると、
  // 合算すれば2000円で超過のはずが、別々に見るとどちらも1000円でexactと誤判定する）。
  // unsafe（explicit-scope-conflict/historical-scope-mismatch）はsafeの金額を汚染しないよう
  // 引き続き別bucketのままにする
  interface GroupAgg { mofAmountYen: number; existingRsAmountYen: number; mofRecordIds: string[]; rows: ResolvedRow[] }
  const groups = new Map<string, GroupAgg>();
  for (const row of resolvedRows) {
    const stage = rsPhase(row.r)!;
    const resolutionBucket = SAFE_TARGET_RESOLUTIONS.has(row.targetResolution) ? 'safe' : row.targetResolution;
    const groupKey = `${stageKey(stage)}\x1f${resolutionBucket}\x1f${row.targetNaturalKey}`;
    const existingRsAmountYen = rsLinkedAmountByGroup.get(`${stageKey(stage)}\x1f${row.targetNaturalKey}`) ?? 0;
    const g = groups.get(groupKey) ?? { mofAmountYen: row.mofAmountYen, existingRsAmountYen, mofRecordIds: row.mofRecordIds, rows: [] };
    g.rows.push(row);
    groups.set(groupKey, g);
  }

  const candidates: SupplementalExactCandidate[] = [];
  let exactReconciliationGroupCount = 0;
  let safeExactGroupCount = 0;
  for (const group of groups.values()) {
    const candidateGroupAmountYen = group.rows.reduce((s, row) => s + (row.r.budgetAmountYen ?? 0), 0);
    const reconstructedRsAmountYen = group.existingRsAmountYen + candidateGroupAmountYen;
    const reconciliation = classifyReconciliation(group.mofAmountYen, group.existingRsAmountYen, reconstructedRsAmountYen);
    const isSafe = SAFE_TARGET_RESOLUTIONS.has(group.rows[0].targetResolution);
    if (reconciliation === 'exact') {
      exactReconciliationGroupCount++;
      if (isSafe) safeExactGroupCount++;
    }
    for (const row of group.rows) {
      candidates.push({
        rsRecordId: row.r.recordId, projectId: row.r.projectId, parseKind: row.parseKind,
        parsedSectionName: row.sectionName, parsedSubItemName: row.subItemName,
        targetResolution: row.targetResolution, targetNaturalKey: row.targetNaturalKey, mofRecordIds: group.mofRecordIds,
        existingRsAmountYen: group.existingRsAmountYen, candidateGroupAmountYen, reconstructedRsAmountYen,
        mofAmountYen: group.mofAmountYen,
        differenceBeforeYen: group.mofAmountYen - group.existingRsAmountYen, differenceAfterYen: group.mofAmountYen - reconstructedRsAmountYen,
        reconciliation,
      });
    }
  }

  const bucketCount = (resolution: SupplementalExactTargetResolution) => candidates.filter(c => c.targetResolution === resolution).length;
  const exactReconciliationRecordCount = candidates.filter(c => c.reconciliation === 'exact').length;
  const safeExactRecordCount = candidates.filter(c => SAFE_TARGET_RESOLUTIONS.has(c.targetResolution) && c.reconciliation === 'exact').length;

  const summary: SupplementalExactSummary = {
    parsedCandidateCount,
    p2aFullPathExactCount: bucketCount('explicit-scope-exact'),
    p2bPairUniqueCount: bucketCount('pair-unique'),
    p2bRsScopeResolvedCount: bucketCount('rs-scope-resolved'),
    p2cHistoricalScopeMismatchCount: bucketCount('historical-scope-mismatch'),
    explicitScopeConflictCount: bucketCount('explicit-scope-conflict'),
    ambiguousTargetCount, parseRejectedCount,
    exactReconciliationRecordCount, exactReconciliationGroupCount,
    safeExactRecordCount, safeExactGroupCount,
  };

  return { candidates, summary };
}
