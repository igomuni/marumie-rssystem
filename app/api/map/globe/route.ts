import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { RS2024StructuredData } from '@/types/structured';

export interface GlobeMinistry {
  name: string;
  totalSpending: number;
  areaFraction: number;
  centroid: [number, number]; // [lat, lon] in degrees
  projectCount: number;
  color: string; // HSL color string
}

export interface GlobeResponse {
  totalSpending: number;
  ministries: GlobeMinistry[];
}

let cachedResponse: GlobeResponse | null = null;

/**
 * Fibonacci格子で球面上にN点を準均等配置する
 * Returns [lat, lon] in degrees for each point
 */
function fibonacciSphere(n: number): [number, number][] {
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  const points: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    // Polar angle (0 to π)
    const theta = Math.acos(1 - 2 * (i + 0.5) / n);
    // Azimuthal angle (golden angle increment)
    const phi = 2 * Math.PI * i / goldenRatio;

    // Convert to lat/lon in degrees
    const lat = 90 - (theta * 180) / Math.PI; // -90 to 90
    const lon = ((phi * 180) / Math.PI) % 360 - 180; // -180 to 180

    points.push([lat, lon]);
  }

  return points;
}

function loadGlobeData(): GlobeResponse {
  if (cachedResponse) return cachedResponse;

  const structuredPath = path.join(process.cwd(), 'public/data/rs2024-structured.json');
  const raw: RS2024StructuredData = JSON.parse(fs.readFileSync(structuredPath, 'utf8'));

  const stats = raw.statistics.byMinistry;
  const ministryNames = Object.keys(stats);

  // Calculate total spending across all ministries
  let totalSpending = 0;
  for (const name of ministryNames) {
    totalSpending += stats[name].totalSpending;
  }

  // Sort by spending (descending) for consistent ordering
  const sorted = ministryNames
    .map(name => ({ name, ...stats[name] }))
    .sort((a, b) => b.totalSpending - a.totalSpending);

  // Generate Fibonacci sphere points
  const points = fibonacciSphere(sorted.length);

  // Assign colors (HSL hue distributed across 360°)
  const ministries: GlobeMinistry[] = sorted.map((m, i) => ({
    name: m.name,
    totalSpending: m.totalSpending,
    areaFraction: totalSpending > 0 ? m.totalSpending / totalSpending : 0,
    centroid: points[i],
    projectCount: m.projectCount,
    color: `hsl(${Math.round((i * 360) / sorted.length)}, 70%, 50%)`,
  }));

  cachedResponse = { totalSpending, ministries };
  return cachedResponse;
}

export async function GET() {
  const data = loadGlobeData();
  return NextResponse.json(data);
}
