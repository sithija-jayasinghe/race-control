import { useEffect, useRef } from 'react';

type Point = { x: number; y: number; z: number };

/**
 * The ambient scene behind every page: a perspective grid floor with drifting particles, slowly turning.
 * In Week 3 the live codebase map is drawn into this same scene.
 */
export function TrackScene() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dust: Array<Point & { v: number }> = Array.from({ length: 160 }, () => ({
      x: (Math.random() - 0.5) * 1400,
      y: (Math.random() - 0.5) * 500 - 40,
      z: (Math.random() - 0.5) * 1400,
      v: 0.02 + Math.random() * 0.05,
    }));
    let width = 0;
    let height = 0;
    let yaw = 0.6;
    let frame = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = (p: Point) => {
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const pitch = 0.42;
      const x1 = p.x * cy - p.z * sy;
      const z1 = p.x * sy + p.z * cy;
      const y2 = p.y * Math.cos(pitch) - z1 * Math.sin(pitch);
      const z2 = p.y * Math.sin(pitch) + z1 * Math.cos(pitch);
      const s = (900 / (900 + z2 + 520)) * Math.min(width / 760, height / 520);
      return { x: width / 2 + x1 * s, y: height / 2 + y2 * s, s };
    };

    const draw = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      if (!still) yaw += 0.00012 * dt;

      const styles = getComputedStyle(canvas);
      const scene = styles.getPropertyValue('--scene').trim() || '#0d1017';
      const grid = styles.getPropertyValue('--scene-grid').trim() || 'rgba(140,150,255,0.07)';

      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createRadialGradient(width / 2, height * 0.45, 0, width / 2, height * 0.45, Math.max(width, height) * 0.7);
      bg.addColorStop(0, scene);
      bg.addColorStop(1, 'transparent');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      for (let i = -10; i <= 10; i++) {
        for (const [a, b] of [
          [{ x: i * 70, y: 175, z: -700 }, { x: i * 70, y: 175, z: 700 }],
          [{ x: -700, y: 175, z: i * 70 }, { x: 700, y: 175, z: i * 70 }],
        ] as const) {
          const pa = project(a);
          const pb = project(b);
          ctx.globalAlpha = 1 - Math.abs(i) / 11;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }

      ctx.fillStyle = grid;
      for (const d of dust) {
        if (!still) d.y -= d.v * dt * 0.05;
        if (d.y < -300) d.y = 200;
        const p = project(d);
        ctx.globalAlpha = Math.min(1, 2.5 * p.s);
        ctx.fillRect(p.x, p.y, 1.6 * p.s, 1.6 * p.s);
      }
      ctx.globalAlpha = 1;

      if (!still) frame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 size-full" />;
}
