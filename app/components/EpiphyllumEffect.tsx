'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface EpiphyllumProps {
  onAnimationComplete?: () => void;
}

export default function EpiphyllumEffect({ onAnimationComplete }: EpiphyllumProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(1.5, 2.5, 5.5);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    function bezier3(p0: number, p1: number, p2: number, p3: number, t: number) {
      const mt = 1 - t;
      return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3;
    }

    function generateCurvedPetal(
      baseAngle: number,
      petalLen: number,
      petalWid: number,
      startR: number,
      startH: number,
      endH: number,
      inwardCurl: number,
      count: number
    ): number[] {
      const pts: number[] = [];
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const r = startR + t * petalLen;
        const h = bezier3(startH, startH + (endH - startH) * 0.3, startH + (endH - startH) * 0.7, endH, t);
        const inward = inwardCurl * t * t;
        const w = petalWid * Math.sin(t * Math.PI);
        const across = (Math.random() - 0.5) * w;
        const angle = baseAngle + across / (startR + t * petalLen * 0.5);
        const actualR = r - inward;
        pts.push(
          Math.cos(angle) * actualR,
          h + (Math.random() - 0.5) * 0.008,
          Math.sin(angle) * actualR
        );
      }
      return pts;
    }

    function generateStamen(): number[] {
      const pts: number[] = [];
      for (let i = 0; i < 800; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.10;
        const h = 0.1 + Math.random() * 0.6;
        pts.push(Math.cos(angle) * (r + h * 0.15), h, Math.sin(angle) * (r + h * 0.15));
      }
      return pts;
    }

    function generateInnerPetals(): number[] {
      const pts: number[] = [];
      const count = 16;
      for (let p = 0; p < count; p++) {
        const baseAngle = (p / count) * Math.PI * 2;
        pts.push(...generateCurvedPetal(baseAngle, 0.75, 0.2, 0.18, 0.05, 0.9, 0.25, 400));
      }
      return pts;
    }

    function generateMidPetals(): number[] {
      const pts: number[] = [];
      const count = 12;
      for (let p = 0; p < count; p++) {
        const baseAngle = (p / count) * Math.PI * 2 + Math.PI / count;
        pts.push(...generateCurvedPetal(baseAngle, 1.0, 0.28, 0.35, 0.0, 0.75, 0.3, 450));
      }
      return pts;
    }

    function generateOuterPetals(): number[] {
      const pts: number[] = [];
      const count = 14;
      for (let p = 0; p < count; p++) {
        const baseAngle = (p / count) * Math.PI * 2 + 0.1;
        pts.push(...generateCurvedPetal(baseAngle, 1.3, 0.12, 0.55, 0.05, -0.1, 0.0, 400));
      }
      return pts;
    }

    function generateSepals(): number[] {
      const pts: number[] = [];
      const count = 10;
      for (let p = 0; p < count; p++) {
        const baseAngle = (p / count) * Math.PI * 2 + Math.PI / count;
        pts.push(...generateCurvedPetal(baseAngle, 1.5, 0.05, 0.6, -0.05, -0.4, 0.0, 200));
      }
      return pts;
    }

    const stamenPts = generateStamen();
    const innerPts = generateInnerPetals();
    const midPts = generateMidPetals();
    const outerPts = generateOuterPetals();
    const sepalPts = generateSepals();

    const totalPts = (stamenPts.length + innerPts.length + midPts.length + outerPts.length + sepalPts.length) / 3;
    const allPos = new Float32Array(totalPts * 3);
    const allCol = new Float32Array(totalPts * 3);

    let offset = 0;
    function fillGroup(pts: number[], r: number, g: number, b: number, v: number) {
      const n = pts.length / 3;
      for (let i = 0; i < pts.length; i++) allPos[offset * 3 + i] = pts[i];
      for (let i = 0; i < n; i++) {
        allCol[(offset + i) * 3]     = Math.min(1, r + (Math.random() - 0.5) * v);
        allCol[(offset + i) * 3 + 1] = Math.min(1, g + (Math.random() - 0.5) * v);
        allCol[(offset + i) * 3 + 2] = Math.min(1, b + (Math.random() - 0.5) * v);
      }
      offset += n;
    }

    fillGroup(stamenPts, 0.95, 0.85, 0.30, 0.08);
    fillGroup(innerPts,  0.98, 0.97, 0.94, 0.03);
    fillGroup(midPts,    0.97, 0.96, 0.93, 0.03);
    fillGroup(outerPts,  0.96, 0.95, 0.91, 0.03);
    fillGroup(sepalPts,  0.78, 0.60, 0.62, 0.06);

    const budPos = new Float32Array(totalPts * 3);
    for (let i = 0; i < totalPts; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.05;
      budPos[i * 3]     = Math.cos(a) * r;
      budPos[i * 3 + 1] = 0.4 + Math.random() * 0.1;
      budPos[i * 3 + 2] = Math.sin(a) * r;
    }

    const currentPos = new Float32Array(budPos);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(currentPos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(allCol, 3));

    const material = new THREE.PointsMaterial({
      size: 0.016,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
    });

    const particles = new THREE.Points(geometry, material);
    particles.rotation.y = 0.6;
    particles.rotation.x = 0.8;
    scene.add(particles);

    let startTime: number | null = null;
    let animId: number;
    let completed = false;

    function ease(t: number) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

    function animate(ts: number) {
      if (!startTime) startTime = ts;
      const el = (ts - startTime) / 1000;

      // 绽放完成后只保留转动
      if (el >= 8.5) {
        if (!completed) { completed = true; onAnimationComplete?.(); }
        particles.rotation.y = 0.6 + (el - 2.0) * 0.025;
        particles.rotation.x = 0.8;
        renderer.render(scene, camera);
        animId = requestAnimationFrame(animate);
        return;
      }

      if (el >= 0.3 && el < 2.0) material.opacity = ease((el - 0.3) / 1.7) * 0.35;

      if (el >= 2.0 && el < 7.0) {
        const t = ease((el - 2.0) / 5.0);
        material.opacity = 0.35 + t * 0.6;
        const pos = geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < totalPts; i++) {
          pos.setX(i, budPos[i * 3]     + (allPos[i * 3]     - budPos[i * 3])     * t);
          pos.setY(i, budPos[i * 3 + 1] + (allPos[i * 3 + 1] - budPos[i * 3 + 1]) * t);
          pos.setZ(i, budPos[i * 3 + 2] + (allPos[i * 3 + 2] - budPos[i * 3 + 2]) * t);
        }
        pos.needsUpdate = true;
      }

      if (el > 2.0) {
        particles.rotation.y = 0.6 + (el - 2.0) * 0.025;
        particles.rotation.x = 0.8;
      }

      renderer.render(scene, camera);
      animId = requestAnimationFrame(animate);
    }
    animId = requestAnimationFrame(animate);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [onAnimationComplete]);

  return (
    <div ref={mountRef} style={{ position: 'fixed', inset: 0, zIndex: 0, background: 'linear-gradient(180deg, #080c14 0%, #0d1525 60%, #060a10 100%)' }} />
  );
}