'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { accounts, filterAmountRange, parseAmountRange, sortEntities, type EntitySort, initialEnactedAmount, organizationNames, eventLabel, filterEntities, isAdjustment, orderedEvents, yen, type EntityDetail, type Index } from './model';
import styles from './page.module.css';
import { EntityTable } from './entity-table';
import { MultiSelect, PaneLayout, SearchInput } from './controls';
import { fetchV2Index, fetchV2EntityDetails, v2ShardOf } from './v2-source';

async function readData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`データを取得できません（${response.status}）。表示用データを再生成してください。`);
  if (!response.body || typeof DecompressionStream === 'undefined') throw new Error('このブラウザは圧縮データの読み込みに対応していません。最新版のブラウザで開いてください。');
  const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  signal.throwIfAborted();
  return data;
}

/**
 * データソース切替。'v2'がPipeline V2（public/data/v2/mof）、'v1'が旧
 * public/budget-flow-v2（pipeline-v2-full-output.zip由来）。V1は比較・
 * rollback用に残す（2026-09-20指摘）。切替はUI/view model（EntitySummary/
 * EntityDetail/Index）を変えず、fetch先とshard分割方法だけを差し替える。
 */
type DataSource = 'v1' | 'v2';
function readIndex(source: DataSource, year: number, signal: AbortSignal): Promise<Index> {
  return source === 'v2' ? fetchV2Index(year, signal) : readData<Index>(`/budget-flow-v2/${year}.json.gz`, signal);
}
function shardPrefixesOf(source: DataSource, entities: { id: string }[]): string[] {
  return [...new Set(entities.map(e => source === 'v2' ? v2ShardOf(e.id) : e.id[0]))];
}
function readEntityShard(source: DataSource, year: number, prefix: string, signal: AbortSignal): Promise<Record<string, EntityDetail>> {
  return source === 'v2' ? fetchV2EntityDetails(year, prefix, signal) : readData<Record<string, EntityDetail>>(`/budget-flow-v2/${year}/${prefix}.json.gz`, signal);
}

export default function BudgetFlow() {
  const [year, setYear] = useState(2024);
  const [source, setSource] = useState<DataSource>('v2');
  const [mode, setMode] = useState('all');
  const [account, setAccount] = useState<string[]>(['general']);
  const [organizations, setOrganizations] = useState<string[]>([]);
  const [regex, setRegex] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sort, setSort] = useState<EntitySort | null>(null);
  const [amountsLoading, setAmountsLoading] = useState(false);
  const [amountError, setAmountError] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<Index | null>(null);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [activeEvent, setActiveEvent] = useState(0);
  const [evidencePage, setEvidencePage] = useState(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState('events');
  useEffect(() => {
    const abort = new AbortController();
    setIndex(null); setSelected(''); setDetail(null); setError('');
    readIndex(source, year, abort.signal).then(setIndex).catch(e => {
      if (!abort.signal.aborted) setError(String(e.message));
    });
    return () => abort.abort();
  }, [year, source, retry]);
  useEffect(() => {
    const abort = new AbortController();
    setAmounts({}); setAmountError(false); setAmountsLoading(false);
    if (index && index.fiscalYear === year) {
      // Read existing display shards; do not alter Pipeline V2 or aggregate budget stages.
      setAmountsLoading(true);
      const prefixes = shardPrefixesOf(source, index.entities);
      void (async () => {
        for (const prefix of prefixes) {
          if (abort.signal.aborted) break;
          try {
            const data = await readEntityShard(source, year, prefix, abort.signal);
            setAmounts(previous => ({ ...previous, ...Object.fromEntries(Object.values(data).map(e => [e.id, initialEnactedAmount(e.events)])) }));
          } catch { if (!abort.signal.aborted) setAmountError(true); }
        }
        if (!abort.signal.aborted) setAmountsLoading(false);
      })();
    }
    return () => abort.abort();
  }, [index, year, source, retry]);
  const organizationOptions = useMemo(() => [...new Set(index?.entities.flatMap(organizationNames) ?? [])].sort((a, b) => a.localeCompare(b, 'ja')).map(name => ({ value: name, label: name })), [index]);
  const amountRange = useMemo(() => parseAmountRange(minAmount, maxAmount), [minAmount, maxAmount]);
  const filtered = useMemo(() => filterAmountRange(filterEntities(index?.entities ?? [], account, query, mode, organizations, regex), amounts, amountRange), [index, account, query, mode, organizations, regex, amounts, amountRange]);
  const sorted = useMemo(() => sortEntities(filtered, amounts, sort), [filtered, amounts, sort]);
  const resetFilters = () => { setAccount([]); setOrganizations([]); setQuery(''); setRegex(false); setMode('all'); setMinAmount(''); setMaxAmount(''); };

  const current = filtered.find(e => e.id === selected) ?? filtered[0];
  const entityId = current?.id ?? '';
  useEffect(() => {
    const abort = new AbortController();
    setDetail(null); setActiveEvent(0); setEvidencePage(0);
    if (!entityId) return () => abort.abort();
    setError('');
    readEntityShard(source, year, source === 'v2' ? v2ShardOf(entityId) : entityId[0], abort.signal).then(data => {
      if (!data[entityId]) throw new Error('選択した項のデータがありません。');
      setDetail(data[entityId]);
    }).catch(e => { if (!abort.signal.aborted) setError(String(e.message)); });
    return () => abort.abort();
  }, [entityId, year, source, retry]);
  const events = useMemo(() => orderedEvents(detail?.events ?? []), [detail]);
  const event = events[activeEvent];
  const rawById = useMemo(() => new Map(detail?.records.map(r => [r.recordId, r]) ?? []), [detail]);
  const sourceYears = [...new Set(detail?.links.map(l => l.sourceYear) ?? [])].sort();
  const chooseRelated = (id: string) => {
    resetFilters(); setSelected(id);
  };
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>MARUMIE / PIPELINE V2</div><h1>Budget Flow <span>予算の変化を、原典から。</span></h1></div>
      <Link className={styles.link} href="/integrated-sankey?year=2025">現行 Integrated（MOF2024 / RS2025）↗</Link>
    </header>
    <p className={styles.note}>金額は円。残高・増減・支出を区別して表示します。並びは予算の段階順で、実施日の時系列ではありません。移替先の特定・名称変更をまたぐ統合は未解決です。</p>
    {error && <div className={styles.error} role="alert">{error} <button onClick={() => { setError(''); setRetry(n => n + 1); }}>再読み込み</button></div>}
    {!index && !error && <p role="status">実データを読み込み中…</p>}
    <PaneLayout filters={<section className={styles.controls} aria-label="表示条件"><div className={styles.filterTitle}><h2>フィルタ</h2><button onClick={resetFilters}>リセット</button></div>
      <label>データソース<select aria-label="データソース" value={source} onChange={e => setSource(e.target.value as DataSource)}><option value="v2">Pipeline V2（public/data/v2）</option><option value="v1">V1（旧budget-flow-v2）</option></select></label>
      <label>予算年度 · fiscalYear<select aria-label="予算年度 · fiscalYear" value={year} onChange={e => setYear(Number(e.target.value))}><option>2024</option><option>2025</option></select></label>
      <label>モード<select aria-label="モード" value={mode} onChange={e => setMode(e.target.value)}><option value="all">予算から決算まで</option><option value="settlement">決算のある項</option></select></label>
      <div className={styles.filterField}><span>会計</span><MultiSelect searchable={false} label="会計" options={Object.entries(accounts).map(([value, label]) => ({ value, label }))} value={account} onChange={setAccount} /></div>
      <div className={styles.filterField}><span>所管・組織</span><MultiSelect label="所管・組織" options={organizationOptions} value={organizations} onChange={setOrganizations} /></div>
      <div className={styles.filterField}><span>項名・キーワード</span><SearchInput label="項・所管を検索" value={query} onChange={setQuery} regex={regex} onRegex={setRegex} /></div>
      <fieldset className={styles.amountFilter}><legend>当初予算・成立額（円）</legend><div>
        <label>下限<input type="text" inputMode="numeric" aria-label="金額の下限（円）" placeholder="指定なし" value={minAmount} onChange={e => setMinAmount(e.target.value)} aria-invalid={!!amountRange.error} aria-describedby={amountRange.error ? 'amount-range-error' : undefined} /></label>
        <span>〜</span><label>上限<input type="text" inputMode="numeric" aria-label="金額の上限（円）" placeholder="指定なし" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} aria-invalid={!!amountRange.error} aria-describedby={amountRange.error ? 'amount-range-error' : undefined} /></label>
      </div>{amountRange.error && <p id="amount-range-error" role="alert" className={styles.searchError}>{amountRange.error}</p>}</fieldset>
      <p className={styles.muted}>条件の変更は自動で反映されます。選択なしの場合はすべて表示します。</p>
    </section>} list={
      <section className={styles.sidebar} aria-label="項一覧ペイン">
        <div className={styles.listTitle}><h2>項一覧</h2><span role="status">{filtered.length.toLocaleString()} 件 / 全 {index?.entities.length.toLocaleString() ?? 0} 件</span></div>
        <p className={styles.muted}>金額は当初予算・成立。— は該当イベントなし。列見出しで並べ替え、境界で列幅調整。</p>
        {amountsLoading && (amountRange.active || sort?.key === 'amount') && <p className={styles.muted} role="status">金額を読み込み中です。取得済みの金額から反映しています。</p>}
        {amountError && <p role="alert" className={styles.searchError}>一覧の金額を取得できませんでした。<button onClick={() => setRetry(n => n + 1)}>再読み込み</button></p>}
        <div className={styles.list}>
          <EntityTable entities={sorted} amounts={amounts} amountError={amountError} selected={entityId} onSelect={setSelected} sort={sort} onSort={key => setSort(previous => ({ key, direction: previous?.key === key && previous.direction === 'asc' ? 'desc' : 'asc' }))} />
          {index && !filtered.length && <p className={styles.empty}>該当する項はありません</p>}
        </div>
      </section>} detail={
      <section className={styles.content}>
        {!index ? <p role="status">{error ? 'データを読み込めませんでした。' : '実データを読み込み中…'}</p> : !current ? <div className={styles.empty}><h2>該当する項はありません</h2><p>{year === 2025 && mode === 'settlement' ? 'このフルデータには2025年度のMOF決算イベントがありません。' : '検索語や会計、モード、金額範囲を変更してください。'}</p><button onClick={resetFilters}>条件をリセット</button></div> : <>
          <div className={styles.entityHeader}><span className={styles.badge}>{accounts[current.accountType]}</span><span className={styles.muted}>FY {year} / 項 {current.sectionCode}</span><h2>{current.sectionName}</h2><p>{[current.ministry, current.organization, current.specialAccount, current.subAccount, current.agency].filter(Boolean).join(' / ')}</p></div>
          <nav className={styles.tabs} aria-label="詳細表示"><button aria-pressed={tab === 'events'} onClick={() => setTab('events')}>Budget Events</button><button aria-pressed={tab === 'identity'} onClick={() => setTab('identity')}>Identity / RS</button><button aria-pressed={tab === 'diff'} onClick={() => setTab('diff')}>現行モデルとの差分</button></nav>
          {!detail ? <p role="status">項のイベントを読み込み中…</p> : <>
            {tab === 'events' && <>
              <div className={styles.sectionHeading}><h3>Budget Event タイムライン</h3><span>MOF sourceYear {detail.sourceYear} → fiscalYear {detail.fiscalYear}</span></div>
              <div className={styles.timeline}>{events.map((e, i) => <button key={`${e.eventType}-${e.budgetStatus}-${e.revision}`} aria-pressed={i === activeEvent} className={`${styles.event} ${i === activeEvent ? styles.activeEvent : ''}`} onClick={() => { setActiveEvent(i); setEvidencePage(0); }}>
                <span className={styles.dot} /><span><strong>{eventLabel(e)}</strong><small>{isAdjustment(e.eventType) ? '増減' : ['spent', 'carryover_out', 'unused'].includes(e.eventType) ? '決算内訳' : '残高'} · {e.evidence.length} 件の原典イベント</small></span><b>{isAdjustment(e.eventType) && e.amountYen > 0 ? '+' : ''}{yen(e.amountYen)}</b>
              </button>)}</div>
              {event && <section className={styles.evidence} aria-label="Evidence / 原典"><div className={styles.sectionHeading}><h3>Evidence / 原典</h3><span>{eventLabel(event)}</span></div><p className={styles.muted}>項の金額は下記の目別イベントの合計です。0円のレコードも保持しています。出典ZIPの識別情報は原データのmanifestに基づきます。</p>
                {event.evidence.slice(evidencePage * 20, (evidencePage + 1) * 20).map(ev => <details key={ev.eventId}><summary><span>{ev.itemName}</span><b>{yen(ev.amountYen)}</b></summary><p className={styles.code}>Budget Event: {ev.eventId}</p>{ev.sourceRecordIds.map(id => {
                  const raw = rawById.get(id);
                  if (!raw) return <p key={id}>原典参照が見つかりません: {id}</p>;
                  return <div key={id} className={styles.raw}><p className={styles.code}>raw record: {id}<br />raw item identity: {raw.itemNaturalKey}</p><p>{raw.phase} / {raw.budgetStatus} / {raw.sourceAmountColumn || '算出イベント（参照原典を比較）'}</p><p className={styles.code}>{raw.source.path}<br />{raw.source.zipEntry} · 行 {raw.source.rowNumber}</p><p className={styles.code}>SHA-256: {detail.sources[raw.source.path]?.sha256}</p></div>;
                })}</details>)}
                {event.evidence.length > 20 && <div className={styles.pagination}><button disabled={evidencePage === 0} onClick={() => setEvidencePage(n => n - 1)}>前の20件</button><span>{evidencePage + 1} / {Math.ceil(event.evidence.length / 20)}</span><button disabled={(evidencePage + 1) * 20 >= event.evidence.length} onClick={() => setEvidencePage(n => n + 1)}>次の20件</button></div>}
              </section>}
            </>}
            {tab === 'identity' && <section className={styles.panel}><h3>Budget Entity / raw identity</h3><p>canonical entityは年度内の完全一致で作成しています。名称やコードが変わる項の自動統合、年度をまたぐ同一性は確定していません。</p><p className={styles.code}>canonical ID: {detail.id}<br />method: {detail.identityMethod}</p>{detail.rawKeys.map(k => <p className={styles.code} key={k}>raw section identity: {k}</p>)}<h3>原データにある同一性の関係</h3>{detail.relations.length === 0 ? <p>この項に表示対象のコード変更・項間関係はありません。</p> : detail.relations.map(r => <details key={r.relationId}><summary>{r.relationType} · {r.evidenceMethod}</summary><p className={styles.code}>{r.relationId}<br />{r.sourceRecordIds.join(', ')} → {r.targetRecordIds.join(', ')}</p>{r.entityIds.filter(id => id !== detail.id).map(id => <button key={id} onClick={() => chooseRelated(id)}>関連項: {index.entities.find(e => e.id === id)?.sectionName} / {index.entities.find(e => e.id === id)?.sectionCode}</button>)}</details>)}<h3>RSとの対応 · sourceYearを分離</h3><p>完全名称一致による候補です。同一事業との確定や支出額の一致を意味しません。異なる提出年度は合算しません。</p>{sourceYears.length === 0 && <p>この項に対応するRSリンクはありません。</p>}{sourceYears.map(sy => {
              const links = detail.links.filter(l => l.sourceYear === sy);
              return <details key={sy}><summary>sourceYear {sy} → fiscalYear {year} · {new Set(links.flatMap(l => l.projectIds)).size} 事業 / {links.length} リンク</summary>{links.map(l => <p className={styles.code} key={l.linkId}>{l.linkId} / {l.matchMethod} / {l.phase}<br />事業ID: {l.projectIds.join(', ')}{l.spansEntities && '（複数項にまたがるリンク）'}</p>)}</details>;
            })}</section>}
            {tab === 'diff' && <section className={styles.panel}><h3>現行モデルとの金額比較</h3><p>現行V1のMOF公開データ（Integratedと共通の原データから生成）と、会計・所管・組織・勘定・コード・名称の完全一致で比較します。当初は成立額、決算は歳出予算額同士を比較し、項構成が異なる場合は未比較とします。</p>{source === 'v2' ? <p className={styles.muted}>データソースがPipeline V2のため、この比較はV1データソースを選択した場合のみ計算されます。</p> : <p className={styles.code}>{index.v1File}<br />SHA-256: {index.v1Sha256}</p>}{detail.comparisons.length === 0 ? <p>同じ範囲・金額種別で比較可能なV1レコードはありません。</p> : <div className={styles.tableWrap}><table><thead><tr><th>金額種別</th><th>現行 V1</th><th>Budget Flow V2</th><th>差額 V2 − V1</th></tr></thead><tbody>{detail.comparisons.map(c => <tr key={c.v1Id}><th>{c.budgetType}</th><td>{yen(c.v1Amount)}</td><td>{yen(c.v2Amount)}</td><td>{yen(c.differenceYen)}</td></tr>)}</tbody></table></div>}<h3>モデル上の違い</h3><p>V2では元レコード・識別情報・金額イベントを分離します。同じ項コードの異なる項名は保持し、当初・補正・決算の残高を足し合わせません。移替は純増減のみを示し、相手先は推測しません。</p></section>}
          </>}
        </>}
      </section>
    } />
    {index && <footer className={styles.footer}>{source === 'v2' ? 'Pipeline V2（public/data/v2/mof）' : '独立参照フルデータ'} · {index.recordCount.toLocaleString()} 原典レコード / {index.eventCount.toLocaleString()} Budget Events · 決算式検算 {index.settlementChecks.toLocaleString()} 項{source === 'v1' && <><br /><span className={styles.code}>ZIP SHA-256: {index.archiveSha256}</span></>}</footer>}
  </main>;
}
