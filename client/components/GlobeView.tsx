'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import type { GlobeResponse, GlobeMinistry } from '@/app/api/map/globe/route';

const SPHERE_RADIUS = 1;
const ICO_SUBDIVISIONS = 7; // 20 * 4^7 = 327,680 faces

// ─── Icosphere generation ───────────────────────────────────────────

interface IcoSphere {
  vertices: Float32Array;  // flat xyz array
  indices: Uint32Array;    // triangle indices
  faceCount: number;
  adjacency: Int32Array;   // 3 neighbors per face (faceIdx*3+0..2), -1 if none
}

function generateIcosphere(subdivisions: number, radius: number): IcoSphere {
  const t = (1 + Math.sqrt(5)) / 2;

  // 12 vertices of icosahedron
  const verts: number[] = [
    -1, t, 0,  1, t, 0,  -1, -t, 0,  1, -t, 0,
    0, -1, t,  0, 1, t,  0, -1, -t,  0, 1, -t,
    t, 0, -1,  t, 0, 1,  -t, 0, -1,  -t, 0, 1,
  ];

  // 20 faces
  let faces: number[] = [
    0,11,5,  0,5,1,   0,1,7,   0,7,10,  0,10,11,
    1,5,9,   5,11,4,  11,10,2, 10,7,6,  7,1,8,
    3,9,4,   3,4,2,   3,2,6,   3,6,8,   3,8,9,
    4,9,5,   2,4,11,  6,2,10,  8,6,7,   9,8,1,
  ];

  // Normalize initial vertices to unit sphere
  for (let i = 0; i < verts.length; i += 3) {
    const len = Math.sqrt(verts[i] ** 2 + verts[i+1] ** 2 + verts[i+2] ** 2);
    verts[i] /= len; verts[i+1] /= len; verts[i+2] /= len;
  }

  // Subdivide
  for (let s = 0; s < subdivisions; s++) {
    const midCache = new Map<string, number>();
    const newFaces: number[] = [];

    function getMid(a: number, b: number): number {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const cached = midCache.get(key);
      if (cached !== undefined) return cached;

      const ax = verts[a*3], ay = verts[a*3+1], az = verts[a*3+2];
      const bx = verts[b*3], by = verts[b*3+1], bz = verts[b*3+2];
      let mx = (ax+bx)/2, my = (ay+by)/2, mz = (az+bz)/2;
      const len = Math.sqrt(mx*mx + my*my + mz*mz);
      mx /= len; my /= len; mz /= len;

      const idx = verts.length / 3;
      verts.push(mx, my, mz);
      midCache.set(key, idx);
      return idx;
    }

    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i], b = faces[i+1], c = faces[i+2];
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      newFaces.push(
        a, ab, ca,
        b, bc, ab,
        c, ca, bc,
        ab, bc, ca,
      );
    }
    faces = newFaces;
  }

  // Scale to radius
  const vertices = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    vertices[i] = verts[i] * radius;
  }

  const indicesArr = new Uint32Array(faces);
  const faceCount = faces.length / 3;

  // Build face adjacency graph: for each edge, find the two faces sharing it
  const adjacency = new Int32Array(faceCount * 3).fill(-1);
  const edgeToFace = new Map<string, number>();

  for (let f = 0; f < faceCount; f++) {
    for (let e = 0; e < 3; e++) {
      const v0 = indicesArr[f * 3 + e];
      const v1 = indicesArr[f * 3 + (e + 1) % 3];
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      const other = edgeToFace.get(key);
      if (other !== undefined) {
        // Find empty adjacency slot for both faces
        for (let s = 0; s < 3; s++) {
          if (adjacency[f * 3 + s] === -1) { adjacency[f * 3 + s] = other; break; }
        }
        for (let s = 0; s < 3; s++) {
          if (adjacency[other * 3 + s] === -1) { adjacency[other * 3 + s] = f; break; }
        }
      } else {
        edgeToFace.set(key, f);
      }
    }
  }

  return { vertices, indices: indicesArr, faceCount, adjacency };
}

// ─── Face → Ministry assignment (サッカーボール展開方式) ────────────
// 正二十面体の20元面を活用したカーソル走査方式:
//   Phase 1: 元面→海/大陸の分離
//   Phase 2: 大陸元面内でカーソル走査により府省庁を割り当て
//   Phase 3: 境界滑らか化

const FACES_PER_ORIGINAL = 4 ** ICO_SUBDIVISIONS; // 16384

function lonLatToXYZ(lon: number, lat: number): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return [
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ];
}

function assignFaces(
  ico: IcoSphere,
  ministries: GlobeMinistry[],
): Int32Array {
  const { vertices, indices, faceCount, adjacency } = ico;
  const assignment = new Int32Array(faceCount).fill(-1);

  // Compute face centroids
  const centroids = new Float32Array(faceCount * 3);
  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
    centroids[f * 3]     = (vertices[i0*3]   + vertices[i1*3]   + vertices[i2*3])   / 3;
    centroids[f * 3 + 1] = (vertices[i0*3+1] + vertices[i1*3+1] + vertices[i2*3+1]) / 3;
    centroids[f * 3 + 2] = (vertices[i0*3+2] + vertices[i1*3+2] + vertices[i2*3+2]) / 3;
  }

  // Compute target face counts
  const targetCounts = new Int32Array(ministries.length);
  let totalAssigned = 0;
  for (let m = 0; m < ministries.length; m++) {
    if (m < ministries.length - 1) {
      targetCounts[m] = Math.round(ministries[m].areaFraction * faceCount);
    } else {
      targetCounts[m] = faceCount - totalAssigned;
    }
    totalAssigned += targetCounts[m];
  }

  const oceanIdx = 0;
  const continentFaceCount = faceCount - targetCounts[oceanIdx];

  // ─── Phase 1: 元面→海/大陸の分離 ─────────────────────────────────
  // 20元面の重心を計算し、大陸中心からの距離で海/大陸を分ける
  const NUM_ORIGINAL = 20;
  const origCentroids = new Float32Array(NUM_ORIGINAL * 3); // 元面の重心

  for (let o = 0; o < NUM_ORIGINAL; o++) {
    let sx = 0, sy = 0, sz = 0;
    const startF = o * FACES_PER_ORIGINAL;
    const endF = startF + FACES_PER_ORIGINAL;
    for (let f = startF; f < endF; f++) {
      sx += centroids[f * 3];
      sy += centroids[f * 3 + 1];
      sz += centroids[f * 3 + 2];
    }
    origCentroids[o * 3]     = sx / FACES_PER_ORIGINAL;
    origCentroids[o * 3 + 1] = sy / FACES_PER_ORIGINAL;
    origCentroids[o * 3 + 2] = sz / FACES_PER_ORIGINAL;
  }

  // 大陸中心: 経産省(index 1)のseed位置を使う
  const [ccx, ccy, ccz] = lonLatToXYZ(ministries[1].seed[0], ministries[1].seed[1]);

  // 元面を大陸中心からの距離でソート
  const origDists: { idx: number; dist: number }[] = [];
  for (let o = 0; o < NUM_ORIGINAL; o++) {
    const dx = origCentroids[o*3] - ccx;
    const dy = origCentroids[o*3+1] - ccy;
    const dz = origCentroids[o*3+2] - ccz;
    origDists.push({ idx: o, dist: dx*dx + dy*dy + dz*dz });
  }
  origDists.sort((a, b) => a.dist - b.dist);

  // 大陸に必要な元面数を計算: continentFaceCount / FACES_PER_ORIGINAL
  // 境界元面は海と大陸を内部で分割する
  const fullContinentOriginals = Math.floor(continentFaceCount / FACES_PER_ORIGINAL);
  const boundaryFaces = continentFaceCount - fullContinentOriginals * FACES_PER_ORIGINAL;

  const isOrigContinent = new Uint8Array(NUM_ORIGINAL); // 0=ocean, 1=continent, 2=boundary
  for (let i = 0; i < origDists.length; i++) {
    if (i < fullContinentOriginals) {
      isOrigContinent[origDists[i].idx] = 1; // fully continent
    } else if (i === fullContinentOriginals && boundaryFaces > 0) {
      isOrigContinent[origDists[i].idx] = 2; // boundary
    }
    // else: ocean
  }

  // 海面の割り当て
  const isContinent = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const origId = Math.floor(f / FACES_PER_ORIGINAL);
    if (isOrigContinent[origId] === 1) {
      isContinent[f] = 1;
    } else if (isOrigContinent[origId] === 2) {
      isContinent[f] = 1; // 境界元面は仮に大陸扱い
    }
  }

  // 境界元面の処理: 大陸中心に近い面から順にboundaryFaces面だけ大陸にする
  if (boundaryFaces > 0) {
    const boundaryOrigIdx = origDists[fullContinentOriginals].idx;
    const startF = boundaryOrigIdx * FACES_PER_ORIGINAL;
    const endF = startF + FACES_PER_ORIGINAL;

    // 境界元面内の面を大陸中心からの距離でソート
    const faceDists: { f: number; dist: number }[] = [];
    for (let f = startF; f < endF; f++) {
      const dx = centroids[f*3] - ccx;
      const dy = centroids[f*3+1] - ccy;
      const dz = centroids[f*3+2] - ccz;
      faceDists.push({ f, dist: dx*dx + dy*dy + dz*dz });
    }
    faceDists.sort((a, b) => a.dist - b.dist);

    // 近い方からboundaryFaces面だけ大陸、残りは海
    for (let i = 0; i < faceDists.length; i++) {
      if (i < boundaryFaces) {
        isContinent[faceDists[i].f] = 1;
      } else {
        isContinent[faceDists[i].f] = 0;
      }
    }
  }

  // 海の割り当て
  for (let f = 0; f < faceCount; f++) {
    if (!isContinent[f]) assignment[f] = oceanIdx;
  }

  // ─── Phase 2: 再帰二分割ツリーマップ方式 ─────────────────────────
  // 面リストを縦横交互にソート+二分割して矩形領域を作る
  // 面数ベースで分割するため、球面の不均一密度に影響されない

  const continentMinistries = Array.from({ length: ministries.length }, (_, i) => i)
    .filter(i => i !== oceanIdx);

  // 大陸中心のローカル座標系を構築
  const ccLen = Math.sqrt(ccx*ccx + ccy*ccy + ccz*ccz);
  const cnx = ccx/ccLen, cny = ccy/ccLen, cnz = ccz/ccLen;
  let cupx = 0, cupy = 1, cupz = 0;
  if (Math.abs(cny) > 0.9) { cupx = 1; cupy = 0; }
  let ctx = cupy*cnz - cupz*cny, cty = cupz*cnx - cupx*cnz, ctz = cupx*cny - cupy*cnx;
  const ctLen = Math.sqrt(ctx*ctx + cty*cty + ctz*ctz);
  ctx /= ctLen; cty /= ctLen; ctz /= ctLen;
  const cbx = cny*ctz - cnz*cty, cby = cnz*ctx - cnx*ctz, cbz = cnx*cty - cny*ctx;

  // 全大陸面を2Dローカル座標に射影
  interface FaceUV { f: number; u: number; v: number }
  const continentFaceUV: FaceUV[] = [];
  for (let f = 0; f < faceCount; f++) {
    if (!isContinent[f]) continue;
    const dx = centroids[f*3] - ccx, dy = centroids[f*3+1] - ccy, dz = centroids[f*3+2] - ccz;
    continentFaceUV.push({
      f,
      u: dx*ctx + dy*cty + dz*ctz,
      v: dx*cbx + dy*cby + dz*cbz,
    });
  }

  // 再帰二分割: 面リストと府省庁リストを交互にソート方向を変えて分割
  type MItem = { ministry: number; area: number };

  function assignRecursive(
    faces: FaceUV[],
    items: MItem[],
    splitByV: boolean,
  ): void {
    if (items.length === 0 || faces.length === 0) return;
    if (items.length === 1) {
      for (const face of faces) assignment[face.f] = items[0].ministry;
      return;
    }

    // 面を現在の軸でソート
    if (splitByV) {
      faces.sort((a, b) => a.v - b.v || a.u - b.u);
    } else {
      faces.sort((a, b) => a.u - b.u || a.v - b.v);
    }

    // 府省庁を面積の半分で二分割
    const totalArea = items.reduce((s, it) => s + it.area, 0);
    const halfArea = totalArea / 2;

    const firstHalf: MItem[] = [];
    let firstArea = 0;
    const rest = [...items];

    while (rest.length > 1) {
      if (firstArea + rest[0].area > halfArea && firstHalf.length > 0) break;
      const item = rest.shift()!;
      firstHalf.push(item);
      firstArea += item.area;
    }

    // 面を面積比で分割
    const splitIdx = Math.round(faces.length * firstArea / totalArea);
    const firstFaces = faces.slice(0, splitIdx);
    const secondFaces = faces.slice(splitIdx);

    // 次の軸で再帰
    assignRecursive(firstFaces, firstHalf, !splitByV);
    assignRecursive(secondFaces, rest, !splitByV);
  }

  // 小規模府省庁（面積 < 閾値）はツリーマップから外して辺に沿って配置
  const EDGE_THRESHOLD = 1200;
  const treemapMinistries: MItem[] = [];
  const edgeMinistries: MItem[] = [];
  for (const m of continentMinistries) {
    if (targetCounts[m] >= EDGE_THRESHOLD) {
      treemapMinistries.push({ ministry: m, area: targetCounts[m] });
    } else {
      edgeMinistries.push({ ministry: m, area: targetCounts[m] });
    }
  }
  const edgeTotalArea = edgeMinistries.reduce((s, it) => s + it.area, 0);

  // ツリーマップには「エッジゾーン」を1ブロックとして含める
  const EDGE_ZONE = -999;
  const treemapItems: MItem[] = [
    ...treemapMinistries,
    { ministry: EDGE_ZONE, area: edgeTotalArea },
  ];

  assignRecursive([...continentFaceUV], treemapItems, true);

  // エッジゾーンの面を収集し、BFSで小規模府省庁を辺に沿って配置
  if (edgeMinistries.length > 0) {
    // エッジゾーン面の中から、大陸境界(海に隣接)に近い面を起点にBFS
    const edgeFaces: number[] = [];
    for (let f = 0; f < faceCount; f++) {
      if (assignment[f] === EDGE_ZONE) edgeFaces.push(f);
    }

    // エッジ面をBFS順に並べる（海に隣接する面から開始）
    const edgeSet = new Set(edgeFaces);
    const edgeBfsOrder: number[] = [];
    const edgeVisited = new Uint8Array(faceCount);

    // 海に隣接するエッジ面をシードにする
    const edgeSeeds: number[] = [];
    for (const f of edgeFaces) {
      for (let e = 0; e < 3; e++) {
        const nb = adjacency[f * 3 + e];
        if (nb !== -1 && assignment[nb] === oceanIdx) {
          edgeSeeds.push(f);
          break;
        }
      }
    }
    // シードがなければ全エッジ面の先頭を使う
    if (edgeSeeds.length === 0 && edgeFaces.length > 0) {
      edgeSeeds.push(edgeFaces[0]);
    }

    const bfsQueue: number[] = [];
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
    // 残りは最後の小規模府省庁に
    const lastEdge = edgeMinistries[edgeMinistries.length - 1].ministry;
    while (cursor < edgeBfsOrder.length) {
      assignment[edgeBfsOrder[cursor]] = lastEdge;
      cursor++;
    }
  }

  // ─── Phase 3: 境界滑らか化 ───────────────────────────────────────
  const currentCounts = new Int32Array(ministries.length);
  for (let f = 0; f < faceCount; f++) currentCounts[assignment[f]]++;

  const maxDeviation = new Int32Array(ministries.length);
  for (let m = 0; m < ministries.length; m++) {
    maxDeviation[m] = Math.max(1, Math.round(targetCounts[m] * 0.02));
  }

  const SMOOTH_ITERATIONS = 5;
  for (let iter = 0; iter < SMOOTH_ITERATIONS; iter++) {
    let swaps = 0;
    for (let f = 0; f < faceCount; f++) {
      const myMinistry = assignment[f];
      const neighborMinistries = new Map<number, number>();
      for (let e = 0; e < 3; e++) {
        const neighbor = adjacency[f * 3 + e];
        if (neighbor === -1) continue;
        const nm = assignment[neighbor];
        neighborMinistries.set(nm, (neighborMinistries.get(nm) || 0) + 1);
      }

      let bestMinistry = myMinistry;
      let bestCount = neighborMinistries.get(myMinistry) || 0;
      for (const [nm, count] of neighborMinistries) {
        if (nm !== myMinistry && count > bestCount) {
          bestMinistry = nm;
          bestCount = count;
        }
      }

      if (bestMinistry !== myMinistry) {
        const srcDev = currentCounts[myMinistry] - 1 - targetCounts[myMinistry];
        const dstDev = currentCounts[bestMinistry] + 1 - targetCounts[bestMinistry];
        if (Math.abs(srcDev) <= maxDeviation[myMinistry] &&
            Math.abs(dstDev) <= maxDeviation[bestMinistry]) {
          assignment[f] = bestMinistry;
          currentCounts[myMinistry]--;
          currentCounts[bestMinistry]++;
          swaps++;
        }
      }
    }
    if (swaps === 0) break;
  }

  return assignment;
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatYen(amount: number): string {
  if (amount >= 1_000_000_000_000) return `${(amount / 1_000_000_000_000).toFixed(2)}兆円`;
  if (amount >= 100_000_000) return `${(amount / 100_000_000).toFixed(0)}億円`;
  if (amount >= 10_000) return `${(amount / 10_000).toFixed(0)}万円`;
  return `${amount}円`;
}

function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 512;
  canvas.height = 128;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.5, 0.125, 1);
  return sprite;
}

// ─── Component ──────────────────────────────────────────────────────

interface GlobeViewProps {
  data?: GlobeResponse | null;
}

export default function GlobeView({ data }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const zoomInputRef = useRef<HTMLInputElement>(null);
  const coordsRef = useRef<HTMLSpanElement>(null);
  const autoRotateRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');

    const camera = new THREE.PerspectiveCamera(
      50, container.clientWidth / container.clientHeight, 0.1, 100
    );
    camera.position.set(0, 0, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(5, 3, 5);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-3, -2, -3);
    scene.add(dirLight2);

    const disposables: { dispose: () => void }[] = [];

    // Build icosphere + assign faces to ministries
    const ico = generateIcosphere(ICO_SUBDIVISIONS, SPHERE_RADIUS);
    const faceAssignment = data ? assignFaces(ico, data.ministries) : new Int32Array(ico.faceCount);

    // Parse ministry colors
    const ministryColors: THREE.Color[] = data
      ? data.ministries.map(m => new THREE.Color(m.color))
      : [];

    // Build single mesh with per-vertex colors
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(ico.indices, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(ico.vertices, 3));

    // Compute normals (vertices are on unit sphere, so normal = normalized position)
    const normals = new Float32Array(ico.vertices.length);
    for (let i = 0; i < ico.vertices.length; i += 3) {
      const len = Math.sqrt(ico.vertices[i]**2 + ico.vertices[i+1]**2 + ico.vertices[i+2]**2);
      normals[i] = ico.vertices[i] / len;
      normals[i+1] = ico.vertices[i+1] / len;
      normals[i+2] = ico.vertices[i+2] / len;
    }
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

    // Per-face color → per-vertex color (vertices shared between faces need to be un-indexed)
    // Convert to non-indexed geometry so each face can have its own color
    const nonIndexedGeom = geometry.toNonIndexed();
    disposables.push(geometry, nonIndexedGeom);

    const posAttr = nonIndexedGeom.getAttribute('position');
    const vertCount = posAttr.count;
    const colors = new Float32Array(vertCount * 3);

    // faceAssignment maps face index → ministry index
    // After toNonIndexed, vertex i belongs to face floor(i/3)
    for (let v = 0; v < vertCount; v++) {
      const faceIdx = Math.floor(v / 3);
      const mi = faceAssignment[faceIdx];
      const color = ministryColors[mi] || new THREE.Color(0x0a1628);
      colors[v * 3] = color.r;
      colors[v * 3 + 1] = color.g;
      colors[v * 3 + 2] = color.b;
    }
    nonIndexedGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Store face assignment on geometry for raycasting
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.1,
    });
    disposables.push(material);

    const globeMesh = new THREE.Mesh(nonIndexedGeom, material);
    scene.add(globeMesh);

    // Count faces per ministry
    const faceCounts = new Int32Array(data ? data.ministries.length : 0);
    for (let f = 0; f < ico.faceCount; f++) {
      faceCounts[faceAssignment[f]]++;
    }

    // Labels — position at the centroid (average of all face centroids) of each ministry
    const labelGroup = new THREE.Group();
    scene.add(labelGroup);
    if (data) {
      const nonIdxPos = nonIndexedGeom.getAttribute('position');
      const labelPositions: THREE.Vector3[] = data.ministries.map(() => new THREE.Vector3());

      for (let f = 0; f < ico.faceCount; f++) {
        const mi = faceAssignment[f];
        const v = f * 3;
        labelPositions[mi].x += (nonIdxPos.getX(v) + nonIdxPos.getX(v+1) + nonIdxPos.getX(v+2)) / 3;
        labelPositions[mi].y += (nonIdxPos.getY(v) + nonIdxPos.getY(v+1) + nonIdxPos.getY(v+2)) / 3;
        labelPositions[mi].z += (nonIdxPos.getZ(v) + nonIdxPos.getZ(v+1) + nonIdxPos.getZ(v+2)) / 3;
      }

      for (let mi = 0; mi < data.ministries.length; mi++) {
        if (faceCounts[mi] === 0) continue;
        // Average → normalize to sphere surface + small offset
        labelPositions[mi].divideScalar(faceCounts[mi]);
        labelPositions[mi].normalize().multiplyScalar(SPHERE_RADIUS + 0.03);

        const label = createTextSprite(data.ministries[mi].name);
        label.position.copy(labelPositions[mi]);
        labelGroup.add(label);
      }
    }

    // TrackballControls — no polar angle limits, full sphere rotation
    const controls = new TrackballControls(camera, renderer.domElement);
    controls.noPan = true;
    controls.noZoom = false;
    controls.rotateSpeed = 2.0;
    controls.zoomSpeed = 1.2;
    controls.minDistance = SPHERE_RADIUS + camera.near; // 1.1 — prevents near-plane clipping
    controls.maxDistance = 50;
    controls.dynamicDampingFactor = 0.15;

    // Raycaster for hover
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoveredMinistryIdx = -1;

    // Highlight: brighten all faces of a ministry
    function setMinistryHighlight(mi: number, highlighted: boolean) {
      if (!data) return;
      const baseColor = new THREE.Color(data.ministries[mi].color);
      const highlightColor = baseColor.clone();
      if (highlighted) {
        highlightColor.offsetHSL(0, 0, 0.15);
      }
      const colorAttr = nonIndexedGeom.getAttribute('color');
      for (let v = 0; v < vertCount; v++) {
        if (faceAssignment[Math.floor(v / 3)] === mi) {
          colorAttr.setXYZ(v, highlightColor.r, highlightColor.g, highlightColor.b);
        }
      }
      colorAttr.needsUpdate = true;
    }

    function onMouseMove(event: MouseEvent) {
      if (!container || !data) return;
      const rect = container.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(globeMesh);

      const tooltip = tooltipRef.current;
      if (!tooltip) return;

      // Clear previous
      if (hoveredMinistryIdx >= 0) {
        setMinistryHighlight(hoveredMinistryIdx, false);
      }

      if (intersects.length > 0 && intersects[0].faceIndex != null) {
        const mi = faceAssignment[intersects[0].faceIndex];
        if (mi >= 0 && mi < data.ministries.length) {
          hoveredMinistryIdx = mi;
          setMinistryHighlight(mi, true);

          const d = data.ministries[mi];
          const fc = faceCounts[mi].toLocaleString();
          tooltip.textContent = `${d.name}  ${formatYen(d.totalSpending)}  (${d.projectCount}事業 / ${fc}面)`;
          tooltip.style.display = 'block';
          tooltip.style.left = `${event.clientX - rect.left + 12}px`;
          tooltip.style.top = `${event.clientY - rect.top - 8}px`;
          container.style.cursor = 'pointer';
          return;
        }
      }
      hoveredMinistryIdx = -1;
      tooltip.style.display = 'none';
      container.style.cursor = 'grab';
    }
    container.addEventListener('mousemove', onMouseMove);

    function onClick(event: MouseEvent) {
      if (!container || !data) return;
      const rect = container.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(globeMesh);
      if (intersects.length > 0 && intersects[0].faceIndex != null) {
        const mi = faceAssignment[intersects[0].faceIndex];
        if (mi >= 0 && mi < data.ministries.length) {
          const d = data.ministries[mi];
          console.log(`[Globe] ${d.name}: ${formatYen(d.totalSpending)} (${d.projectCount}事業)`);
        }
      }
    }
    container.addEventListener('click', onClick);

    // Animation loop
    let animationId: number;
    const clock = new THREE.Clock();

    // Base label scale at reference distance 3
    const LABEL_BASE_SCALE_X = 0.5;
    const LABEL_BASE_SCALE_Y = 0.125;
    const LABEL_REF_DIST = 3;
    const INITIAL_DIST = 3; // zoom 1.0x = this distance

    // Zoom input handler: zoom = INITIAL_DIST / camDist
    // +zoom = closer (zoom in), -zoom = farther (zoom out)
    function onZoomInput(e: Event) {
      const zoom = parseFloat((e.target as HTMLInputElement).value);
      if (!isNaN(zoom) && zoom > 0) {
        const dist = Math.max(controls.minDistance, Math.min(controls.maxDistance, INITIAL_DIST / zoom));
        camera.position.normalize().multiplyScalar(dist);
      }
    }
    zoomInputRef.current?.addEventListener('change', onZoomInput);

    function animate() {
      animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (autoRotateRef.current) {
        globeMesh.rotation.y += delta * 0.05;
      }
      labelGroup.rotation.y = globeMesh.rotation.y;

      // Scale labels so they appear constant size on screen regardless of zoom
      const camDist = camera.position.length();
      const scaleFactor = camDist / LABEL_REF_DIST;
      for (const child of labelGroup.children) {
        if (child instanceof THREE.Sprite) {
          child.scale.set(
            LABEL_BASE_SCALE_X * scaleFactor,
            LABEL_BASE_SCALE_Y * scaleFactor,
            1
          );
        }
      }

      // Update zoom input to reflect current zoom level
      const zoomLevel = INITIAL_DIST / camDist;
      if (zoomInputRef.current && document.activeElement !== zoomInputRef.current) {
        zoomInputRef.current.value = zoomLevel.toFixed(2);
      }

      // Compute center lat/lon: ray from camera through origin hits sphere at the front center
      // The "look-at" direction in world space, accounting for globe rotation
      if (coordsRef.current) {
        const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        // Undo globe rotation to get point on unrotated sphere
        const invRot = new THREE.Quaternion().setFromEuler(globeMesh.rotation).invert();
        camDir.applyQuaternion(invRot);
        // Convert to lat/lon
        const lat = Math.asin(Math.max(-1, Math.min(1, camDir.y))) * (180 / Math.PI);
        const lon = Math.atan2(camDir.z, -camDir.x) * (180 / Math.PI) - 180;
        const normLon = ((lon % 360) + 540) % 360 - 180;
        coordsRef.current.textContent = `${lat.toFixed(1)}°, ${normLon.toFixed(1)}°`;
      }

      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    function onResize() {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('click', onClick);
      zoomInputRef.current?.removeEventListener('change', onZoomInput);
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.dispose();
      for (const d of disposables) d.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [data]);

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
      />
      <div
        ref={tooltipRef}
        style={{
          display: 'none',
          position: 'absolute',
          pointerEvents: 'none',
          background: 'rgba(0, 0, 0, 0.85)',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '13px',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}
      />
      {/* Controls overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          background: 'rgba(0, 0, 0, 0.75)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '13px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>Zoom:</span>
          <input
            ref={zoomInputRef}
            type="number"
            defaultValue={1}
            min={0.06}
            max={2.73}
            step={0.05}
            style={{
              width: '72px',
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '13px',
              textAlign: 'right',
            }}
          />
          <button
            onClick={() => { autoRotateRef.current = !autoRotateRef.current; }}
            style={{
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            {'\u23F8 / \u25B6'}
          </button>
        </div>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>
          <span ref={coordsRef}>0.0°, 0.0°</span>
        </div>
      </div>
    </div>
  );
}
