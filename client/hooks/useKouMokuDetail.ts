'use client';

/**
 * サイドパネルの「目」タブが必要とするデータの取得。
 *
 * `client/components/` の再利用可能UIから直接APIを叩かない（Layer Design Rules）ため、
 * fetch はこのフックに閉じる。`app/lib/` は HTTP 禁止のドメイン層なので置き場にしない。
 *
 * mode='section' は /api/mof-kou/detail（項の目一覧＋RS紐づけ）、
 * mode='project' は /api/mof-sankey/rs-project（RS事業が計上されている目の一覧）を叩く。
 */

import { useEffect, useState } from 'react';

export interface KouMokuRow {
  sectionName?: string;
  subItemName: string;
  amount: number;
  rsProjectNames?: string[];
}

interface KouMokuLeafLike {
  key: string;
  subItemName: string;
  amount: number;
}

interface RsLinkLike {
  kouMokuKey: string;
  projectName: string;
}

interface SectionDetailResponse {
  kouMokuItems?: KouMokuLeafLike[];
  rsLinks?: RsLinkLike[];
}

interface RsProjectLinkRow {
  sectionName: string;
  subItemName: string;
  rsAmount: number;
}

interface RsProjectResponse {
  rows?: RsProjectLinkRow[];
}

export type KouMokuDetailParams =
  | { mode: 'section'; fiscalYear: number; sectionId: string }
  | { mode: 'project'; fiscalYear: number; budgetType: string; projectId: number };

function fetchSectionRows(fiscalYear: number, sectionId: string): Promise<KouMokuRow[]> {
  return fetch(`/api/mof-kou/detail?year=${fiscalYear}&id=${encodeURIComponent(sectionId)}`)
    .then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<SectionDetailResponse>;
    })
    .then(({ kouMokuItems = [], rsLinks = [] }) => {
      const rsByKey = new Map<string, string[]>();
      for (const link of rsLinks) {
        const list = rsByKey.get(link.kouMokuKey) ?? [];
        list.push(link.projectName);
        rsByKey.set(link.kouMokuKey, list);
      }
      return kouMokuItems
        .map(k => ({ subItemName: k.subItemName, amount: k.amount, rsProjectNames: rsByKey.get(k.key) }))
        .sort((a, b) => b.amount - a.amount);
    });
}

function fetchProjectRows(fiscalYear: number, projectId: number, budgetType: string): Promise<KouMokuRow[]> {
  const qs = `year=${fiscalYear}&projectId=${projectId}&budgetType=${encodeURIComponent(budgetType)}`;
  return fetch(`/api/mof-sankey/rs-project?${qs}`)
    .then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<RsProjectResponse>;
    })
    .then(({ rows: linkRows = [] }) =>
      linkRows
        .map(l => ({ sectionName: l.sectionName, subItemName: l.subItemName, amount: l.rsAmount }))
        .sort((a, b) => b.amount - a.amount)
    );
}

export function useKouMokuDetail(params: KouMokuDetailParams): { rows: KouMokuRow[] | null; error: boolean } {
  const [rows, setRows] = useState<KouMokuRow[] | null>(null);
  const [error, setError] = useState(false);
  const { mode, fiscalYear } = params;
  const sectionId = params.mode === 'section' ? params.sectionId : undefined;
  const projectId = params.mode === 'project' ? params.projectId : undefined;
  const budgetType = params.mode === 'project' ? params.budgetType : undefined;

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);

    const request =
      mode === 'section' && sectionId !== undefined
        ? fetchSectionRows(fiscalYear, sectionId)
        : projectId !== undefined && budgetType !== undefined
          ? fetchProjectRows(fiscalYear, projectId, budgetType)
          : null;
    if (!request) return;

    request
      .then(items => {
        if (!cancelled) setRows(items);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, fiscalYear, sectionId, projectId, budgetType]);

  return { rows, error };
}
