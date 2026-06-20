'use client';
import { useEffect, useRef } from 'react';

export default function CodeRainTransition({ active, onComplete }: { active: boolean; onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const fontSize = 14;
    const cols = Math.floor(canvas.width / fontSize);
    const drops: number[] = Array(cols).fill(1);
    const chars = '01';

    let opacity = 0;
    let animId: number;
    let completed = false;
    let startTime: number | null = null;

    function draw(ts: number) {
      if (!startTime) startTime = ts;
      const elapsed = (ts - startTime) / 1000;

      opacity = Math.min(1, elapsed / 0.8);

      ctx.fillStyle = `rgba(8, 12, 20, ${0.12 + opacity * 0.1})`;
      ctx.fillRect(0, 0, canvas!.width, canvas!.height);

      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const brightness = Math.random() > 0.95 ? '255, 255, 255' : '180, 200, 220';
        ctx.fillStyle = `rgba(${brightness}, ${opacity * 0.85})`;
        ctx.fillText(char, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas!.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }

      if (elapsed > 1.5 && !completed) {
        completed = true;
        onComplete();
      }

      animId = requestAnimationFrame(draw);
    }

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        pointerEvents: 'none',
      }}
    />
  );
}
