'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MofView } from './mof-view';
import { RsView } from './rs-view';
import type { MofTarget, RsTarget } from './rs-model';
import styles from './page.module.css';

export default function BudgetFlow() {
  const [view, setView] = useState<'mof' | 'rs'>('mof');
  const [rsOpened, setRsOpened] = useState(false);
  const [mofTarget, setMofTarget] = useState<MofTarget | null>(null);
  const [rsTarget, setRsTarget] = useState<RsTarget | null>(null);
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>MARUMIE / PIPELINE V2</div><h1>Budget Flow <span>予算の変化を、原典から。</span></h1></div>
      <Link className={styles.link} href="/integrated-sankey?year=2025">現行 Integrated（MOF2024 / RS2025）↗</Link>
    </header>
    <nav className={styles.viewSwitch} aria-label="予算を見る視点">
      <button aria-pressed={view === 'mof'} onClick={() => setView('mof')}>MOF 項</button>
      <button aria-pressed={view === 'rs'} onClick={() => { setRsOpened(true); setView('rs'); }}>RS 事業</button>
    </nav>
    <div hidden={view !== 'mof'}><MofView target={mofTarget} onRs={target => { setRsTarget(target); setRsOpened(true); setView('rs'); }} /></div>
    {rsOpened && <div hidden={view !== 'rs'}><RsView target={rsTarget} onMof={target => { setMofTarget(target); setView('mof'); }} /></div>}
  </main>;
}
