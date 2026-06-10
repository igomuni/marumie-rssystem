/**
 * API応答に埋め込む関連リンク（HATEOAS）の組み立て。
 * すべて相対URLで返し、ホスト名に依存しない。
 */

export function projectLinks(pid: string | number, year?: string): {
  detail: string;
  subcontracts: string;
  qualityRecipients: string;
  web: string;
} {
  const y = year ? `?year=${year}` : '';
  const yAmp = year ? `&year=${year}` : '';
  return {
    detail: `/api/project-details/${pid}${y}`,
    subcontracts: `/api/subcontracts/${pid}${y}`,
    qualityRecipients: `/api/quality-scores/recipients?pid=${pid}${yAmp}`,
    web: `/subcontracts/${pid}${y}`,
  };
}

export function recipientLinks(key: string, year?: string): {
  recipient: string;
  web: string;
} {
  const y = year ? `?year=${year}` : '';
  const encoded = encodeURIComponent(key);
  return {
    recipient: `/api/recipients/${encoded}${y}`,
    web: `/recipients/${encoded}${y}`,
  };
}

/** 法人番号から外部サイト（gBizINFO）へのリンク */
export function externalCorporateLinks(corporateNumber: string): { gbizinfo: string } | undefined {
  if (!/^\d{13}$/.test(corporateNumber)) return undefined;
  return {
    gbizinfo: `https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${corporateNumber}`,
  };
}
