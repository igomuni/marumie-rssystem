import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AIチャットAPIは全ローダ（graph 96MB級・quality系 数十MB ×2年度等）を import するため、
  // ファイルトレーシングが public/data を同梱すると Vercel の関数上限 250MB を超える（実測270MB）。
  // この関数は Vercel 上では isAiChatEnabled ガードで常に 404（データ読込なし）のため同梱不要。
  // 将来 Vercel で有効化（SANKEY_AI_CHAT_ENABLED=1）する場合はこの除外の見直しが必須（WP5-1）。
  outputFileTracingExcludes: {
    '/api/ai/sankey-chat': ['./public/data/**'],
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
