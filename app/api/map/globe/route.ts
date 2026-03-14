import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { RS2024StructuredData } from '@/types/structured';

export interface GlobeMinistry {
  name: string;
  totalSpending: number;
  areaFraction: number;
  seed: [number, number]; // [lon, lat] in degrees — Fibonacci lattice position
  projectCount: number;
  color: string;
}

export interface GlobeResponse {
  totalSpending: number;
  ministries: GlobeMinistry[];
}

let cachedResponse: GlobeResponse | null = null;

/**
 * Fibonacci格子で球面上にN点を準均等配置する
 * Returns [lon, lat] in degrees (GeoJSON convention)
 */
function fibonacciSphere(n: number): [number, number][] {
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  const points: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const theta = Math.acos(1 - 2 * (i + 0.5) / n);
    const phi = 2 * Math.PI * i / goldenRatio;

    const lat = 90 - (theta * 180) / Math.PI;
    let lon = ((phi * 180) / Math.PI) % 360 - 180;
    if (lon < -180) lon += 360;
    if (lon > 180) lon -= 360;

    points.push([lon, lat]);
  }

  return points;
}

function loadGlobeData(): GlobeResponse {
  if (cachedResponse) return cachedResponse;

  const structuredPath = path.join(process.cwd(), 'public/data/rs2024-structured.json');
  const raw: RS2024StructuredData = JSON.parse(fs.readFileSync(structuredPath, 'utf8'));

  const stats = raw.statistics.byMinistry;
  const ministryNames = Object.keys(stats);

  let totalSpending = 0;
  for (const name of ministryNames) {
    totalSpending += stats[name].totalSpending;
  }

  // Sort by spending (descending)
  const sorted = ministryNames
    .map(name => ({ name, ...stats[name] }))
    .sort((a, b) => b.totalSpending - a.totalSpending);

  // Merge ministries that would get 0 icosphere faces at level 6 (81,920 faces)
  const ICO_FACES = 81920;
  const visible: typeof sorted = [];
  let otherSpending = 0;
  let otherBudget = 0;
  let otherProjectCount = 0;
  let otherRecipientCount = 0;

  for (const m of sorted) {
    const fraction = totalSpending > 0 ? m.totalSpending / totalSpending : 0;
    if (Math.round(fraction * ICO_FACES) >= 1) {
      visible.push(m);
    } else {
      otherSpending += m.totalSpending;
      otherBudget += m.totalBudget;
      otherProjectCount += m.projectCount;
      otherRecipientCount += m.recipientCount;
    }
  }

  // Add "その他" group if any ministries were merged
  if (otherSpending > 0) {
    visible.push({
      name: 'その他',
      totalSpending: otherSpending,
      totalBudget: otherBudget,
      projectCount: otherProjectCount,
      recipientCount: otherRecipientCount,
    });
  }

  // Fibonacci lattice seeds
  const seeds = fibonacciSphere(visible.length);

  const ministries: GlobeMinistry[] = visible.map((m, i) => ({
    name: m.name,
    totalSpending: m.totalSpending,
    areaFraction: totalSpending > 0 ? m.totalSpending / totalSpending : 1 / visible.length,
    seed: seeds[i],
    projectCount: m.projectCount,
    color: `hsl(${Math.round((i * 360) / visible.length)}, 70%, 50%)`,
  }));

  cachedResponse = { totalSpending, ministries };
  return cachedResponse;
}

export async function GET() {
  const data = loadGlobeData();
  return NextResponse.json(data);
}
