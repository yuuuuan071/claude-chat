'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface MountainEffectProps {
  onScatterComplete?: () => void;
  triggerScatter?: boolean;
}

export default function MountainEffect({ onScatterComplete, triggerScatter }: MountainEffectProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef(triggerScatter);
  const onScatterCompleteRef = useRef(onScatterComplete);

  useEffect(() => { triggerRef.current = triggerScatter; }, [triggerScatter]);
  useEffect(() => { onScatterCompleteRef.current = onScatterComplete; }, [onScatterComplete]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 4);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    function buildTerrain(peaks: { x: number; a: number; w: number }[]) {
      const res = 512;
      const h = new Float32Array(res);
      for (let i = 0; i < res; i++) {
        const nx = i / res;
        let v = 0;
        for (const p of peaks) {
          v += p.a * Math.exp(-Math.pow((nx - p.x) / p.w, 2));
        }
        h[i] = Math.min(Math.max(v, 0), 1);
      }
      return h;
    }

    const LAYERS = [
      { col: [0xCD/255, 0xE6/255, 0xDB/255], floorY: -2.28, peakH: 2.00, n: 30000,
        terrain: buildTerrain([{x:0.40,a:0.55,w:0.22},{x:0.72,a:0.70,w:0.20},{x:0.92,a:0.45,w:0.15}]) },
      { col: [0x7F/255, 0xB0/255, 0x98/255], floorY: -2.28, peakH: 2.60, n: 38000,
        terrain: buildTerrain([{x:0.12,a:0.80,w:0.12},{x:0.38,a:0.65,w:0.15},{x:0.65,a:0.50,w:0.13}]) },
      { col: [0x43/255, 0x7B/255, 0x79/255], floorY: -2.28, peakH: 3.50, n: 48000,
        terrain: buildTerrain([{x:0.25,a:0.60,w:0.10},{x:0.55,a:1.0,w:0.12},{x:0.80,a:0.55,w:0.09}]) },
      { col: [0x1A/255, 0x2B/255, 0x34/255], floorY: -2.28, peakH: 2.20, n: 40000,
        terrain: buildTerrain([{x:0.05,a:0.75,w:0.08},{x:0.22,a:0.85,w:0.09},{x:0.45,a:0.70,w:0.08},{x:0.68,a:0.80,w:0.09},{x:0.88,a:0.65,w:0.08}]) },
    ];

    const totalN = LAYERS.reduce((s, l) => s + l.n, 0);
    const allPos = new Float32Array(totalN * 3);
    const allCol = new Float32Array(totalN * 3);

    let offset = 0;
    for (let li = 0; li < LAYERS.length; li++) {
      const L = LAYERS[li];
      let count = 0, tries = 0;
      const [r, g, b] = L.col;
      while (count < L.n && tries < L.n * 12) {
        tries++;
        const nx = Math.random();
        const x = (nx - 0.5) * 12.0;
        const ti = nx * 511;
        const t0 = Math.floor(ti), t1 = Math.min(t0 + 1, 511);
        const tf = ti - t0;
        const h = L.terrain[t0] * (1 - tf) + L.terrain[t1] * tf;
        const topY = L.floorY + h * L.peakH;
        if (topY <= L.floorY + 0.02) continue;
        const range = topY - L.floorY;
        const drop = Math.random();
        const decay = Math.exp(-drop * 2.2);
        if (Math.random() > decay) continue;
        const y = topY - drop * range * 0.85;
        const rel = (topY - y) / range;
        const bottomFade = Math.max(0, 1 - Math.pow(rel * 1.4, 2));
        void bottomFade;
        const z = (Math.random() - 0.5) * 0.04;
        const i = (offset + count) * 3;
        allPos[i] = x; allPos[i+1] = y; allPos[i+2] = z;
        allCol[i]   = Math.min(1, r + (Math.random()-0.5)*0.04);
        allCol[i+1] = Math.min(1, g + (Math.random()-0.5)*0.04);
        allCol[i+2] = Math.min(1, b + (Math.random()-0.5)*0.04);
        count++;
      }
      offset += L.n;
    }

    const budPos = new Float32Array(totalN * 3);
    for (let i = 0; i < totalN; i++) {
      budPos[i*3]   = allPos[i*3]   + (Math.random()-0.5) * 0.5;
      budPos[i*3+1] = allPos[i*3+1] + 1.5 + Math.random() * 1.5;
      budPos[i*3+2] = allPos[i*3+2];
    }

    const curPos = new Float32Array(budPos);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(curPos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(allCol, 3));

    const material = new THREE.PointsMaterial({
      size: 0.007,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const mouseOffsets = new Float32Array(totalN * 3);
    let mouseX = 9999, mouseY = 9999;
    renderer.domElement.addEventListener('mousemove', (e) => {
      const aspect = window.innerWidth / window.innerHeight;
      const halfH = Math.tan(30 * Math.PI / 180) * 4;
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2 * halfH * aspect;
      mouseY = -(e.clientY / window.innerHeight - 0.5) * 2 * halfH;
    });
    renderer.domElement.addEventListener('mouseleave', () => { mouseX = 9999; mouseY = 9999; });

    let startTime: number | null = null;
    let isDone = false;
    let isScattering = false;
    let scatterStart: number | null = null;
    let scatterVels: Float32Array | null = null;
    let scatterDone = false;
    let animId: number;

    function ease(t: number) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
    function easeOut(t: number) { return 1 - Math.pow(1-t, 3); }

    function animate(ts: number) {
      animId = requestAnimationFrame(animate);
      if (!startTime) startTime = ts;

      if (isDone && !isScattering && !scatterDone && triggerRef.current) {
        isScattering = true;
        scatterStart = ts;
        scatterVels = new Float32Array(totalN * 2);
        for (let i = 0; i < totalN; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 0.02 + Math.random() * 0.06;
          scatterVels[i*2]   = Math.cos(a) * sp;
          scatterVels[i*2+1] = Math.sin(a) * sp + 0.005;
        }
      }

      if (isScattering && scatterStart !== null && scatterVels !== null) {
        const prog = Math.min((ts - scatterStart) / 1600, 1);
        const pos = geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < totalN; i++) {
          pos[i*3]   += scatterVels[i*2]   * (1 - prog * 0.5);
          pos[i*3+1] += scatterVels[i*2+1] * (1 - prog * 0.5);
          scatterVels[i*2]   *= 0.96;
          scatterVels[i*2+1] *= 0.96;
        }
        geometry.attributes.position.needsUpdate = true;
        material.opacity = Math.max(0, 1 - easeOut(prog));
        if (prog >= 1 && !scatterDone) {
          scatterDone = true;
          points.visible = false;
          onScatterCompleteRef.current?.();
        }
        renderer.render(scene, camera);
        return;
      }

      const el = ts - startTime;
      if (el < 1500) material.opacity = ease(el / 1500) * 0.3;

      if (el >= 500 && el < 6000) {
        const t = ease(Math.min((el - 500) / 5500, 1));
        material.opacity = 0.3 + t * 0.65;
        const pos = geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < totalN; i++) {
          pos.setX(i, budPos[i*3]   + (allPos[i*3]   - budPos[i*3])   * t);
          pos.setY(i, budPos[i*3+1] + (allPos[i*3+1] - budPos[i*3+1]) * t);
        }
        pos.needsUpdate = true;
      }

      if (el >= 6000) {
        const t = el / 1000;
        const pos = geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < totalN; i++) {
          const phase = i * 0.00731;
          pos[i*3]   = allPos[i*3]   + mouseOffsets[i*3]   + Math.sin(t * 0.5 + phase) * 0.025;
          pos[i*3+1] = allPos[i*3+1] + mouseOffsets[i*3+1] + Math.sin(t * 0.3 + phase * 0.7) * 0.006;
        }
        geometry.attributes.position.needsUpdate = true;
      }

      if (isDone) {
        const pos = geometry.attributes.position.array as Float32Array;
        const radius = 0.5;
        for (let i = 0; i < totalN; i++) {
          const dx = pos[i*3] - mouseX;
          const dy = pos[i*3+1] - mouseY;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < radius && dist > 0.001) {
            const force = (radius - dist) / radius * 0.035;
            mouseOffsets[i*3]   += dx / dist * force;
            mouseOffsets[i*3+1] += dy / dist * force;
          }
          mouseOffsets[i*3]   *= 0.93;
          mouseOffsets[i*3+1] *= 0.93;
        }
      }

      if (el >= 6500 && !isDone) isDone = true;
      renderer.render(scene, camera);
    }

    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={mountRef} style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#F2F0E4' }} />
  );
}
