'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GlobeResponse, GlobeMinistry } from '@/app/api/map/globe/route';

const SPHERE_RADIUS = 1;
const ICO_SUBDIVISIONS = 6; // 20 * 4^6 = 81,920 faces

// ─── Icosphere generation ───────────────────────────────────────────

interface IcoSphere {
  vertices: Float32Array;  // flat xyz array
  indices: Uint32Array;    // triangle indices
  faceCount: number;
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

  return {
    vertices,
    indices: new Uint32Array(faces),
    faceCount: faces.length / 3,
  };
}

// ─── Face → Ministry assignment ─────────────────────────────────────
// 緯度帯で北極→南極の順に面積比例で割り当て

function assignFaces(
  ico: IcoSphere,
  ministries: GlobeMinistry[],
): Int32Array {
  const { vertices, indices, faceCount } = ico;
  const assignment = new Int32Array(faceCount);

  // Compute centroid Y (latitude) for each face and sort by it (north→south)
  const faceOrder: number[] = [];
  const faceCentroidY = new Float32Array(faceCount);

  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
    faceCentroidY[f] = (vertices[i0*3+1] + vertices[i1*3+1] + vertices[i2*3+1]) / 3;
    faceOrder.push(f);
  }

  // Sort faces from north pole (Y=+1) to south pole (Y=-1)
  faceOrder.sort((a, b) => faceCentroidY[b] - faceCentroidY[a]);

  // Assign contiguous bands to ministries (sorted by spending, largest first)
  let cursor = 0;
  for (let m = 0; m < ministries.length; m++) {
    const count = m < ministries.length - 1
      ? Math.round(ministries[m].areaFraction * faceCount)
      : faceCount - cursor; // Last ministry gets remainder
    const end = Math.min(cursor + count, faceCount);
    for (let i = cursor; i < end; i++) {
      assignment[faceOrder[i]] = m;
    }
    cursor = end;
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

    // Labels — position at the northern boundary (highest Y face) of each ministry
    const labelGroup = new THREE.Group();
    scene.add(labelGroup);
    if (data) {
      const nonIdxPos = nonIndexedGeom.getAttribute('position');
      // Find the highest-Y face centroid for each ministry
      const maxY = new Float32Array(data.ministries.length).fill(-Infinity);
      const labelPositions: THREE.Vector3[] = data.ministries.map(() => new THREE.Vector3());

      for (let f = 0; f < ico.faceCount; f++) {
        const mi = faceAssignment[f];
        const v = f * 3;
        const cy = (nonIdxPos.getY(v) + nonIdxPos.getY(v+1) + nonIdxPos.getY(v+2)) / 3;
        if (cy > maxY[mi]) {
          maxY[mi] = cy;
          labelPositions[mi].set(
            (nonIdxPos.getX(v) + nonIdxPos.getX(v+1) + nonIdxPos.getX(v+2)) / 3,
            cy,
            (nonIdxPos.getZ(v) + nonIdxPos.getZ(v+1) + nonIdxPos.getZ(v+2)) / 3,
          );
        }
      }

      for (let mi = 0; mi < data.ministries.length; mi++) {
        if (maxY[mi] === -Infinity) continue;
        labelPositions[mi].normalize().multiplyScalar(SPHERE_RADIUS + 0.03);

        const label = createTextSprite(data.ministries[mi].name);
        label.position.copy(labelPositions[mi]);
        labelGroup.add(label);
      }
    }

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableRotate = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: undefined as unknown as THREE.MOUSE,
    };
    controls.minDistance = SPHERE_RADIUS + camera.near; // 1.1 — prevents near-plane clipping
    controls.maxDistance = 50;
    controls.rotateSpeed = 0.5;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

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

      globeMesh.rotation.y += delta * 0.05;
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
      {/* Zoom controls */}
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
          alignItems: 'center',
          gap: '8px',
          zIndex: 10,
        }}
      >
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
      </div>
    </div>
  );
}
