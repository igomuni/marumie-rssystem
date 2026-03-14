'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GlobeResponse } from '@/app/api/map/globe/route';

const SPHERE_RADIUS = 1;
const MARKER_RADIUS = 1.01; // Slightly above sphere surface

/**
 * Convert lat/lon (degrees) to 3D position on sphere
 */
function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

/**
 * Format yen amount for display
 */
function formatYen(amount: number): string {
  if (amount >= 1_000_000_000_000) return `${(amount / 1_000_000_000_000).toFixed(2)}兆円`;
  if (amount >= 100_000_000) return `${(amount / 100_000_000).toFixed(0)}億円`;
  if (amount >= 10_000) return `${(amount / 10_000).toFixed(0)}万円`;
  return `${amount}円`;
}

/**
 * Create a text sprite (billboard label) for a ministry marker
 */
function createTextSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 512;
  canvas.height = 128;

  ctx.fillStyle = color;
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

interface GlobeViewProps {
  data?: GlobeResponse | null;
}

export default function GlobeView({ data }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');

    // Camera
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 3);

    // Renderer
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

    // Globe sphere
    const sphereGeom = new THREE.SphereGeometry(SPHERE_RADIUS, 64, 64);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: '#0a1628',
      roughness: 0.9,
      metalness: 0.05,
    });
    const sphere = new THREE.Mesh(sphereGeom, sphereMat);
    scene.add(sphere);

    // Wireframe grid
    const wireGeom = new THREE.SphereGeometry(SPHERE_RADIUS + 0.001, 36, 18);
    const wireframe = new THREE.WireframeGeometry(wireGeom);
    const wireMat = new THREE.LineBasicMaterial({
      color: '#1a3050',
      opacity: 0.2,
      transparent: true,
    });
    const wireLines = new THREE.LineSegments(wireframe, wireMat);
    scene.add(wireLines);

    // Group for markers (rotates with globe)
    const markersGroup = new THREE.Group();
    scene.add(markersGroup);

    // Track marker meshes for raycasting
    const markerMeshes: THREE.Mesh[] = [];
    const markerData: { name: string; spending: number; projectCount: number }[] = [];
    const disposables: { dispose: () => void }[] = [sphereGeom, sphereMat, wireGeom, wireMat];

    // Add ministry markers if data available
    if (data) {
      for (const ministry of data.ministries) {
        const pos = latLonToVec3(ministry.centroid[0], ministry.centroid[1], MARKER_RADIUS);

        // Marker dot — size proportional to area fraction
        const dotSize = Math.max(0.01, Math.sqrt(ministry.areaFraction) * 0.15);
        const dotGeom = new THREE.SphereGeometry(dotSize, 16, 16);
        const dotMat = new THREE.MeshStandardMaterial({
          color: ministry.color,
          emissive: ministry.color,
          emissiveIntensity: 0.5,
        });
        const dot = new THREE.Mesh(dotGeom, dotMat);
        dot.position.copy(pos);
        markersGroup.add(dot);
        markerMeshes.push(dot);
        markerData.push({
          name: ministry.name,
          spending: ministry.totalSpending,
          projectCount: ministry.projectCount,
        });
        disposables.push(dotGeom, dotMat);

        // Label sprite (positioned above the dot)
        const labelPos = latLonToVec3(
          ministry.centroid[0],
          ministry.centroid[1],
          MARKER_RADIUS + dotSize + 0.03
        );
        const label = createTextSprite(ministry.name, ministry.color);
        label.position.copy(labelPos);
        markersGroup.add(label);
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
    controls.minDistance = 1.5;
    controls.maxDistance = 10;
    controls.rotateSpeed = 0.5;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Raycaster for hover detection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    function onMouseMove(event: MouseEvent) {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(markerMeshes);

      const tooltip = tooltipRef.current;
      if (!tooltip) return;

      if (intersects.length > 0) {
        const idx = markerMeshes.indexOf(intersects[0].object as THREE.Mesh);
        if (idx >= 0) {
          const d = markerData[idx];
          tooltip.textContent = `${d.name}  ${formatYen(d.spending)}  (${d.projectCount}事業)`;
          tooltip.style.display = 'block';
          tooltip.style.left = `${event.clientX - rect.left + 12}px`;
          tooltip.style.top = `${event.clientY - rect.top - 8}px`;
          container.style.cursor = 'pointer';
          return;
        }
      }
      tooltip.style.display = 'none';
      container.style.cursor = 'grab';
    }
    container.addEventListener('mousemove', onMouseMove);

    // Click handler — log to console
    function onClick(event: MouseEvent) {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(markerMeshes);
      if (intersects.length > 0) {
        const idx = markerMeshes.indexOf(intersects[0].object as THREE.Mesh);
        if (idx >= 0) {
          const d = markerData[idx];
          console.log(`[Globe] ${d.name}: ${formatYen(d.spending)} (${d.projectCount}事業)`);
        }
      }
    }
    container.addEventListener('click', onClick);

    // Animation loop
    let animationId: number;
    const clock = new THREE.Clock();

    function animate() {
      animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      // Slow auto-rotation
      sphere.rotation.y += delta * 0.05;
      wireLines.rotation.y = sphere.rotation.y;
      markersGroup.rotation.y = sphere.rotation.y;

      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    function onResize() {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', onResize);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('click', onClick);
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
    </div>
  );
}
