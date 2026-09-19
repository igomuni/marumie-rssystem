'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { accounts, eventLabel, filterEntities, isAdjustment, orderedEvents, yen, type EntityDetail, type Index } from './model';
import styles from './page.module.css';

async function readData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`データを取得できません（${response.status}）。表示用データを再生成してください。`);
  if (!response.body || typeof DecompressionStream === 'undefined') throw new Error('このブラウザは圧縮データの読み込みに対応していません。最新版のブラウザで開いてください。');
  const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  signal.throwIfAborted();
  return data;
}

export default function BudgetFlow() {
  const [year, setYear] = useState(2024);
  const [mode, setMode] = useState('all');
  const [account, setAccount] = useState('general');
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
    readData<Index>(`/budget-flow-v2/${year}.json.gz`, abort.signal).then(setIndex).catch(e => {
      if (!abort.signal.aborted) setError(String(e.message));
    });
    return () => abort.abort();
  }, [year, retry]);
  const filtered = useMemo(() => filterEntities(index?.entities ?? [], account, query, mode), [index, account, query, mode]);
  const current = filtered.find(e => e.id === selected) ?? filtered[0];
  const entityId = current?.id ?? '';
  useEffect(() => {
    const abort = new AbortController();
    setDetail(null); setActiveEvent(0); setEvidencePage(0);
    if (!entityId) return () => abort.abort();
    readData<Record<string, EntityDetail>>(`/budget-flow-v2/${year}/${entityId[0]}.json.gz`, abort.signal).then(data => {
      if (!data[entityId]) throw new Error('選択した項のデータがありません。');
      setDetail(data[entityId]);
    }).catch(e => { if (!abort.signal.aborted) setError(String(e.message)); });
    return () => abort.abort();
  }, [entityId, year, retry]);
  const events = useMemo(() => orderedEvents(detail?.events ?? []), [detail]);
  const event = events[activeEvent];
  const rawById = useMemo(() => new Map(detail?.records.map(r => [r.recordId, r]) ?? []), [detail]);
  const sourceYears = [...new Set(detail?.links.map(l => l.sourceYear) ?? [])].sort();
  const chooseRelated = (id: string) => {
    setAccount(''); setQuery(''); setMode('all'); setSelected(id);
  };
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>MARUMIE / PIPELINE V2</div><h1>Budget Flow <span>予算の変化を、原典から。</span></h1></div>
      <Link className={styles.link} href="/integrated-sankey?year=2025">現行 Integrated（MOF2024 / RS2025）↗</Link>
    </header>
    <section className={styles.controls} aria-label="表示条件">
      <label>予算年度 · fiscalYear<select aria-label="予算年度 · fiscalYear" value={year} onChange={e => setYear(Number(e.target.value))}><option>2024</option><option>2025</option></select></label>
      <label>モード<select aria-label="モード" value={mode} onChange={e => setMode(e.target.value)}><option value="all">予算から決算まで</option><option value="settlement">決算のある項</option></select></label>
      <label>会計<select aria-label="会計" value={account} onChange={e => setAccount(e.target.value)}><option value="">すべての会計</option>{Object.entries(accounts).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className={styles.search}>項・所管を検索<input type="search" placeholder="例：科学技術、復興、デジタル庁" value={query} onChange={e => setQuery(e.target.value)} /></label>
    </section>
    <p className={styles.note}>金額は円。残高・増減・支出を区別して表示します。並びは予算の段階順で、実施日の時系列ではありません。移替先の特定・名称変更をまたぐ統合は未解決です。</p>
    {error && <div className={styles.error} role="alert">{error} <button onClick={() => { setError(''); setRetry(n => n + 1); }}>再読み込み</button></div>}
    {!index && !error && <p role="status">実データを読み込み中…</p>}
    {index && <div className={styles.workspace}>
      <aside className={styles.sidebar}>
        <div className={styles.listTitle}><h2>項一覧</h2><span>{filtered.length.toLocaleString()} 件</span></div>
        <p className={styles.muted}>会計・所管・組織・勘定・項コード・項名を保持</p>
        <div className={styles.list} aria-label="項一覧">
          {filtered.map(e => <button key={e.id} aria-pressed={e.id === entityId} className={e.id === entityId ? styles.selected : ''} onClick={() => setSelected(e.id)}>
            <span>{e.sectionName}</span><small>{e.ministry || e.agency} / {e.organization || e.specialAccount} {e.subAccount}</small><small>項 {e.sectionCode} · {e.eventCount} events{e.relationCount > 0 ? ' · 関係あり' : ''}</small>
          </button>)}
        </div>
      </aside>
      <section className={styles.content}>
        {!current ? <div className={styles.empty}><h2>該当する項はありません</h2><p>{year === 2025 && mode === 'settlement' ? 'このフルデータには2025年度のMOF決算イベントがありません。' : '検索語や会計、モードを変更してください。'}</p><button onClick={() => { setQuery(''); setAccount(''); setMode('all'); }}>条件をリセット</button></div> : <>
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
            {tab === 'diff' && <section className={styles.panel}><h3>現行モデルとの金額比較</h3><p>現行V1のMOF公開データ（Integratedと共通の原データから生成）と、会計・所管・組織・勘定・コード・名称の完全一致で比較します。当初は成立額、決算は歳出予算額同士を比較し、項構成が異なる場合は未比較とします。</p><p className={styles.code}>{index.v1File}<br />SHA-256: {index.v1Sha256}</p>{detail.comparisons.length === 0 ? <p>同じ範囲・金額種別で比較可能なV1レコードはありません。</p> : <div className={styles.tableWrap}><table><thead><tr><th>金額種別</th><th>現行 V1</th><th>Budget Flow V2</th><th>差額 V2 − V1</th></tr></thead><tbody>{detail.comparisons.map(c => <tr key={c.v1Id}><th>{c.budgetType}</th><td>{yen(c.v1Amount)}</td><td>{yen(c.v2Amount)}</td><td>{yen(c.differenceYen)}</td></tr>)}</tbody></table></div>}<h3>モデル上の違い</h3><p>V2では元レコード・識別情報・金額イベントを分離します。同じ項コードの異なる項名は保持し、当初・補正・決算の残高を足し合わせません。移替は純増減のみを示し、相手先は推測しません。</p></section>}
          </>}
        </>}
      </section>
    </div>}
    {index && <footer className={styles.footer}>独立参照フルデータ · {index.recordCount.toLocaleString()} 原典レコード / {index.eventCount.toLocaleString()} Budget Events · 決算式検算 {index.settlementChecks.toLocaleString()} 項<br /><span className={styles.code}>ZIP SHA-256: {index.archiveSha256}</span></footer>}
  </main>;
}
