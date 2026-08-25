/**
 * MOF事項 ↔ RS事業 紐づけデータ生成スクリプト
 *
 * MOF予算書の〔事項別内訳〕（mof-jikou-{年度}.json）と RS システムの事業を突合し、
 * N対N の紐づけレコードを生成する。事項と事業を直結する公式キーは存在しないため
 * （docs/mof-budget-data-guide.md 参照）、紐づけは判定方法つきの3値で管理する:
 *
 *   - confirmed: 構造キー（所管×組織×項）が一致したうえで名前が完全一致、または手動確定
 *   - candidate: 語幹一致（「〜に必要な経費」除去後の包含）など、誤検出がありうる自動判定
 *   - （rejected は手動オーバーライドで除外され、出力には残らない）
 *
 * 自動判定の上に public/data/dictionaries/mof-rs-linkage-overrides.csv の
 * 手動判定（confirmed / rejected）を重ねる。自動判定の再実行で手動判定は消えない。
 *
 * 使用法:
 *   tsx scripts/generate-mof-rs-linkage.ts [RS_YEAR]
 *   例: tsx scripts/generate-mof-rs-linkage.ts 2025
 *   デフォルト: 2025（RS事業年度。予算年度・MOF会計年度はその前年）
 *
 * 入力:
 *   public/data/mof-jikou-{予算年度}.json          … MOF事項（一般会計・当初予算のみ使用）
 *   data/year_{RS_YEAR}/1-1 … 予算事業ID → 事業名・府省庁
 *   data/year_{RS_YEAR}/2-2 … 予算事業ID → 歳出予算科目（所管/組織・勘定/項/目）
 *   public/data/dictionaries/mof-rs-linkage-overrides.csv … 手動判定
 *
 * 出力: public/data/mof-rs-linkage-{予算年度}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from '@/scripts/csv-reader';
import type { CSVRow } from '@/types/rs-system';
import type { MOFJikouData, MOFJikouItem } from '@/types/mof-jikou';
import type {
  MofRsLinkageData,
  MofRsLinkageRecord,
  MofRsLinkageMethod,
  MofRsLinkageStatus,
} from '@/types/mof-rs-linkage';

// ─── 年度設定 ──────────────────────────────────────────────
const RS_YEAR = parseInt(process.argv[2] || '2025', 10);
if (isNaN(RS_YEAR) || RS_YEAR < 2000 || RS_YEAR > 2100) {
  console.error(`Invalid year: ${process.argv[2]}`);
  process.exit(1);
}
/** 予算年度 = MOF会計年度。RS事業年度シートは前年度の予算・執行を記録する */
const BUDGET_YEAR = RS_YEAR - 1;

const DATA_DIR = path.join(__dirname, `../data/year_${RS_YEAR}`);
const OUTPUT_DIR = path.join(__dirname, '../public/data');
const JIKOU_FILE = path.join(OUTPUT_DIR, `mof-jikou-${BUDGET_YEAR}.json`);
const OVERRIDES_FILE = path.join(OUTPUT_DIR, 'dictionaries', 'mof-rs-linkage-overrides.csv');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `mof-rs-linkage-${BUDGET_YEAR}.json`);

// ─── 正規化 ──────────────────────────────────────────────

/** 突合用の文字列正規化: NFKC + 空白除去。表記そのものは出力側に生値で残す */
function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

/**
 * 事項名の語幹抽出。「〜に必要な経費」等の定型句を除去する。
 * 定型句を除いて4文字未満になる語幹（「地域振興」等）は誤検出が多いため捨てる。
 */
function jikouStem(name: string): string {
  const stem = norm(name).replace(/(の実施)?に(必要な|要する)経費$/, '');
  if (stem === norm(name)) return ''; // 定型句が無い名前は語幹一致の対象にしない
  return stem.length >= 4 ? stem : '';
}

/** 事項の年度横断識別子（key から予算種別を除いたものと同じ構成） */
function jikouIdentity(item: MOFJikouItem): string {
  return [
    item.accountType,
    item.ministry,
    item.organization,
    item.specialAccount,
    item.subAccount,
    item.agency,
    item.sectionCode,
    item.name,
  ].join('|');
}

// ─── 入力読み込み ──────────────────────────────────────────

function loadCSV(filename: string): CSVRow[] {
  const filePath = path.join(DATA_DIR, filename);
  console.log(`  読み込み中: ${filename}`);
  const rows = readShiftJISCSV(filePath);
  console.log(`    → ${rows.length.toLocaleString()} 行`);
  return rows;
}

interface OverrideRow {
  pid: number;
  identity: string;
  status: 'confirmed' | 'rejected';
  note: string;
}

function loadOverrides(): OverrideRow[] {
  if (!fs.existsSync(OVERRIDES_FILE)) {
    console.log('  手動オーバーライド: ファイルなし（スキップ）');
    return [];
  }
  const rows = readShiftJISCSV(OVERRIDES_FILE);
  const overrides: OverrideRow[] = [];
  for (const row of rows) {
    const budgetYear = parseInt(row['予算年度'], 10);
    if (budgetYear !== BUDGET_YEAR) continue;
    const pid = parseInt(row['予算事業ID'], 10);
    const status = row['判定'];
    if (isNaN(pid) || !row['事項identity'] || (status !== 'confirmed' && status !== 'rejected')) {
      console.warn(`  ⚠ 不正なオーバーライド行をスキップ: ${JSON.stringify(row)}`);
      continue;
    }
    overrides.push({ pid, identity: row['事項identity'], status, note: row['メモ'] || '' });
  }
  console.log(`  手動オーバーライド: ${overrides.length} 件（予算年度${BUDGET_YEAR}）`);
  return overrides;
}

// ─── メイン処理 ──────────────────────────────────────────

function main() {
  console.log(`=== MOF事項↔RS事業 紐づけデータ生成 (予算年度${BUDGET_YEAR} / RS_${RS_YEAR}) ===\n`);

  // 1. MOF事項（一般会計・当初予算）
  console.log('[1/5] MOF事項読み込み');
  if (!fs.existsSync(JIKOU_FILE)) {
    console.error(`❌ ${JIKOU_FILE} がありません。generate-mof-jikou-data.ts を先に実行してください。`);
    process.exit(1);
  }
  const jikouData: MOFJikouData = JSON.parse(fs.readFileSync(JIKOU_FILE, 'utf-8'));
  const jikouItems = jikouData.items.filter(
    it => it.accountType === 'general' && it.budgetType === '当初予算'
  );
  console.log(`  一般会計・当初予算の事項: ${jikouItems.length.toLocaleString()} 件`);

  // 構造キー（所管|組織|項名） → 事項リスト
  const jikouByStruct = new Map<string, MOFJikouItem[]>();
  for (const it of jikouItems) {
    const key = [norm(it.ministry), norm(it.organization), norm(it.sectionName)].join('|');
    const list = jikouByStruct.get(key) ?? [];
    list.push(it);
    jikouByStruct.set(key, list);
  }

  // 2. RS側: 事業マスタ + 歳出予算科目
  console.log('\n[2/5] RS CSV読み込み');
  const orgRows = loadCSV(`1-1_RS_${RS_YEAR}_基本情報_組織情報.csv`);
  const budgetItemRows = loadCSV(`2-2_RS_${RS_YEAR}_予算・執行_予算種別・歳出予算項目.csv`);

  const projectMap = new Map<number, { name: string; ministry: string }>();
  for (const row of orgRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid)) continue;
    projectMap.set(pid, {
      name: row['事業名'] || '',
      ministry: row['府省庁'] || row['所管府省庁'] || '',
    });
  }
  console.log(`  事業マスタ: ${projectMap.size.toLocaleString()} 事業`);

  // 構造キー → { pid → 予算額合計 }。対象は予算年度・一般会計・当初予算のみ
  const rsByStruct = new Map<string, Map<number, number>>();
  const rsProjectAmount = new Map<number, number>(); // 事業ごとの対象予算合計（カバレッジ算出用）
  let targetRows = 0;
  for (const row of budgetItemRows) {
    const pid = parseInt(row['予算事業ID'], 10);
    if (isNaN(pid) || !projectMap.has(pid)) continue;
    if (parseInt(row['予算年度'], 10) !== BUDGET_YEAR) continue;
    if ((row['会計区分'] || '').trim() !== '一般会計') continue;
    if ((row['予算種別'] || '').trim() !== '当初予算') continue;
    targetRows++;
    const key = [norm(row['所管'] || ''), norm(row['組織・勘定'] || ''), norm(row['項'] || '')].join('|');
    const amount = parseAmount(row['予算額(歳出予算項目ごと)']);
    const perPid = rsByStruct.get(key) ?? new Map<number, number>();
    perPid.set(pid, (perPid.get(pid) ?? 0) + amount);
    rsByStruct.set(key, perPid);
    rsProjectAmount.set(pid, (rsProjectAmount.get(pid) ?? 0) + amount);
  }
  console.log(`  対象行（予算年度${BUDGET_YEAR}・一般会計・当初予算）: ${targetRows.toLocaleString()} 行`);
  console.log(`  対象事業: ${rsProjectAmount.size.toLocaleString()} / 構造キー: ${rsByStruct.size.toLocaleString()} 種`);

  // 3. 自動突合
  console.log('\n[3/5] 自動突合');
  // pid|identity → record（同一ペアの重複判定は精度の高い方を残す）
  const linkMap = new Map<string, MofRsLinkageRecord>();
  const methodRank: Record<MofRsLinkageMethod, number> = {
    'manual': 3,
    'exact-name': 2,
    'stem-in-name': 1,
    'exact-name-cross-section': 0,
  };

  function addLink(
    pid: number,
    jikou: MOFJikouItem,
    status: MofRsLinkageStatus,
    method: MofRsLinkageMethod,
    structMatched: boolean,
    rsAmount: number,
    note = ''
  ) {
    const identity = jikouIdentity(jikou);
    const pairKey = `${pid}|${identity}`;
    const existing = linkMap.get(pairKey);
    if (existing && methodRank[existing.method] >= methodRank[method]) return;
    const project = projectMap.get(pid)!;
    linkMap.set(pairKey, {
      projectId: pid,
      projectName: project.name,
      projectMinistry: project.ministry,
      jikouIdentity: identity,
      jikouKey: jikou.key,
      jikouName: jikou.name,
      mofMinistry: jikou.ministry,
      mofOrganization: jikou.organization,
      sectionCode: jikou.sectionCode,
      sectionName: jikou.sectionName,
      status,
      method,
      structMatched,
      jikouAmount: jikou.amount,
      rsAmount,
      note,
    });
  }

  // 3a. 構造キー一致の範囲内で名前突合
  for (const [structKey, perPid] of rsByStruct) {
    const jikous = jikouByStruct.get(structKey);
    if (!jikous) continue;
    for (const [pid, rsAmount] of perPid) {
      const projName = norm(projectMap.get(pid)!.name);
      for (const jikou of jikous) {
        const jikouName = norm(jikou.name);
        if (projName === jikouName) {
          addLink(pid, jikou, 'confirmed', 'exact-name', true, rsAmount);
        } else {
          const stem = jikouStem(jikou.name);
          if (stem && projName.includes(stem)) {
            addLink(pid, jikou, 'candidate', 'stem-in-name', true, rsAmount);
          }
        }
      }
    }
  }
  const structLinked = linkMap.size;
  console.log(`  構造キー一致内の名前突合: ${structLinked.toLocaleString()} ペア`);

  // 3b. フォールバック: 同一所管内での完全一致（項が違っても名前が同じ場合の拾い上げ）
  const jikouByMinistry = new Map<string, MOFJikouItem[]>();
  for (const it of jikouItems) {
    const key = norm(it.ministry);
    const list = jikouByMinistry.get(key) ?? [];
    list.push(it);
    jikouByMinistry.set(key, list);
  }
  // RS側: 事業が属する所管（2-2の所管はMOFと同語彙）
  const rsMinistryByPid = new Map<number, Set<string>>();
  for (const [structKey, perPid] of rsByStruct) {
    const ministry = structKey.split('|')[0];
    for (const pid of perPid.keys()) {
      const set = rsMinistryByPid.get(pid) ?? new Set<string>();
      set.add(ministry);
      rsMinistryByPid.set(pid, set);
    }
  }
  for (const [pid, ministries] of rsMinistryByPid) {
    const projName = norm(projectMap.get(pid)!.name);
    for (const ministry of ministries) {
      for (const jikou of jikouByMinistry.get(ministry) ?? []) {
        if (norm(jikou.name) === projName) {
          addLink(pid, jikou, 'candidate', 'exact-name-cross-section', false, rsProjectAmount.get(pid) ?? 0);
        }
      }
    }
  }
  console.log(`  所管内完全一致フォールバック: +${(linkMap.size - structLinked).toLocaleString()} ペア`);

  // 4. 手動オーバーライド適用
  console.log('\n[4/5] 手動オーバーライド適用');
  const overrides = loadOverrides();
  const jikouByIdentity = new Map<string, MOFJikouItem>();
  for (const it of jikouItems) jikouByIdentity.set(jikouIdentity(it), it);
  let applied = 0;
  for (const ov of overrides) {
    const pairKey = `${ov.pid}|${ov.identity}`;
    if (ov.status === 'rejected') {
      if (linkMap.delete(pairKey)) applied++;
      continue;
    }
    // confirmed: 既存リンクを昇格、無ければ新規作成
    const jikou = jikouByIdentity.get(ov.identity);
    if (!jikou) {
      console.warn(`  ⚠ オーバーライドの事項identityが見つかりません: ${ov.identity}`);
      continue;
    }
    if (!projectMap.has(ov.pid)) {
      console.warn(`  ⚠ オーバーライドの予算事業IDが見つかりません: ${ov.pid}`);
      continue;
    }
    addLink(ov.pid, jikou, 'confirmed', 'manual', false, rsProjectAmount.get(ov.pid) ?? 0, ov.note);
    applied++;
  }
  console.log(`  適用: ${applied} 件`);

  // 5. 出力
  console.log('\n[5/5] 出力');
  const links = [...linkMap.values()].sort((a, b) => b.rsAmount - a.rsAmount);

  const linkedPids = new Set(links.map(l => l.projectId));
  const linkedIdentities = new Set(links.map(l => l.jikouIdentity));
  const confirmedPids = new Set(links.filter(l => l.status === 'confirmed').map(l => l.projectId));
  const totalRsAmount = [...rsProjectAmount.values()].reduce((a, b) => a + b, 0);
  const linkedRsAmount = [...linkedPids].reduce((a, pid) => a + (rsProjectAmount.get(pid) ?? 0), 0);
  const confirmedRsAmount = [...confirmedPids].reduce((a, pid) => a + (rsProjectAmount.get(pid) ?? 0), 0);

  const countBy = <K extends string>(pick: (l: MofRsLinkageRecord) => K) => {
    const acc = {} as Record<K, number>;
    for (const l of links) acc[pick(l)] = (acc[pick(l)] ?? 0) + 1;
    return acc;
  };

  const output: MofRsLinkageData = {
    metadata: {
      budgetYear: BUDGET_YEAR,
      rsYear: RS_YEAR,
      mofEraLabel: jikouData.metadata.eraLabel,
      scope: '一般会計・当初予算',
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      counts: {
        links: links.length,
        byStatus: countBy(l => l.status),
        byMethod: countBy(l => l.method),
        jikouTotal: jikouItems.length,
        jikouLinked: linkedIdentities.size,
        projectTotal: rsProjectAmount.size,
        projectLinked: linkedPids.size,
        projectConfirmed: confirmedPids.size,
      },
      coverage: {
        rsAmountTotal: totalRsAmount,
        rsAmountLinked: linkedRsAmount,
        rsAmountConfirmed: confirmedRsAmount,
      },
      notes: [
        '事項と事業はN対Nで、1事業が複数事項に、1事項が複数事業に紐づきうる',
        'candidate は自動判定であり誤検出を含みうる。確定には overrides.csv での手動判定が必要',
        'rejected の手動判定は出力から除外されるため、このファイルに rejected は現れない',
        'rsAmount は当該事業の一般会計・当初予算の合計（構造キー一致の場合はそのキー内の合計）',
      ],
    },
    links,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 1));
  const size = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0);
  console.log(`  ✅ ${path.basename(OUTPUT_FILE)} (${size} KB)`);
  console.log(`\n  リンク: ${links.length.toLocaleString()} 件` +
    ` (confirmed ${output.metadata.counts.byStatus['confirmed'] ?? 0}` +
    ` / candidate ${output.metadata.counts.byStatus['candidate'] ?? 0})`);
  console.log(`  事業カバレッジ: ${linkedPids.size.toLocaleString()} / ${rsProjectAmount.size.toLocaleString()} 事業` +
    `、金額 ${(linkedRsAmount / 1e12).toFixed(2)} / ${(totalRsAmount / 1e12).toFixed(2)} 兆円` +
    ` (${(linkedRsAmount / totalRsAmount * 100).toFixed(1)}%)`);
  console.log(`  事項カバレッジ: ${linkedIdentities.size.toLocaleString()} / ${jikouItems.length.toLocaleString()} 事項`);
}

main();
