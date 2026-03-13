'use client';

import dynamic from 'next/dynamic';

const GlobeView = dynamic(
  () => import('@/client/components/GlobeView'),
  { ssr: false }
);

export default function GlobePage() {
  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <GlobeView />
    </main>
  );
}
