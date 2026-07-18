import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // データ JSON の関数同梱はトレーサーの推測に任せず明示制御する。
  // 生 .json（展開後 96MB級）が同梱されると Vercel の関数上限 250MB を超えるため
  // （PR #259 で /api/ai/sankey-chat が実測 270MB でデプロイ失敗）、
  // 全関数から public/data を除外し、prebuild が data/server/ に同期した
  // .gz（全ファイル合計 ~35MB）+ 小容量 mof raw だけを同梱する。
  // 注意: Next の実装上、excludes は includes 適用後の結合結果に掛かるため、
  // 除外ツリー（public/data）内のファイルを include で残すことはできない。
  // include は必ず別ツリー（data/server）を指すこと（scripts/decompress-data.sh 参照）。
  // サーバ側ローダは public/data → data/server の順で探索する（app/lib/api/data-file.ts）。
  // 検証: npm run build 後に npm run check-traces（scripts/check-function-traces.mjs）。
  outputFileTracingExcludes: {
    // data/usage は dev 専用の利用ログ（usage-log.ts が参照するためトレースに載るが同梱不要）
    '*': ['./public/data/**', './data/usage/**'],
  },
  outputFileTracingIncludes: {
    '*': ['./data/server/**'],
  },
  transpilePackages: [
    '@nivo/sankey',
    '@nivo/core',
    '@nivo/colors',
    '@nivo/legends',
    '@nivo/text',
    '@nivo/theming',
    '@nivo/tooltip',
  ],
};

export default nextConfig;
