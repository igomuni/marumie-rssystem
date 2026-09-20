'use client';

import { useEffect, useState } from 'react';
import { readData } from './data';
import type { EntityDetail } from './model';
import { phaseNames, type RsIndex, type RsTarget } from './rs-model';
import styles from './page.module.css';

export function RsLinks({ links, onSelect }: { links: EntityDetail['links']; onSelect: (target: RsTarget) => void }) {
  const years = [...new Set(links.map(l => l.sourceYear))].sort();
  const yearsKey = years.join(',');
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    Promise.all(yearsKey.split(',').filter(Boolean).map(async year => {
      const index = await readData<RsIndex>(`/budget-flow-v2/rs/${year}.json.gz`, abort.signal);
      return index.projects.map(p => [p.id, p.projectName]);
    })).then(entries => setNames(Object.fromEntries(entries.flat()))).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [yearsKey, retry]);
  return <>
    {!years.length && <p>この項に対応するRSリンクはありません。</p>}
    {error && <p role="alert">事業名を取得できませんでした。IDから事業を開けます。<button onClick={() => setRetry(n => n + 1)}>事業名を再読み込み</button></p>}
    {years.map(reviewYear => {
      const group = links.filter(l => l.sourceYear === reviewYear);
      const ids = [...new Set(group.flatMap(l => l.projectIds))];
      return <details key={reviewYear}><summary>レビュー年度 {reviewYear} → fiscalYear {group[0].fiscalYear} · {ids.length} 事業 / {group.length} リンク</summary>
        {ids.map(projectId => <div className={styles.rsLink} key={projectId}><button onClick={() => onSelect({ reviewYear, projectId, fiscalYear: group[0].fiscalYear })}>{names[`${reviewYear}:${projectId}`] ?? `RS事業 ${projectId}`} →</button><small>事業ID {projectId} · {[...new Set(group.filter(l => l.projectIds.includes(projectId)).map(l => phaseNames[l.phase] ?? l.phase))].join(' / ')}</small></div>)}
        <details><summary>リンクの照合根拠</summary>{group.map(l => <p className={styles.code} key={l.linkId}>{l.linkId} / {l.matchMethod} / {l.phase}{l.spansEntities && '（複数項にまたがるリンク）'}</p>)}</details>
      </details>;
    })}
  </>;
}
