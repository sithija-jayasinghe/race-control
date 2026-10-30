import { useEffect, useRef } from 'react';
import type { FlagStatus } from '@/components/status-flag';
import type { TrackModel } from '@/lib/track-model';

// The live codebase map (docs/design/pit-wall-prototype.html): folders are glowing clusters, files
// are points, and each agent is an orb that flies to the file it last touched, leaving a light trail.

const COLORS: Record<FlagStatus, string> = {
  working: '#3ddc84',
  yellow: '#ffc53d',
  waiting: '#4c9aff',
  blocked: '#ff5a5f',
  idle: '#8a8f98',
};
const CLUSTER_HUES = ['#7c8cff', '#b57cff', '#4fd1e8', '#6ea8ff', '#e07cff', '#7cffb8', '#ffb47c', '#ff7cc8'];

type P3 = { x: number; y: number; z: number };
type Agent = { pos: P3; trail: P3[]; phase: number; status: FlagStatus; screen?: { x: number; y: number; s: number } };

/** A stable pseudo-random number in [0, 1) for a string and a salt, so layouts don't jump between renders. */
function hash(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

type Props = {
  model: TrackModel;
  selectedId?: string;
  onSelect?: (driverId: string | undefined) => void;
  /** Pause drawing, e.g. while the tab is hidden. */
  paused?: boolean;
};

export function TrackMap({ model, selectedId, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef(model);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  modelRef.current = model;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const agents = new Map<string, Agent>();
    const shocks: Array<{ at: P3; t: number; color: string }> = [];
    const dust = Array.from({ length: 160 }, (_, i) => ({
      x: (hash(`d${i}`, 1) - 0.5) * 1400,
      y: (hash(`d${i}`, 2) - 0.5) * 500 - 40,
      z: (hash(`d${i}`, 3) - 0.5) * 1400,
      v: 0.02 + hash(`d${i}`, 4) * 0.05,
    }));
    let width = 0;
    let height = 0;
    let yaw = 0.6;
    let targetYaw = 0.6;
    let frame = 0;
    let last = performance.now();
    let hoverId: string | undefined;
    let dragging = false;
    let dragX = 0;
    let dragMoved = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = (p: P3) => {
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const pitch = 0.42;
      const x1 = p.x * cy - p.z * sy;
      const z1 = p.x * sy + p.z * cy;
      const y2 = p.y * Math.cos(pitch) - z1 * Math.sin(pitch);
      const z2 = p.y * Math.sin(pitch) + z1 * Math.cos(pitch);
      const s = (900 / (900 + z2 + 520)) * Math.min(width / 760, height / 560);
      return { x: width / 2 + 40 + x1 * s, y: height / 2 + 30 + y2 * s, s, z: z2 };
    };

    const glow = (x: number, y: number, r: number, color: string, alpha: number) => {
      if (r <= 0) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hexA(color, alpha));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    /** Positions for the current model: clusters on a ring, files around their cluster. */
    const layout = () => {
      const { clusters, files } = modelRef.current;
      const centers = new Map<string, P3 & { hue: string; label: string }>();
      clusters.forEach((c, i) => {
        const a = (i / Math.max(clusters.length, 1)) * Math.PI * 2 + 0.4;
        const r = clusters.length === 1 ? 0 : 290;
        centers.set(c.id, {
          x: Math.cos(a) * r,
          y: (hash(c.id, 7) - 0.5) * 90,
          z: Math.sin(a) * r,
          hue: CLUSTER_HUES[i % CLUSTER_HUES.length]!,
          label: c.label,
        });
      });
      const points = new Map<string, P3 & { clusterId: string; lastAt: number }>();
      for (const f of files) {
        const c = centers.get(f.clusterId);
        if (!c) continue;
        const t = hash(f.id, 1) * Math.PI * 2;
        const p = Math.acos(2 * hash(f.id, 2) - 1);
        const r = 55 + hash(f.id, 3) * 50;
        points.set(f.id, {
          x: c.x + r * Math.sin(p) * Math.cos(t),
          y: c.y + r * Math.cos(p) * 0.7,
          z: c.z + r * Math.sin(p) * Math.sin(t),
          clusterId: f.clusterId,
          lastAt: f.lastAt,
        });
      }
      return { centers, points };
    };

    const draw = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      if (!still && !dragging) targetYaw += 0.00008 * dt;
      yaw += (targetYaw - yaw) * (still ? 1 : 0.06);
      const { centers, points } = layout();
      const { drivers } = modelRef.current;

      ctx.clearRect(0, 0, width, height);

      // Grid floor and drifting dust.
      ctx.lineWidth = 1;
      for (let i = -10; i <= 10; i++) {
        for (const [a, b] of [
          [{ x: i * 70, y: 175, z: -700 }, { x: i * 70, y: 175, z: 700 }],
          [{ x: -700, y: 175, z: i * 70 }, { x: 700, y: 175, z: i * 70 }],
        ] as const) {
          const pa = project(a);
          const pb = project(b);
          ctx.strokeStyle = `rgba(140,150,255,${0.08 * (1 - Math.abs(i) / 11)})`;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }
      for (const d of dust) {
        if (!still) d.y -= d.v * dt * 0.05;
        if (d.y < -300) d.y = 200;
        const p = project(d);
        ctx.fillStyle = `rgba(180,190,255,${Math.min(0.3, 0.12 * p.s)})`;
        ctx.fillRect(p.x, p.y, 1.4 * p.s, 1.4 * p.s);
      }

      // Clusters, their files and labels.
      ctx.globalCompositeOperation = 'lighter';
      const wallNow = Date.now();
      for (const [, c] of centers) {
        const pc = project(c);
        glow(pc.x, pc.y, 150 * pc.s, c.hue, 0.08);
        glow(pc.x, pc.y, 40 * pc.s, c.hue, 0.1);
      }
      for (const [, f] of points) {
        const c = centers.get(f.clusterId)!;
        const heat = Math.max(0, 1 - (wallNow - f.lastAt) / 60_000);
        const pc = project(c);
        const pf = project(f);
        ctx.strokeStyle = hexA(c.hue, 0.1 + heat * 0.5);
        ctx.lineWidth = 1 + heat * 1.5;
        ctx.beginPath();
        ctx.moveTo(pc.x, pc.y);
        ctx.lineTo(pf.x, pf.y);
        ctx.stroke();
        glow(pf.x, pf.y, (10 + heat * 26) * pf.s, c.hue, 0.25 + heat * 0.45);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const [, f] of points) {
        const pf = project(f);
        ctx.fillStyle = 'rgba(230,234,255,0.7)';
        ctx.beginPath();
        ctx.arc(pf.x, pf.y, 2.4 * pf.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.textAlign = 'center';
      for (const [, c] of centers) {
        const pc = project(c);
        ctx.fillStyle = hexA(c.hue, 0.8);
        ctx.font = `500 ${12 * Math.max(0.85, pc.s)}px 'Geist Mono Variable', monospace`;
        ctx.fillText(`${c.label}/`, pc.x, pc.y + 130 * pc.s);
      }

      // Agents: fly towards their file, leave a trail, glow in their flag colour.
      const seen = new Set<string>();
      ctx.globalCompositeOperation = 'lighter';
      drivers.forEach((d, i) => {
        seen.add(d.id);
        const home = d.fileId ? points.get(d.fileId) : d.clusterId ? centers.get(d.clusterId) : undefined;
        const goalBase = home ?? { x: -260 + i * 60, y: 140, z: 320 };
        let agent = agents.get(d.id);
        if (!agent) {
          agent = { pos: { x: goalBase.x, y: goalBase.y - 60, z: goalBase.z }, trail: [], phase: hash(d.id, 9) * 6, status: d.status };
          agents.set(d.id, agent);
        }
        if (agent.status !== d.status && (d.status === 'yellow' || d.status === 'blocked')) {
          shocks.push({ at: { ...goalBase }, t: 0, color: COLORS[d.status] });
        }
        agent.status = d.status;
        agent.phase += dt / 900;
        const orbit = d.status === 'working' || d.status === 'yellow' ? 18 : 6;
        const goal = {
          x: goalBase.x + Math.cos(agent.phase) * orbit,
          y: goalBase.y - 26 + Math.sin(agent.phase * 1.3) * 6,
          z: goalBase.z + Math.sin(agent.phase) * orbit,
        };
        const k = still ? 1 : 0.05;
        agent.pos.x += (goal.x - agent.pos.x) * k;
        agent.pos.y += (goal.y - agent.pos.y) * k;
        agent.pos.z += (goal.z - agent.pos.z) * k;
        if (!still) {
          agent.trail.push({ ...agent.pos });
          if (agent.trail.length > 80) agent.trail.shift();
        }
        const col = COLORS[d.status];
        for (let j = 1; j < agent.trail.length; j++) {
          const p0 = project(agent.trail[j - 1]!);
          const p1 = project(agent.trail[j]!);
          ctx.strokeStyle = hexA(col, (j / agent.trail.length) * 0.55);
          ctx.lineWidth = (j / agent.trail.length) * 4 * p1.s;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        const p = project(agent.pos);
        agent.screen = p;
        if (home) {
          const ph = project(home);
          ctx.setLineDash([3 * p.s, 5 * p.s]);
          ctx.strokeStyle = hexA(col, 0.5);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(ph.x, ph.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const pulse = d.status === 'waiting' || d.status === 'blocked' ? 0.6 + 0.4 * Math.sin(now / 220) : 1;
        glow(p.x, p.y, 70 * p.s * pulse, col, d.status === 'idle' ? 0.12 : 0.3);
        glow(p.x, p.y, 26 * p.s, col, d.status === 'idle' ? 0.2 : 0.5);
        if (d.status === 'waiting') {
          const beam = ctx.createLinearGradient(p.x, p.y, p.x, p.y - 260 * p.s);
          beam.addColorStop(0, hexA(col, 0.5));
          beam.addColorStop(1, hexA(col, 0));
          ctx.fillStyle = beam;
          ctx.fillRect(p.x - 2 * p.s, p.y - 260 * p.s, 4 * p.s, 260 * p.s);
        }
      });
      for (const id of agents.keys()) if (!seen.has(id)) agents.delete(id);

      // Shockwaves when an agent gets a yellow or black flag.
      for (let i = shocks.length - 1; i >= 0; i--) {
        const s = shocks[i]!;
        s.t += dt / 1400;
        const p = project(s.at);
        ctx.strokeStyle = hexA(s.color, Math.max(0, 1 - s.t) * 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 90 * s.t * p.s, 40 * s.t * p.s, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (s.t >= 1) shocks.splice(i, 1);
      }
      ctx.globalCompositeOperation = 'source-over';

      // Orb faces with driver codes, and the file of busy, selected or hovered agents.
      for (const d of drivers) {
        const a = agents.get(d.id);
        if (!a?.screen) continue;
        const { x, y, s } = a.screen;
        const r = 15 * s;
        ctx.fillStyle = '#12151b';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLORS[d.status];
        ctx.lineWidth = d.id === selectedRef.current || d.id === hoverId ? 2.6 : 1.8;
        ctx.stroke();
        ctx.fillStyle = '#eceef2';
        ctx.font = `italic 700 ${10 * s}px 'Titillium Web', sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(d.code, x, y + 0.5);
        ctx.textBaseline = 'alphabetic';
        if (d.fileId && (d.id === selectedRef.current || d.id === hoverId || d.status !== 'working')) {
          const path = d.fileId.split(':').slice(1).join(':');
          ctx.fillStyle = 'rgba(236,238,242,0.6)';
          ctx.font = `${10.5 * Math.max(0.85, s)}px 'Geist Mono Variable', monospace`;
          ctx.fillText(path, x, y + r + 16);
        }
      }

      frame = requestAnimationFrame(draw);
    };

    const agentAt = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      for (const d of modelRef.current.drivers) {
        const s = agents.get(d.id)?.screen;
        if (s && Math.hypot(s.x - x, s.y - y) < 22) return d;
      }
      return undefined;
    };

    // The canvas sits behind the page's glass panels, so listen on the window and ignore events on panels.
    const onBackground = (e: PointerEvent) => e.target === canvas || (e.target as HTMLElement | null)?.dataset.trackPassThrough === '';
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        if (Math.abs(e.clientX - dragX) > 3) dragMoved = true;
        targetYaw += (e.clientX - dragX) * 0.004;
        dragX = e.clientX;
        return;
      }
      const hit = onBackground(e) ? agentAt(e.clientX, e.clientY) : undefined;
      hoverId = hit?.id;
      canvas.style.cursor = hit ? 'pointer' : '';
      const tip = tipRef.current;
      if (tip) {
        tip.style.opacity = hit ? '1' : '0';
        if (hit) {
          tip.textContent = `${hit.name} · ${hit.lastAction ?? ''}`;
          tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
        }
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!onBackground(e)) return;
      dragging = true;
      dragMoved = false;
      dragX = e.clientX;
    };
    const onUp = (e: PointerEvent) => {
      if (dragging && !dragMoved && onBackground(e)) onSelectRef.current?.(agentAt(e.clientX, e.clientY)?.id);
      dragging = false;
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} aria-hidden="true" className="fixed inset-0 -z-10 hidden size-full touch-none md:block" />
      <div
        ref={tipRef}
        aria-hidden="true"
        className="glass pointer-events-none fixed top-0 left-0 z-30 rounded-lg px-2.5 py-1.5 font-mono text-xs opacity-0 transition-opacity"
      />
    </>
  );
}
