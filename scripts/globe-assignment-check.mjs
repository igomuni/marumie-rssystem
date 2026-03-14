#!/usr/bin/env node
/**
 * Globe面割り当て検証スクリプト（再帰二分割ツリーマップ方式）
 * Usage: node scripts/globe-assignment-check.mjs > globe-assignment.csv
 */

const ICO_SUBDIVISIONS = 7;
const SPHERE_RADIUS = 1;
const FACES_PER_ORIGINAL = 4 ** ICO_SUBDIVISIONS;

const API_URL = process.env.API_URL || 'http://localhost:3002/api/map/globe';
const res = await fetch(API_URL);
const data = await res.json();
const ministries = data.ministries;

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
    centroids[f*3]   = (vertices[i0*3]+vertices[i1*3]+vertices[i2*3])/3;
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

  // Phase 1: 元面→海/大陸の分離
  const NUM_ORIGINAL = 20;
  const origCentroids = new Float32Array(NUM_ORIGINAL * 3);
  for (let o = 0; o < NUM_ORIGINAL; o++) {
    let sx = 0, sy = 0, sz = 0;
    const startF = o * FACES_PER_ORIGINAL;
    const endF = startF + FACES_PER_ORIGINAL;
    for (let f = startF; f < endF; f++) {
      sx += centroids[f*3]; sy += centroids[f*3+1]; sz += centroids[f*3+2];
    }
    origCentroids[o*3] = sx / FACES_PER_ORIGINAL;
    origCentroids[o*3+1] = sy / FACES_PER_ORIGINAL;
    origCentroids[o*3+2] = sz / FACES_PER_ORIGINAL;
  }

  const [ccx, ccy, ccz] = lonLatToXYZ(ministries[1].seed[0], ministries[1].seed[1]);

  const origDists = [];
  for (let o = 0; o < NUM_ORIGINAL; o++) {
    const dx = origCentroids[o*3]-ccx, dy = origCentroids[o*3+1]-ccy, dz = origCentroids[o*3+2]-ccz;
    origDists.push({ idx: o, dist: dx*dx+dy*dy+dz*dz });
  }
  origDists.sort((a, b) => a.dist - b.dist);

  const fullContinentOriginals = Math.floor(continentFaceCount / FACES_PER_ORIGINAL);
  const boundaryFaces = continentFaceCount - fullContinentOriginals * FACES_PER_ORIGINAL;

  const isOrigContinent = new Uint8Array(NUM_ORIGINAL);
  for (let i = 0; i < origDists.length; i++) {
    if (i < fullContinentOriginals) isOrigContinent[origDists[i].idx] = 1;
    else if (i === fullContinentOriginals && boundaryFaces > 0) isOrigContinent[origDists[i].idx] = 2;
  }

  const isContinent = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const origId = Math.floor(f / FACES_PER_ORIGINAL);
    if (isOrigContinent[origId] >= 1) isContinent[f] = 1;
  }

  if (boundaryFaces > 0) {
    const bOrigIdx = origDists[fullContinentOriginals].idx;
    const startF = bOrigIdx * FACES_PER_ORIGINAL;
    const endF = startF + FACES_PER_ORIGINAL;
    const faceDists = [];
    for (let f = startF; f < endF; f++) {
      const dx = centroids[f*3]-ccx, dy = centroids[f*3+1]-ccy, dz = centroids[f*3+2]-ccz;
      faceDists.push({ f, dist: dx*dx+dy*dy+dz*dz });
    }
    faceDists.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < faceDists.length; i++) {
      isContinent[faceDists[i].f] = i < boundaryFaces ? 1 : 0;
    }
  }

  for (let f = 0; f < faceCount; f++) if (!isContinent[f]) assignment[f] = oceanIdx;

  // Phase 2: 再帰二分割ツリーマップ
  const continentMinistries = Array.from({length: ministries.length}, (_, i) => i).filter(i => i !== oceanIdx);

  const ccLen = Math.sqrt(ccx*ccx+ccy*ccy+ccz*ccz);
  const cnx = ccx/ccLen, cny = ccy/ccLen, cnz = ccz/ccLen;
  let cupx = 0, cupy = 1, cupz = 0;
  if (Math.abs(cny) > 0.9) { cupx = 1; cupy = 0; }
  let ctx = cupy*cnz-cupz*cny, cty = cupz*cnx-cupx*cnz, ctz = cupx*cny-cupy*cnx;
  const ctLen = Math.sqrt(ctx*ctx+cty*cty+ctz*ctz);
  ctx /= ctLen; cty /= ctLen; ctz /= ctLen;
  const cbx = cny*ctz-cnz*cty, cby = cnz*ctx-cnx*ctz, cbz = cnx*cty-cny*ctx;

  const continentFaceUV = [];
  for (let f = 0; f < faceCount; f++) {
    if (!isContinent[f]) continue;
    const dx = centroids[f*3]-ccx, dy = centroids[f*3+1]-ccy, dz = centroids[f*3+2]-ccz;
    continentFaceUV.push({ f, u: dx*ctx+dy*cty+dz*ctz, v: dx*cbx+dy*cby+dz*cbz });
  }

  function assignRecursive(faces, items, splitByV) {
    if (items.length === 0 || faces.length === 0) return;
    if (items.length === 1) {
      for (const face of faces) assignment[face.f] = items[0].ministry;
      return;
    }
    if (splitByV) {
      faces.sort((a, b) => a.v - b.v || a.u - b.u);
    } else {
      faces.sort((a, b) => a.u - b.u || a.v - b.v);
    }
    const totalArea = items.reduce((s, it) => s + it.area, 0);
    const halfArea = totalArea / 2;
    const firstHalf = [];
    let firstArea = 0;
    const rest = [...items];
    while (rest.length > 1) {
      if (firstArea + rest[0].area > halfArea && firstHalf.length > 0) break;
      const item = rest.shift();
      firstHalf.push(item);
      firstArea += item.area;
    }
    const splitIdx = Math.round(faces.length * firstArea / totalArea);
    assignRecursive(faces.slice(0, splitIdx), firstHalf, !splitByV);
    assignRecursive(faces.slice(splitIdx), rest, !splitByV);
  }

  // 小規模府省庁はツリーマップから外してエッジゾーンに配置
  const EDGE_THRESHOLD = 1200;
  const treemapMinistries = [];
  const edgeMinistries = [];
  for (const m of continentMinistries) {
    if (targetCounts[m] >= EDGE_THRESHOLD) {
      treemapMinistries.push({ ministry: m, area: targetCounts[m] });
    } else {
      edgeMinistries.push({ ministry: m, area: targetCounts[m] });
    }
  }
  const edgeTotalArea = edgeMinistries.reduce((s, it) => s + it.area, 0);

  const EDGE_ZONE = -999;
  const treemapItems = [
    ...treemapMinistries,
    { ministry: EDGE_ZONE, area: edgeTotalArea },
  ];
  assignRecursive([...continentFaceUV], treemapItems, true);

  // エッジゾーンの面をBFSで小規模府省庁に割り当て
  if (edgeMinistries.length > 0) {
    const edgeFaces = [];
    for (let f = 0; f < faceCount; f++) {
      if (assignment[f] === EDGE_ZONE) edgeFaces.push(f);
    }

    const edgeSet = new Set(edgeFaces);
    const edgeBfsOrder = [];
    const edgeVisited = new Uint8Array(faceCount);

    // 海に隣接するエッジ面をシードにする
    const edgeSeeds = [];
    for (const f of edgeFaces) {
      for (let e = 0; e < 3; e++) {
        const nb = adjacency[f * 3 + e];
        if (nb !== -1 && assignment[nb] === oceanIdx) {
          edgeSeeds.push(f);
          break;
        }
      }
    }
    if (edgeSeeds.length === 0 && edgeFaces.length > 0) {
      edgeSeeds.push(edgeFaces[0]);
    }

    const bfsQueue = [];
    for (const s of edgeSeeds) {
      if (!edgeVisited[s]) {
        edgeVisited[s] = 1;
        bfsQueue.push(s);
      }
    }
    let bfsHead = 0;
    while (bfsHead < bfsQueue.length) {
      const face = bfsQueue[bfsHead++];
      edgeBfsOrder.push(face);
      for (let e = 0; e < 3; e++) {
        const nb = adjacency[face * 3 + e];
        if (nb !== -1 && !edgeVisited[nb] && edgeSet.has(nb)) {
          edgeVisited[nb] = 1;
          bfsQueue.push(nb);
        }
      }
    }

    // BFS順で小規模府省庁を割り当て（面積降順）
    edgeMinistries.sort((a, b) => b.area - a.area);
    let cursor = 0;
    for (const item of edgeMinistries) {
      let assigned = 0;
      while (assigned < item.area && cursor < edgeBfsOrder.length) {
        assignment[edgeBfsOrder[cursor]] = item.ministry;
        assigned++;
        cursor++;
      }
    }
    const lastEdge = edgeMinistries[edgeMinistries.length - 1].ministry;
    while (cursor < edgeBfsOrder.length) {
      assignment[edgeBfsOrder[cursor]] = lastEdge;
      cursor++;
    }
  }

  // Phase 3: 境界滑らか化
  const currentCounts = new Int32Array(ministries.length);
  for (let f = 0; f < faceCount; f++) currentCounts[assignment[f]]++;

  const maxDev = new Int32Array(ministries.length);
  for (let m = 0; m < ministries.length; m++) maxDev[m] = Math.max(1, Math.round(targetCounts[m]*0.02));

  for (let iter = 0; iter < 5; iter++) {
    let swaps = 0;
    for (let f = 0; f < faceCount; f++) {
      const my = assignment[f];
      const nc = new Map();
      for (let e = 0; e < 3; e++) {
        const nb = adjacency[f*3+e];
        if (nb !== -1) nc.set(assignment[nb], (nc.get(assignment[nb])||0)+1);
      }
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

process.stderr.write(`Generating icosphere (level ${ICO_SUBDIVISIONS})...\n`);
const ico = generateIcosphere(ICO_SUBDIVISIONS, SPHERE_RADIUS);
process.stderr.write(`${ico.faceCount.toLocaleString()} faces. Assigning...\n`);

const { assignment, targetCounts, centroids } = assignFaces(ico, ministries);

const finalCounts = new Int32Array(ministries.length);
const sums = ministries.map(() => [0, 0, 0]);
const compCounts = ministries.map(() => 0);

for (let f = 0; f < ico.faceCount; f++) {
  const mi = assignment[f];
  finalCounts[mi]++;
  sums[mi][0] += centroids[f*3];
  sums[mi][1] += centroids[f*3+1];
  sums[mi][2] += centroids[f*3+2];
}

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
