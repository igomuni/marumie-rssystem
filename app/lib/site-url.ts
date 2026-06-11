/**
 * サイトの公開URL。
 * Vercel 環境では NEXT_PUBLIC_SITE_URL を設定して上書きする。
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://marumie-rssystem.vercel.app';
