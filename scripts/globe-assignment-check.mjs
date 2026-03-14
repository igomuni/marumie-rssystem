#!/usr/bin/env node
/**
 * Globe面割り当て検証スクリプト
 * Usage: node scripts/globe-assignment-check.mjs > globe-assignment.csv
 *
 * GlobeView.tsx の assignFaces() と同じアルゴリズムを再現し、
 * 各府省庁の目標面数・実際面数・差分・重心位置をCSV出力する。
 */

const ICO_SUBDIVISIONS = 7;
const SPHERE_RADIUS = 1;

// ─── Fetch API data ─────────────────────────────────────────────────

const API_URL = process.env.API_URL || 'http://localhost:3002/api/map/globe';
const res = await fetch(API_URL);
const data = await res.json();
const ministries = data.ministries;

// ─── Icosphere generation ───────────────────────────────────────────

function generateIcosphere(subdivisions, radius) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    -1, t, 0,  1, t, 0,  -1, -t, 0,  1, -t, 0,
    0, -1, t,  0, 1, t,  0, -1, -t,  0, 1, -t,
    t, 0, -1,  t, 0, 1,  -t, 0, -1,  -t, 0, 1,
  ];
  let faces = [
    0,11,5,  0,5,1,  0,1,7,  0,7,10,  0,10,11,
    1,5,9,  5,11,4,  11,10,2,  10,7,6,  7,1,8,
    3,9,4,  3,4,2,  3,2,6,  3,6,8,  3,8,9,
    4,9,5,  2,4,11,  6,2,10,  8,6,7,  9,8,1,
  ];
  for (let i = 0; i < verts.length; i += 3) {
    const len = Math.sqrt(verts[i]**2 + verts[i+1]**2 + verts[i+2]**2);
    verts[i] /= len; verts[i+1] /= len; verts[i+2] /= len;
  }
  for (let s = 0; s < subdivisions; s++) {
    const midCache = new Map();
    const newFaces = [];
    function getMid(a, b) {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (midCache.has(key)) return midCache.get(key);
      let mx = (verts[a*3]+verts[b*3])/2, my = (verts[a*3+1]+verts[b*3+1])/2, mz = (verts[a*3+2]+verts[b*3+2])/2;
      const len = Math.sqrt(mx*mx+my*my+mz*mz);
      mx /= len; my /= len; mz /= len;
      const idx = verts.length / 3;
      verts.push(mx, my, mz);
      midCache.set(key, idx);
      return idx;
    }
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i], b = faces[i+1], c = faces[i+2];
      const ab = getMid(a,b), bc = getMid(b,c), ca = getMid(c,a);
      newFaces.push(a,ab,ca, b,bc,ab, c,ca,bc, ab,bc,ca);
    }
    faces = newFaces;
  }
  const vertices = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i++) vertices[i] = verts[i] * radius;
  const indices = new Uint32Array(faces);
  const faceCount = faces.length / 3;
  const adjacency = new Int32Array(faceCount * 3).fill(-1);
  const edgeToFace = new Map();
  for (let f = 0; f < faceCount; f++) {
    for (let e = 0; e < 3; e++) {
      const v0 = indices[f*3+e], v1 = indices[f*3+(e+1)%3];
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      const other = edgeToFace.get(key);
      if (other !== undefined) {
        for (let s = 0; s < 3; s++) { if (adjacency[f*3+s]===-1) { adjacency[f*3+s]=other; break; } }
        for (let s = 0; s < 3; s++) { if (adjacency[other*3+s]===-1) { adjacency[other*3+s]=f; break; } }
      } else { edgeToFace.set(key, f); }
    }
  }
  return { vertices, indices, faceCount, adjacency };
}

// ─── Assignment (mirrors GlobeView.tsx assignFaces) ─────────────────

function lonLatToXYZ(lon, lat) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return [-Math.sin(phi)*Math.cos(theta), Math.cos(phi), Math.sin(phi)*Math.sin(theta)];
}

function assignFaces(ico, ministries) {
  const { vertices, indices, faceCount, adjacency } = ico;
  const assignment = new Int32Array(faceCount).fill(-1);
  const centroids = new Float32Array(faceCount * 3);
  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f*3], i1 = indices[f*3+1], i2 = indices[f*3+2];
    centroids[f*3]   = (vertices[i0*3]  +vertices[i1*3]  +vertices[i2*3])  /3;
    centroids[f*3+1] = (vertices[i0*3+1]+vertices[i1*3+1]+vertices[i2*3+1])/3;
    centroids[f*3+2] = (vertices[i0*3+2]+vertices[i1*3+2]+vertices[i2*3+2])/3;
  }
  const targetCounts = new Int32Array(ministries.length);
  let totalAssigned = 0;
  for (let m = 0; m < ministries.length; m++) {
    targetCounts[m] = m < ministries.length - 1
      ? Math.round(ministries[m].areaFraction * faceCount)
      : faceCount - totalAssigned;
    totalAssigned += targetCounts[m];
  }
  const oceanIdx = 0;
  const continentFaceCount = faceCount - targetCounts[oceanIdx];
  const seedFaces = new Int32Array(ministries.length);
  for (let m = 0; m < ministries.length; m++) {
    const [sx,sy,sz] = lonLatToXYZ(ministries[m].seed[0], ministries[m].seed[1]);
    let best = 0, bestD = Infinity;
    for (let f = 0; f < faceCount; f++) {
      const d = (centroids[f*3]-sx)**2+(centroids[f*3+1]-sy)**2+(centroids[f*3+2]-sz)**2;
      if (d < bestD) { bestD = d; best = f; }
    }
    seedFaces[m] = best;
  }

  // Phase A
  const isContinent = new Uint8Array(faceCount);
  {
    const q = [seedFaces[1]]; isContinent[q[0]] = 1; let claimed = 1, h = 0;
    while (h < q.length && claimed < continentFaceCount) {
      const face = q[h++];
      for (let e = 0; e < 3; e++) {
        if (claimed >= continentFaceCount) break;
        const nb = adjacency[face*3+e];
        if (nb === -1 || isContinent[nb]) continue;
        isContinent[nb] = 1; claimed++; q.push(nb);
      }
    }
  }
  for (let f = 0; f < faceCount; f++) if (!isContinent[f]) assignment[f] = oceanIdx;

  // Phase B
  const cm = Array.from({length: ministries.length}, (_,i)=>i).filter(i=>i!==oceanIdx);
  cm.sort((a,b) => targetCounts[a] - targetCounts[b]);
  const currentCounts = new Int32Array(ministries.length);
  const largest = cm[cm.length - 1];
  for (const m of cm) {
    if (m === largest) continue;
    const target = targetCounts[m]; if (target <= 0) continue;
    let start = seedFaces[m];
    if (!isContinent[start] || assignment[start] !== -1) {
      const [sx,sy,sz] = lonLatToXYZ(ministries[m].seed[0], ministries[m].seed[1]);
      let best = -1, bestD = Infinity;
      for (let f = 0; f < faceCount; f++) {
        if (!isContinent[f] || assignment[f] !== -1) continue;
        const d = (centroids[f*3]-sx)**2+(centroids[f*3+1]-sy)**2+(centroids[f*3+2]-sz)**2;
        if (d < bestD) { bestD = d; best = f; }
      }
      if (best === -1) continue;
      start = best;
    }
    const q = [start]; assignment[start] = m; currentCounts[m] = 1; let h = 0;
    while (h < q.length && currentCounts[m] < target) {
      const face = q[h++];
      for (let e = 0; e < 3; e++) {
        if (currentCounts[m] >= target) break;
        const nb = adjacency[face*3+e];
        if (nb === -1 || !isContinent[nb] || assignment[nb] !== -1) continue;
        assignment[nb] = m; currentCounts[m]++; q.push(nb);
      }
    }
  }
  for (let f = 0; f < faceCount; f++) if (assignment[f] === -1) assignment[f] = largest;

  // Connectivity fix
  for (const m of cm) {
    const myFaces = [];
    for (let f = 0; f < faceCount; f++) if (assignment[f] === m) myFaces.push(f);
    if (myFaces.length <= 1) continue;
    const visited = new Uint8Array(faceCount);
    const components = [];
    for (const sf of myFaces) {
      if (visited[sf]) continue;
      const comp = [sf]; visited[sf] = 1; let h = 0;
      while (h < comp.length) {
        const face = comp[h++];
        for (let e = 0; e < 3; e++) {
          const nb = adjacency[face*3+e];
          if (nb !== -1 && !visited[nb] && assignment[nb] === m) { visited[nb] = 1; comp.push(nb); }
        }
      }
      components.push(comp);
    }
    if (components.length <= 1) continue;
    components.sort((a,b) => b.length - a.length);
    for (let ci = 1; ci < components.length; ci++) {
      for (const face of components[ci]) {
        const nb2 = new Map();
        for (let e = 0; e < 3; e++) {
          const nb = adjacency[face*3+e];
          if (nb !== -1 && assignment[nb] !== m && assignment[nb] !== oceanIdx)
            nb2.set(assignment[nb], (nb2.get(assignment[nb])||0)+1);
        }
        if (nb2.size > 0) {
          let bm = -1, bc = 0;
          for (const [nm,cnt] of nb2) if (cnt > bc) { bc = cnt; bm = nm; }
          assignment[face] = bm;
        }
      }
    }
  }

  // Boundary smoothing
  const maxDev = new Int32Array(ministries.length);
  for (let m = 0; m < ministries.length; m++) maxDev[m] = Math.max(1, Math.round(targetCounts[m]*0.01));
  currentCounts.fill(0);
  for (let f = 0; f < faceCount; f++) currentCounts[assignment[f]]++;
  for (let iter = 0; iter < 3; iter++) {
    let swaps = 0;
    for (let f = 0; f < faceCount; f++) {
      const my = assignment[f];
      const nc = new Map();
      for (let e = 0; e < 3; e++) { const nb = adjacency[f*3+e]; if (nb!==-1) nc.set(assignment[nb], (nc.get(assignment[nb])||0)+1); }
      let best = my, bestC = nc.get(my)||0;
      for (const [nm,cnt] of nc) if (nm !== my && cnt > bestC) { best = nm; bestC = cnt; }
      if (best !== my) {
        if (Math.abs(currentCounts[my]-1-targetCounts[my]) <= maxDev[my] &&
            Math.abs(currentCounts[best]+1-targetCounts[best]) <= maxDev[best]) {
          assignment[f] = best; currentCounts[my]--; currentCounts[best]++; swaps++;
        }
      }
    }
    if (swaps === 0) break;
  }

  return { assignment, targetCounts, centroids };
}

// ─── Run and output CSV ─────────────────────────────────────────────

process.stderr.write(`Generating icosphere (level ${ICO_SUBDIVISIONS})...\n`);
const ico = generateIcosphere(ICO_SUBDIVISIONS, SPHERE_RADIUS);
process.stderr.write(`${ico.faceCount.toLocaleString()} faces. Assigning...\n`);

const { assignment, targetCounts, centroids } = assignFaces(ico, ministries);

const finalCounts = new Int32Array(ministries.length);
const sums = ministries.map(() => [0, 0, 0]);
const compCounts = ministries.map(() => 0); // connected component count

for (let f = 0; f < ico.faceCount; f++) {
  const mi = assignment[f];
  finalCounts[mi]++;
  sums[mi][0] += centroids[f*3];
  sums[mi][1] += centroids[f*3+1];
  sums[mi][2] += centroids[f*3+2];
}

// Count connected components per ministry
for (let mi = 0; mi < ministries.length; mi++) {
  const visited = new Uint8Array(ico.faceCount);
  let comps = 0;
  for (let f = 0; f < ico.faceCount; f++) {
    if (assignment[f] !== mi || visited[f]) continue;
    comps++;
    const q = [f]; visited[f] = 1; let h = 0;
    while (h < q.length) {
      const face = q[h++];
      for (let e = 0; e < 3; e++) {
        const nb = ico.adjacency[face*3+e];
        if (nb !== -1 && !visited[nb] && assignment[nb] === mi) { visited[nb] = 1; q.push(nb); }
      }
    }
  }
  compCounts[mi] = comps;
}

console.log('idx,name,target,actual,diff,components,seed_lon,seed_lat,centroid_lon,centroid_lat');
for (let mi = 0; mi < ministries.length; mi++) {
  const n = finalCounts[mi] || 1;
  const cx = sums[mi][0]/n, cy = sums[mi][1]/n, cz = sums[mi][2]/n;
  const len = Math.sqrt(cx*cx+cy*cy+cz*cz);
  const lat = Math.asin(Math.max(-1, Math.min(1, cy/len))) * 180/Math.PI;
  const lon = Math.atan2(cz, -cx) * 180/Math.PI - 180;
  const normLon = ((lon % 360) + 540) % 360 - 180;
  const m = ministries[mi];
  console.log(`${mi},${m.name},${targetCounts[mi]},${finalCounts[mi]},${finalCounts[mi]-targetCounts[mi]},${compCounts[mi]},${m.seed[0].toFixed(1)},${m.seed[1].toFixed(1)},${normLon.toFixed(1)},${lat.toFixed(1)}`);
}

process.stderr.write('Done.\n');
