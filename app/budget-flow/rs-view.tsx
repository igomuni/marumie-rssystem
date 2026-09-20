'use client';

import { useEffect, useMemo, useState } from 'react';
import { MultiSelect, PaneLayout, SearchInput } from './controls';
import { readData } from './data';
import { accounts, parseAmountRange, yen } from './model';
import { filterProjects, selectProject, sortProjects, phaseNames, type MofTarget, type RsDetail, type RsIndex, type RsSort, type RsTarget } from './rs-model';
import { RsTable } from './rs-table';
import styles from './page.module.css';

export function RsView({ target, onMof }: { target: RsTarget | null; onMof: (target: MofTarget) => void }) {
  const [reviewYear, setReviewYear] = useState(target?.reviewYear ?? 2025);
  const [fiscalYear, setFiscalYear] = useState(target?.fiscalYear ?? 2024);
  const [reviewYears, setReviewYears] = useState<number[]>([]);
  const [index, setIndex] = useState<RsIndex | null>(null);
  const [detail, setDetail] = useState<RsDetail | null>(null);
  const [selected, setSelected] = useState('');
  const [account, setAccount] = useState<string[]>([]);
  const [organizations, setOrganizations] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [connection, setConnection] = useState('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sort, setSort] = useState<RsSort | null>(null);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [retry, setRetry] = useState(0);
  const resetFilters = () => { setAccount([]); setOrganizations([]); setQuery(''); setRegex(false); setConnection('all'); setMinAmount(''); setMaxAmount(''); };
  useEffect(() => {
    if (target) {
      setReviewYear(target.reviewYear); setFiscalYear(target.fiscalYear);
      setSelected(`${target.reviewYear}:${target.projectId}`); resetFilters();
    }
  }, [target]);
  useEffect(() => {
    const abort = new AbortController();
    setIndex(null); setError('');
    Promise.all([
      readData<{ reviewYears: number[] }>('/budget-flow-v2/rs/manifest.json.gz', abort.signal),
      readData<RsIndex>(`/budget-flow-v2/rs/${reviewYear}.json.gz`, abort.signal),
    ]).then(([manifest, data]) => {
      setReviewYears(manifest.reviewYears); setIndex(data);
      setFiscalYear(current => data.fiscalYears.includes(current) ? current : data.fiscalYears[data.fiscalYears.length - 1]);
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [reviewYear, retry]);
  const activeIndex = index?.reviewYear === reviewYear ? index : null;
  const filtered = useMemo(() => filterProjects(activeIndex?.projects ?? [], { fiscalYear, accounts: account, organizations, query, regex, connection, minAmount, maxAmount }), [activeIndex, fiscalYear, account, organizations, query, regex, connection, minAmount, maxAmount]);
  const sorted = useMemo(() => sortProjects(filtered, fiscalYear, sort), [filtered, fiscalYear, sort]);
  const current = selectProject(filtered, selected);
  const id = current?.id, shard = current?.shard;
  useEffect(() => {
    const abort = new AbortController();
    setDetail(null); setDetailError('');
    if (id && shard) readData<Record<string, RsDetail>>(`/budget-flow-v2/rs/${reviewYear}/${shard}.json.gz`, abort.signal).then(data => {
      if (!data[id]) throw new Error('選択したRS事業のデータがありません。');
      setDetail(data[id]);
    }).catch(e => { if (!abort.signal.aborted) setDetailError(e.message); });
    return () => abort.abort();
  }, [id, shard, reviewYear, retry]);
  const organizationOptions = useMemo(() => [...new Set(activeIndex?.projects.flatMap(p => p.organizations) ?? [])].sort((a,b) => a.localeCompare(b,'ja')).map(value => ({ value, label: value })), [activeIndex]);
  const amountRange = parseAmountRange(minAmount, maxAmount);
  const covered = activeIndex?.linkFiscalYears.includes(fiscalYear) ?? false;
  const activeDetail = detail?.id === id ? detail : null;
  const budget = activeDetail?.budgets.find(b => b.fiscalYear === fiscalYear);
  const links = activeDetail?.links.filter(l => l.fiscalYear === fiscalYear) ?? [];
  const entities = [...new Map(links.flatMap(l => l.entities).map(e => [e.id, e])).values()];
  const reload = () => setRetry(n => n+1);
  return <>
    <p className={styles.note}>RS年度はレビューのスナップショットです。表示金額の予算年度とは異なります。年度を選んでも、金額・MOFリンクのない事業を一覧から除外しません。</p>
    {error && <div role="alert" className={styles.error}>{error} <button onClick={reload}>RSデータを再読み込み</button></div>}
    <PaneLayout listName="RS事業一覧" filters={<section className={styles.controls} aria-label="RS表示条件">
      <div className={styles.filterTitle}><h2>フィルタ</h2><button onClick={resetFilters}>リセット</button></div>
      <label>RSレビュー年度<select aria-label="RSレビュー年度" value={reviewYear} onChange={e => { setReviewYear(Number(e.target.value)); setSelected(''); }}>{(reviewYears.length ? reviewYears : [reviewYear]).map(y => <option key={y} value={y}>{y} レビュー</option>)}</select></label>
      <label>表示金額・接続の予算年度<select aria-label="表示金額・接続の予算年度" value={fiscalYear} onChange={e => setFiscalYear(Number(e.target.value))}>{(activeIndex?.fiscalYears ?? [fiscalYear]).map(y => <option key={y} value={y}>FY {y}</option>)}</select></label>
      <label>MOFとの接続<select aria-label="MOFとの接続" value={connection} onChange={e => setConnection(e.target.value)}><option value="all">すべて</option><option value="linked">接続あり</option><option value="unlinked">接続なし（照合データなしを含む）</option></select></label>
      <div className={styles.filterField}><span>会計（選択した予算年度）</span><MultiSelect searchable={false} label="RS会計" options={Object.entries(accounts).map(([value,label]) => ({value,label}))} value={account} onChange={setAccount} /></div>
      <div className={styles.filterField}><span>府省庁・局庁</span><MultiSelect label="府省庁・局庁" options={organizationOptions} value={organizations} onChange={setOrganizations} /></div>
      <div className={styles.filterField}><span>事業名・ID・キーワード</span><SearchInput label="RS事業を検索" value={query} onChange={setQuery} regex={regex} onRegex={setRegex} /></div>
      <fieldset className={styles.amountFilter}><legend>当初予算額（円）· FY {fiscalYear}</legend><div><label>下限<input type="text" inputMode="numeric" aria-label="RS金額の下限（円）" value={minAmount} placeholder="指定なし" onChange={e => setMinAmount(e.target.value)} aria-invalid={!!amountRange.error} /></label><span>〜</span><label>上限<input type="text" inputMode="numeric" aria-label="RS金額の上限（円）" value={maxAmount} placeholder="指定なし" onChange={e => setMaxAmount(e.target.value)} aria-invalid={!!amountRange.error} /></label></div>{amountRange.error && <p role="alert" className={styles.searchError}>{amountRange.error}</p>}</fieldset>
      <p className={styles.muted}>条件の変更は自動で反映されます。選択なしの場合はすべて表示します。会計は歳出予算科目に基づきます。</p>
    </section>} list={<section className={styles.sidebar} aria-label="RS事業一覧ペイン">
      <div className={styles.listTitle}><h2>RS事業一覧</h2><span role="status">{filtered.length.toLocaleString()} 件 / 全 {activeIndex?.projects.length.toLocaleString() ?? 0} 件</span></div>
      <p className={styles.muted}>レビュー {reviewYear} / FY {fiscalYear} 当初予算。— は金額なし。{!covered && 'この年度のMOF照合データはありません。'}</p>
      <div className={styles.list}><RsTable entities={sorted} fiscalYear={fiscalYear} covered={covered} selected={id ?? ''} onSelect={setSelected} sort={sort} onSort={key => setSort(previous => ({ key, direction: previous?.key === key && previous.direction === 'asc' ? 'desc' : 'asc' }))} />{activeIndex && !filtered.length && <p className={styles.empty}>該当するRS事業はありません</p>}</div>
    </section>} detail={<section className={styles.content} aria-label="RS事業詳細">
      {!activeIndex ? <p role="status">{error ? 'RSデータを読み込めませんでした。' : 'RS全事業を読み込み中…'}</p> : !current ? <div className={styles.empty}><h2>該当するRS事業はありません</h2><button onClick={resetFilters}>条件をリセット</button></div> : <>
        <div className={styles.entityHeader}><span className={styles.badge}>RS レビュー {reviewYear}</span><span className={styles.muted}>事業ID {current.projectId}</span><h2>{current.projectName}</h2><p>{current.organizations.join(' / ')}</p></div>
        {detailError ? <p role="alert" className={styles.error}>{detailError} <button onClick={reload}>RS詳細を再読み込み</button></p> : !activeDetail ? <p role="status">事業詳細を読み込み中…</p> : <div className={styles.panel}>
          <h3>予算・執行 · FY {fiscalYear}</h3><p className={styles.muted}>事業合計のみを表示し、会計別内訳は加算しません。0円と欠損（—）を区別します。翌年度要求は列内のFYが対象です。</p>
          <dl className={styles.rsBudgetTotals}>{[
            ['当初予算', budget?.initialBudgetYen], ['予算現額', budget?.currentBudgetYen],
            ['執行額', budget?.executionYen], [`翌年度要求${budget?.requestFiscalYear ? ` · FY ${budget.requestFiscalYear}` : ''}`, budget?.nextYearRequestYen],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === 'number' ? yen(value) : '—'}</dd></div>)}</dl>
          <details><summary>全予算年度の金額（レビュー {reviewYear} 時点）</summary><div className={styles.tableWrap}><table aria-label="RS予算・執行"><thead><tr><th>予算年度</th><th>当初予算</th><th>予算現額</th><th>執行額</th><th>翌年度要求</th></tr></thead><tbody>{activeDetail.budgets.map(b => <tr key={b.fiscalYear} className={b.fiscalYear === fiscalYear ? styles.selected : ''}><th>FY {b.fiscalYear}</th>{[b.initialBudgetYen,b.currentBudgetYen,b.executionYen].map((value,i) => <td key={i}>{value === null ? '—' : yen(value)}</td>)}<td>{b.nextYearRequestYen === null ? '—' : <>{yen(b.nextYearRequestYen)}<br />FY {b.requestFiscalYear}</>}</td></tr>)}</tbody></table></div></details>
          {!activeDetail.budgets.length && <p>予算・執行サマリはありません。</p>}
          <h3>対応するMOFの項 · FY {fiscalYear}</h3><p>名称完全一致による候補です。同一事業や金額一致を確定するものではありません。リンクの金額を事業への配分額とは扱いません。</p>
          {!entities.length && <p>{covered ? '選択した予算年度にMOF接続はありません。' : '選択した予算年度のMOF照合データはありません。未対応とは断定できません。'}</p>}
          {entities.map(entity => <div key={entity.id} className={styles.rsLink}><button onClick={() => onMof({ fiscalYear: entity.fiscalYear, id: entity.id })}>{entity.sectionName} →</button><small>{accounts[entity.accountType]} · {[entity.ministry,entity.organization,entity.specialAccount,entity.subAccount,entity.agency].filter(Boolean).join(' / ')} · 項 {entity.sectionCode}</small><small>{[...new Set(links.filter(l => l.entities.some(e => e.id === entity.id)).map(l => `${phaseNames[l.phase] ?? l.phase}${l.revision === null ? '' : ` 第${l.revision}号`} / ${l.matchMethod}`))].join('、')}</small></div>)}
          {!!links.length && <details><summary>MOF接続の根拠 · {links.length} リンク</summary>{links.map(l => <p className={styles.code} key={l.linkId}>{l.linkId} · {l.phase} / {l.matchMethod}<br />RS: {l.rsRecordIds.join(', ')}<br />MOF: {l.mofRecordIds.join(', ')}</p>)}</details>}
          <h3>事業情報・原典</h3><p>参照ZIPの事業データは組織情報（1-1）です。事業概要・目的（1-2）は収録されていません。</p>
          <details><summary>組織情報 · {activeDetail.organizationRows.length} 行</summary>{activeDetail.organizationRows.map(r => <div className={styles.raw} key={r.recordId}><p>{[r.ministry,r.bureau,r.department,r.division,r.office].filter(Boolean).join(' / ')}</p><p className={styles.code}>{r.recordId}<br />{r.source.path}<br />{r.source.zipEntry} · 行 {r.source.rowNumber}<br />SHA-256: {activeDetail.sources[r.source.path]?.sha256}</p></div>)}</details>
          <details><summary>予算・執行の原典</summary>{activeDetail.budgets.map(b => <div key={b.fiscalYear}><strong>FY {b.fiscalYear}</strong>{b.evidence.map(e => <p className={styles.code} key={e.recordId}>{e.recordId}<br />{e.source.path}<br />{e.source.zipEntry} · 行 {e.source.rowNumber}<br />SHA-256: {activeDetail.sources[e.source.path]?.sha256}</p>)}</div>)}</details>
        </div>}
      </>}
    </section>} />
    {activeIndex && <footer className={styles.footer}>RS レビュー {reviewYear} · 全 {activeIndex.projects.length.toLocaleString()} 事業（MOF未接続を含む）<br /><span className={styles.code}>ZIP SHA-256: {activeIndex.archiveSha256}</span></footer>}
  </>;
}
