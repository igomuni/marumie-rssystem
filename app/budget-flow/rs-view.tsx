'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';
import { PaneLayout, SearchInput, MultiSelect } from './controls';
import { parseAmountRange, yen } from './model';
import {
  filterRsProjects, filterRsAmountRange, sortRsProjects, rsOrganizationNames,
  type RsProjectSummary, type RsProjectDetail, type RsProjectSort,
} from './rs-model';
import { fetchRsIndex, fetchRsProjectCore, type V2RsManifest } from './rs-source';
import { FundingSankey } from './funding-sankey';
import { RsProjectTable } from './rs-project-table';

export function RsProjectsView() {
  const [year, setYear] = useState(2025);
  const [projects, setProjects] = useState<RsProjectSummary[] | null>(null);
  const [manifest, setManifest] = useState<V2RsManifest | null>(null);
  const [query, setQuery] = useState('');
  const [organizations, setOrganizations] = useState<string[]>([]);
  const [mode, setMode] = useState('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sort, setSort] = useState<RsProjectSort | null>(null);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<RsProjectDetail | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setProjects(null); setManifest(null); setSelected(''); setDetail(null); setError('');
    fetchRsIndex(year, abort.signal).then(({ projects: p, manifest: m }) => { setProjects(p); setManifest(m); })
      .catch(e => { if (!abort.signal.aborted) setError(String(e.message)); });
    return () => abort.abort();
  }, [year, retry]);

  const organizationOptions = useMemo(() => [...new Set(projects?.flatMap(rsOrganizationNames) ?? [])].sort((a, b) => a.localeCompare(b, 'ja')).map(name => ({ value: name, label: name })), [projects]);
  const amountRange = useMemo(() => parseAmountRange(minAmount, maxAmount), [minAmount, maxAmount]);
  const filtered = useMemo(() => filterRsAmountRange(filterRsProjects(projects ?? [], query, organizations, mode), amountRange), [projects, query, organizations, mode, amountRange]);
  const sorted = useMemo(() => sortRsProjects(filtered, sort), [filtered, sort]);
  const resetFilters = () => { setQuery(''); setOrganizations([]); setMode('all'); setMinAmount(''); setMaxAmount(''); };
  const current = sorted.find(p => p.projectId === selected) ?? sorted[0];

  useEffect(() => {
    const abort = new AbortController();
    setDetail(null);
    if (!current) return () => abort.abort();
    fetchRsProjectCore(year, current.shard, abort.signal).then(data => {
      if (!data[current.projectId]) throw new Error('選択した事業のデータがありません。');
      setDetail(data[current.projectId]);
    }).catch(e => { if (!abort.signal.aborted) setError(String(e.message)); });
    return () => abort.abort();
  }, [current, year, retry]);

  return <>
    {error && <div className={styles.error} role="alert">{error} <button onClick={() => { setError(''); setRetry(n => n + 1); }}>再読み込み</button></div>}
    {!projects && !error && <p role="status">実データを読み込み中…</p>}
    {manifest?.completeness === 'partial' && <div className={styles.note} role="status">
      ⚠ {year}年度は部分公開データです（review-sheets中心）。支出構造・Funding Graphは未収録のため0件を「無い」ではなく「未取得」として扱ってください。
      {!manifest.sourceAvailability.spending && <> 支出データ: 未取得。</>}
      {!manifest.sourceAvailability.fundingGraph && <> Funding Graph: 未取得。</>}
    </div>}
    <PaneLayout filters={<section className={styles.controls} aria-label="表示条件"><div className={styles.filterTitle}><h2>フィルタ</h2><button onClick={resetFilters}>リセット</button></div>
      <label>レビュー年度<select aria-label="レビュー年度" value={year} onChange={e => setYear(Number(e.target.value))}><option>2024</option><option>2025</option><option>2026</option></select></label>
      <label>表示条件<select aria-label="表示条件" value={mode} onChange={e => setMode(e.target.value)}>
        <option value="all">すべて</option>
        <option value="cycle">循環があるもの</option>
        <option value="mofLink">MOF項とリンクがあるもの</option>
        <option value="duplicate">重複関係があるもの</option>
      </select></label>
      <div className={styles.filterField}><span>府省庁・局</span><MultiSelect label="府省庁・局" options={organizationOptions} value={organizations} onChange={setOrganizations} /></div>
      <div className={styles.filterField}><span>事業名・IDで検索</span><SearchInput label="事業名・IDで検索" value={query} onChange={setQuery} regex={false} onRegex={() => {}} /></div>
      <fieldset className={styles.amountFilter}><legend>予算現額（円）</legend><div>
        <label>下限<input type="text" inputMode="numeric" aria-label="金額の下限（円）" placeholder="指定なし" value={minAmount} onChange={e => setMinAmount(e.target.value)} /></label>
        <span>〜</span><label>上限<input type="text" inputMode="numeric" aria-label="金額の上限（円）" placeholder="指定なし" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} /></label>
      </div>{amountRange.error && <p role="alert" className={styles.searchError}>{amountRange.error}</p>}</fieldset>
    </section>} list={
      <section className={styles.sidebar} aria-label="事業一覧ペイン">
        <div className={styles.listTitle}><h2>事業一覧</h2><span role="status">{filtered.length.toLocaleString()} 件 / 全 {projects?.length.toLocaleString() ?? 0} 件</span></div>
        <div className={styles.list}>
          <RsProjectTable projects={sorted} selected={current?.projectId ?? ''} onSelect={setSelected} sort={sort} onSort={key => setSort(previous => ({ key, direction: previous?.key === key && previous.direction === 'asc' ? 'desc' : 'asc' }))} />
          {projects && !filtered.length && <p className={styles.empty}>該当する事業はありません</p>}
        </div>
      </section>} detail={
      <section className={styles.content}>
        {!projects ? <p role="status">{error ? 'データを読み込めませんでした。' : '実データを読み込み中…'}</p> : !current ? <div className={styles.empty}><h2>該当する事業はありません</h2><button onClick={resetFilters}>条件をリセット</button></div> : <>
          <div className={styles.entityHeader}>
            <span className={styles.muted}>review-{year} / 事業ID {current.projectId}</span>
            <h2>{current.projectName}</h2>
            <p>{[current.ministry, current.bureau].filter(Boolean).join(' / ')}{current.officialProjectUrl && <> · <a href={current.officialProjectUrl} target="_blank" rel="noreferrer">公式事業ページ↗</a></>}</p>
          </div>
          {!detail ? <p role="status">事業の詳細を読み込み中…</p> : <>
            <section className={styles.panel}>
              <h3>予算</h3>
              <p>当初: {current.budgetInitialYen != null ? yen(current.budgetInitialYen) : '不明'} / 補正: {current.budgetSupplementsYen != null ? yen(current.budgetSupplementsYen) : '—'} / 現額: {current.budgetTotalYen != null ? yen(current.budgetTotalYen) : '不明'}</p>
              {detail.project.purpose && <p>{String(detail.project.purpose)}</p>}
            </section>
            <section className={styles.panel}>
              <h3>MOF項とのリンク</h3>
              {!detail.mofLinks?.length ? <p>この事業に対応するMOF項リンクはありません。</p> : <>
                <p className={styles.muted}>完全名称一致による候補です。1件のlinkが複数事業にまたがる場合、金額はその事業だけの専有額ではなく、束ねられた全事業の合計額です。</p>
                {detail.mofLinks.map(l => <p key={l.linkId} className={styles.code}>
                  {l.linkId} / fy{l.fiscalYear} / {l.phase}<br />
                  MOF {yen(l.mofAmountYen)} ↔ RS {yen(l.rsAmountYen)}（差額 {yen(l.differenceYen)}）
                  {l.projectCount > 1 && <><br /><strong>⚠ この金額は{l.projectCount}事業（{l.projectIds.join(', ')}）で束ねられた合計額です</strong></>}
                </p>)}
              </>}
            </section>
            <section className={styles.panel}>
              <h3>資金フロー（Funding Graph）</h3>
              {!detail.fundingGraph ? <p>{manifest?.sourceAvailability.fundingGraph === false ? 'この年度はFunding Graphが未取得です（部分公開データ）。' : 'この事業にFunding Graphはありません。'}</p> : <FundingSankey graph={detail.fundingGraph} />}
            </section>
          </>}
        </>}
      </section>
    } />
  </>;
}
