import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/app/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // 生JSON（最大29MB）のクロールによる帯域消費を防ぐ。
        // 一括取得は .gz（llms.txt で案内）を利用してもらう。
        disallow: ['/data/*.json', '/api/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
