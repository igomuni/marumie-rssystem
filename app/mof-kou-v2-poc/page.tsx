'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatYen } from '@/client/components/mof-jikou/format';
import { MatchMethodBadge } from '@/client/components/mof-rs/MatchMethodBadge';
import {
  fetchV2MofIndex,
  fetchV2MofSection,
  fetchV2RootManifest,
  fetchV2RsIndex,
  phaseLabel,
  type V2MatchMethod,
  type V2MofIndex,
  type V2MofRsLink,
  type V2MofSectionDetail,
  type V2RootManifest,
  type V2RsProjectIndexRow,
} from '@/app/lib/v2-public-linkage';

type MethodFilter = 'all' | V2MatchMethod;

function projectLabel(project: V2RsProjectIndexRow | undefined, projectId: string): string {
  if (!project) return `事業ID ${projectId}`;
  return `${project.projectName}（${projectId}）`;
}

export default function MofKouV2PocPage() {
  const [manifest, setManifest] = useState<V2RootManifest | null>(null);
  const [year, setYear] = useState(2025);
  const [reviewYear, setReviewYear] = useState<number | null>(null);
  const [index, setIndex] = useState<V2MofIndex | null>(null);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<V2MofSectionDetail | null>(null);
  const [projects, setProjects] = useState<Map<string, V2RsProjectIndexRow>>(new Map());
  const [query, setQuery] = useState('');
  const [linkedOnly, setLinkedOnly] = useState(true);
  const [method, setMethod] = useState<MethodFilter>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    const abort = new AbortController();
    fetchV2RootManifest(abort.signal)
      .then(setManifest)
      .catch(e => { if (!abort.signal.aborted) setError(String(e.message)); });
    return () => abort.abort();
  }, []);

  const availableYears = useMemo(
    () => [...new Set(manifest?.mof.map(x => x.fiscalYear) ?? [2025])].sort((a, b) => b - a),
    [manifest]
  );

  const reviewYears = useMemo(
    () => [...new Set(manifest?.links.filter(x => x.fiscalYear === year).map(x => x.reviewYear) ?? [])].sort((a, b) => b - a),
    [manifest, year]
  );

  useEffect(() => {
    if (!reviewYears.length) {
      setReviewYear(null);
      return;
    }
    if (reviewYear === null || !reviewYears.includes(reviewYear)) setReviewYear(reviewYears[0]);
  }, [reviewYears, reviewYear]);

  useEffect(() => {
    const abort = new AbortController();
    setIndex(null);
    setSelected('');
    setDetail(null);
    setError('');
    fetchV2MofIndex(year, abort.signal)
      .then(data => {
        setIndex(data);
        const firstLinked = data.sections.find(s => (s.rsProjectCount ?? 0) > 0);
        setSelected((firstLinked ?? data.sections[0])?.id ?? '');
      })
      .catch(e => { if (!abort.signal.aborted) setError(String(e.message)); });
    return () => abort.abort();
  }, [year]);

  useEffect(() => {
    const abort = new AbortController();
    setDetail(null);
    if (!selected) return () => abort.abort();
    fetchV2MofSection(year, selected, abort.signal)
      .then(setDetail)
      .catch(e => { if (!abort.signal.aborted) setError(String(e.message)); });
    return () => abort.abort();
  }, [year, selected]);

  useEffect(() => {
    const abort = new AbortController();
    setProjects(new Map());
    if (reviewYear === null) return () => abort.abort();
    fetchV2RsIndex(reviewYear, abort.signal)
      .then(data => setProjects(new Map(data.projects.map(p => [p.projectId, p]))))
      .catch(e => { if (!abort.signal.aborted) setError(String(e.message)); });
    return () => abort.abort();
  }, [reviewYear]);

  const filteredSections = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja');
    return (index?.sections ?? []).filter(section => {
      if (linkedOnly && reviewYear !== null && !(section.rsLinkCounts?.[String(reviewYear)] ?? 0)) return false;
      if (!needle) return true;
      return [
        section.sectionCode,
        section.sectionName,
        section.ministry,
        section.organization,
        section.specialAccount,
        section.subAccount,
        section.agency,
      ].join('\n').toLocaleLowerCase('ja').includes(needle);
    });
  }, [index, linkedOnly, query, reviewYear]);

  const links = useMemo(() => {
    if (reviewYear === null) return [];
    return (detail?.rsLinks ?? [])
      .filter(link => link.reviewYear === reviewYear)
      .filter(link => method === 'all' || link.matchMethod === method);
  }, [detail, reviewYear, method]);

  const selectedRow = index?.sections.find(s => s.id === selected);
  const itemNames = useMemo(() => new Map(detail?.items.map(item => [item.id, item.name]) ?? []), [detail]);
  const linkedProjects = useMemo(() => new Set(links.flatMap(link => link.projectIds)), [links]);

  const methodCounts = useMemo(() => {
    const rows = reviewYear === null ? [] : (detail?.rsLinks ?? []).filter(link => link.reviewYear === reviewYear);
    return {
      all: rows.length,
      exact: rows.filter(x => x.matchMethod === 'exact-name-key').length,
      supplemental: rows.filter(x => x.matchMethod === 'supplemental-exact').length,
      mixed: rows.filter(x => x.matchMethod === 'mixed').length,
    };
  }, [detail, reviewYear]);

  return (
    <main className="min-h-screen bg-neutral-50 p-4 text-sm text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-emerald-700">PIPELINE V2 / UI POC</p>
            <h1 className="mt-1 text-2xl font-semibold">MOF項 × RS事業 — V2 link group</h1>
            <p className="mt-1 max-w-4xl text-xs leading-6 text-neutral-500">
              既存の /mof-kou を置き換えず、Pipeline V2 の公開成果物を直接読む検証ページです。
              P2は「低信頼」ではなく、リンク根拠の違いとして表示します。
            </p>
          </div>
          <div className="flex gap-3 text-xs">
            <Link href="/mof-kou" className="underline">現行 /mof-kou</Link>
            <Link href="/budget-flow" className="underline">Budget Flow</Link>
          </div>
        </header>

        {error && <div className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-red-700">{error}</div>}

        <section className="mb-3 grid gap-3 rounded-lg border border-neutral-200 bg-white p-3 md:grid-cols-5 dark:border-neutral-800 dark:bg-neutral-900">
          <label className="text-xs">
            <span className="mb-1 block text-neutral-500">予算年度</span>
            <select className="w-full rounded border p-2 dark:bg-neutral-950" value={year} onChange={e => setYear(Number(e.target.value))}>
              {availableYears.map(y => <option key={y}>{y}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-neutral-500">RS review年度</span>
            <select
              className="w-full rounded border p-2 dark:bg-neutral-950"
              value={reviewYear ?? ''}
              onChange={e => setReviewYear(Number(e.target.value))}
              disabled={!reviewYears.length}
            >
              {reviewYears.map(y => <option key={y}>{y}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-neutral-500">リンク根拠</span>
            <select className="w-full rounded border p-2 dark:bg-neutral-950" value={method} onChange={e => setMethod(e.target.value as MethodFilter)}>
              <option value="all">すべて</option>
              <option value="exact-name-key">構造化項目一致</option>
              <option value="supplemental-exact">補足情報から復元</option>
              <option value="mixed">複合</option>
            </select>
          </label>
          <label className="text-xs md:col-span-2">
            <span className="mb-1 block text-neutral-500">項名・所管を検索</span>
            <input className="w-full rounded border p-2 dark:bg-neutral-950" value={query} onChange={e => setQuery(e.target.value)} placeholder="例: デジタル / 社会保障" />
          </label>
          <label className="flex items-center gap-2 text-xs md:col-span-5">
            <input type="checkbox" checked={linkedOnly} onChange={e => setLinkedOnly(e.target.checked)} />
            選択したreview年度でRSリンクがある項だけ表示
          </label>
        </section>

        <div className="grid min-h-[680px] gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="border-b px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800">
              {filteredSections.length.toLocaleString()} 項
            </div>
            <div className="max-h-[760px] overflow-auto">
              {filteredSections.map(section => {
                const count = reviewYear === null ? 0 : section.rsLinkCounts?.[String(reviewYear)] ?? 0;
                return (
                  <button
                    key={section.id}
                    onClick={() => setSelected(section.id)}
                    className={`block w-full border-b px-3 py-3 text-left hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800 ${
                      section.id === selected ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <strong className="leading-5">{section.sectionCode} {section.sectionName}</strong>
                      <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">{count} links</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-neutral-500">
                      {[section.ministry, section.organization, section.specialAccount, section.subAccount, section.agency].filter(Boolean).join(' / ')}
                    </p>
                  </button>
                );
              })}
              {!filteredSections.length && <p className="p-5 text-neutral-400">該当する項はありません。</p>}
            </div>
          </section>

          <section className="min-w-0 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            {!selectedRow ? (
              <p className="text-neutral-400">項を選択してください。</p>
            ) : !detail ? (
              <p className="text-neutral-400">詳細を読み込み中…</p>
            ) : (
              <>
                <div className="border-b pb-4 dark:border-neutral-800">
                  <p className="text-xs text-neutral-500">FY {year} / 項 {selectedRow.sectionCode} / review-{reviewYear ?? '—'}</p>
                  <h2 className="mt-1 text-xl font-semibold">{selectedRow.sectionName}</h2>
                  <p className="mt-1 text-xs text-neutral-500">
                    {[selectedRow.ministry, selectedRow.organization, selectedRow.specialAccount, selectedRow.subAccount, selectedRow.agency].filter(Boolean).join(' / ')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-800">リンク {methodCounts.all}</span>
                    <span className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-800">事業 {linkedProjects.size}</span>
                    <span className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-800">構造化 {methodCounts.exact}</span>
                    <span className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-800">補足復元 {methodCounts.supplemental}</span>
                    <span className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-800">複合 {methodCounts.mixed}</span>
                  </div>
                </div>

                <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-6 text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                  V2ではリンク判定に金額を使って対象を選びません。
                  「補足情報から復元」は supplementalInfo から完全キーを復元したTier-1リンクです。
                  複数事業を含むlink groupのRS金額は、選択した1事業の専有額ではなくgroup全体の合計です。
                </div>

                <div className="mt-4 space-y-3">
                  {links.map((link: V2MofRsLink) => (
                    <article key={link.linkId} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                      <div className="flex flex-wrap items-center gap-2">
                        <MatchMethodBadge method={link.matchMethod} />
                        <span className="text-xs font-medium">{phaseLabel(link.phase, link.revision)}</span>
                        <span className="text-[10px] text-neutral-400">{link.linkId}</span>
                        {link.spansEntities && <span className="text-[10px] text-amber-700 dark:text-amber-400">複数MOF項にまたがるlink</span>}
                      </div>

                      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                        <div><span className="text-neutral-400">MOF</span><br /><strong>{formatYen(link.mofAmountYen)}</strong></div>
                        <div><span className="text-neutral-400">RS group</span><br /><strong>{formatYen(link.rsAmountYen)}</strong></div>
                        <div><span className="text-neutral-400">差額 MOF−RS</span><br /><strong>{formatYen(link.differenceYen)}</strong></div>
                      </div>

                      <div className="mt-3 text-xs">
                        <span className="text-neutral-400">目: </span>
                        {link.itemIds.map(id => itemNames.get(id) ?? id).join(' / ')}
                      </div>

                      <div className="mt-3">
                        <div className="mb-1 flex items-center gap-2 text-xs">
                          <strong>RS事業 {link.projectIds.length}件</strong>
                          {link.projectIds.length > 1 && (
                            <span className="text-amber-700 dark:text-amber-400">※ 金額はgroup合計</span>
                          )}
                        </div>
                        <ul className="grid gap-1 text-xs">
                          {link.projectIds.map(projectId => {
                            const project = projects.get(projectId);
                            return (
                              <li key={projectId} className="rounded bg-neutral-50 px-2 py-1.5 dark:bg-neutral-950">
                                <span className="font-medium">{projectLabel(project, projectId)}</span>
                                {project && (
                                  <span className="ml-2 text-[11px] text-neutral-400">
                                    {[project.ministry, project.bureau].filter(Boolean).join(' / ')}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </article>
                  ))}
                  {!links.length && <p className="rounded border border-dashed p-6 text-center text-neutral-400">この条件のV2リンクはありません。</p>}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
