'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default function GlobeView() {
  const containerRef = useRef<HTMLDivElement>(null);

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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight1.position.set(5, 3, 5);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.2);
    dirLight2.position.set(-3, -2, -3);
    scene.add(dirLight2);

    // Globe sphere
    const sphereGeom = new THREE.SphereGeometry(1, 64, 64);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: '#1a3a5c',
      roughness: 0.8,
      metalness: 0.1,
    });
    const sphere = new THREE.Mesh(sphereGeom, sphereMat);
    scene.add(sphere);

    // Wireframe grid (latitude/longitude lines)
    const wireGeom = new THREE.SphereGeometry(1.002, 36, 18);
    const wireframe = new THREE.WireframeGeometry(wireGeom);
    const wireMat = new THREE.LineBasicMaterial({
      color: '#4a8ab5',
      opacity: 0.3,
      transparent: true,
    });
    const wireLines = new THREE.LineSegments(wireframe, wireMat);
    scene.add(wireLines);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 1.5;
    controls.maxDistance = 10;
    controls.rotateSpeed = 0.5;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Animation loop
    let animationId: number;
    const clock = new THREE.Clock();

    function animate() {
      animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      // Slow auto-rotation
      sphere.rotation.y += delta * 0.05;
      wireLines.rotation.y = sphere.rotation.y;

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
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.dispose();
      sphereGeom.dispose();
      sphereMat.dispose();
      wireGeom.dispose();
      wireMat.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: '#000' }}
    />
  );
}
