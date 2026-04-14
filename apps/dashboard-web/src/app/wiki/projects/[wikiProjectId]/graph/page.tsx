"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { apiGet } from "@/lib/http";
import { useToast } from "@/components/ui/toast";

type GraphNode = {
  id: string;
  kind: "page" | "external";
  label?: string;
  path?: string;
  type?: string;
  tags?: string[];
};

type GraphEdge = {
  source: string;
  target: string;
  type: string;
};

type SimNode = GraphNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

function colorForNode(n: GraphNode) {
  if (n.kind === "external") return "#94a3b8";
  const t = (n.type || "").toLowerCase();
  if (t === "entity") return "#60a5fa";
  if (t === "concept") return "#34d399";
  if (t === "comparison") return "#fb923c";
  if (t === "query") return "#c084fc";
  return "#a78bfa";
}

function pickNodeAt(nodes: SimNode[], x: number, y: number) {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const n = nodes[i];
    const r = n.kind === "external" ? 7 : 9;
    const dx = n.x - x;
    const dy = n.y - y;
    if (dx * dx + dy * dy <= r * r) return n;
  }
  return null;
}

function ellipsize(text: string, maxChars: number) {
  const t = String(text || "");
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

export default function WikiGraphPage() {
  const { toast } = useToast();
  const params = useParams<{ wikiProjectId: string }>();
  const wikiProjectId = useMemo(() => decodeURIComponent(params.wikiProjectId), [params.wikiProjectId]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const byIdRef = useRef<Map<string, SimNode>>(new Map());
  const linksRef = useRef<{ a: SimNode; b: SimNode }[]>([]);
  const hoverRef = useRef<SimNode | null>(null);
  const dragRef = useRef<{ node: SimNode | null; dx: number; dy: number }>({ node: null, dx: 0, dy: 0 });
  const sizeRef = useRef<{ width: number; height: number; centerX: number; centerY: number }>({
    width: 900,
    height: 640,
    centerX: 450,
    centerY: 320,
  });

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [includeExternal, setIncludeExternal] = useState(false);
  const [q, setQ] = useState("");
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; nodes: GraphNode[]; edges: GraphEdge[] }>(
        `/api/v1/wiki_projects/${encodeURIComponent(wikiProjectId)}/graph?includeExternal=${includeExternal ? "1" : "0"}`
      );
      setGraph({ nodes: r.nodes || [], edges: r.edges || [] });
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikiProjectId, includeExternal]);

  useEffect(() => {
    const es = new EventSource(`/api/v1/wiki_projects/${encodeURIComponent(wikiProjectId)}/stream`);
    es.addEventListener("changed", () => load());
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikiProjectId, includeExternal]);

  // Build simulation state whenever the underlying graph changes (not on hover).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    const width = Math.max(640, parent?.clientWidth || 900);
    const height = 640;
    sizeRef.current = { width, height, centerX: width / 2, centerY: height / 2 };

    const qq = q.trim().toLowerCase();
    const nodesRaw = graph.nodes.filter((n) => {
      if (!qq) return true;
      const hay = `${n.label || ""} ${n.path || ""} ${(n.tags || []).join(" ")}`.toLowerCase();
      return hay.includes(qq);
    });
    const nodeSet = new Set(nodesRaw.map((n) => n.id));
    const edges = graph.edges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target));

    const { centerX, centerY } = sizeRef.current;
    const nodes: SimNode[] = nodesRaw.map((n, i) => {
      const angle = (i / Math.max(1, nodesRaw.length)) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.28;
      return {
        ...n,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });

    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const links = edges
      .map((e) => ({ a: byId.get(e.source) || null, b: byId.get(e.target) || null }))
      .filter((l) => l.a && l.b) as { a: SimNode; b: SimNode }[];

    nodesRef.current = nodes;
    byIdRef.current = byId;
    linksRef.current = links;

    // Keep selection/hover valid.
    if (selectedId && !byId.has(selectedId)) setSelectedId(null);
    if (hoverRef.current && !byId.has(hoverRef.current.id)) hoverRef.current = null;
    dragRef.current.node = null;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes, graph.edges, q]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const parent = canvas.parentElement;
    const width = Math.max(640, parent?.clientWidth || 900);
    const height = 640;
    canvas.width = Math.floor(width * window.devicePixelRatio);
    canvas.height = Math.floor(height * window.devicePixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

    const onMove = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const nodes = nodesRef.current;
      if (dragRef.current.node) {
        dragRef.current.node.x = x + dragRef.current.dx;
        dragRef.current.node.y = y + dragRef.current.dy;
        dragRef.current.node.vx = 0;
        dragRef.current.node.vy = 0;
        return;
      }
      hoverRef.current = pickNodeAt(nodes, x, y);
    };

    const onDown = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const nodes = nodesRef.current;
      const hit = pickNodeAt(nodes, x, y);
      if (!hit) return;
      dragRef.current.node = hit;
      dragRef.current.dx = hit.x - x;
      dragRef.current.dy = hit.y - y;
      ;(dragRef.current as any).startX = x
      ;(dragRef.current as any).startY = y
      ;(dragRef.current as any).moved = false
    };

    const onUp = () => {
      dragRef.current.node = null;
    };

    const onClick = (ev: MouseEvent) => {
      // Avoid "click opens page" when the user is dragging nodes.
      const moved = Boolean((dragRef.current as any).moved)
      if (moved) return

      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const nodes = nodesRef.current;
      const hit = pickNodeAt(nodes, x, y);
      if (!hit) return;
      setSelectedId(hit.id);
      if (hit.kind === "page" && hit.path) {
        toast({ title: "Opened", description: hit.label || hit.path || hit.id });
        window.location.href = `/wiki/files/workspaces/${encodeURIComponent(wikiProjectId)}/${encodeURIComponent(hit.path)}?back=${encodeURIComponent(
          `/wiki/projects/${encodeURIComponent(wikiProjectId)}/graph`
        )}`;
      }
    };

    const onLeave = () => {
      hoverRef.current = null
    }

    const onDragMove = (ev: MouseEvent) => {
      if (!dragRef.current.node) return
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const sx = Number((dragRef.current as any).startX || 0)
      const sy = Number((dragRef.current as any).startY || 0)
      const dx = x - sx
      const dy = y - sy
      if (dx * dx + dy * dy > 16) (dragRef.current as any).moved = true
    }

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mouseleave", onLeave)
    canvas.addEventListener("mousemove", onDragMove)

    const step = () => {
      // Force layout constants
      const repulsion = 2200;
      const spring = 0.014;
      const springLen = 90;
      const damping = 0.86;
      const collisionPad = 4;

      const nodes = nodesRef.current;
      const links = linksRef.current;
      const { centerX, centerY } = sizeRef.current;

      // Repulsion (n^2, OK for small/medium graphs)
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 0.1;
          const f = repulsion / d2;
          const fx = (dx / Math.sqrt(d2)) * f;
          const fy = (dy / Math.sqrt(d2)) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // Springs
      for (const l of links) {
        const a = l.a;
        const b = l.b;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const diff = dist - springLen;
        const f = diff * spring;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // Collision
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const ra = (a.kind === "external" ? 7 : 9) + collisionPad;
          const rb = (b.kind === "external" ? 7 : 9) + collisionPad;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const min = ra + rb;
          if (dist >= min) continue;
          const push = (min - dist) * 0.12;
          const fx = (dx / dist) * push;
          const fy = (dy / dist) * push;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // Pull to center
      for (const n of nodes) {
        const cx = centerX - n.x;
        const cy = centerY - n.y;
        n.vx += cx * 0.001;
        n.vy += cy * 0.001;
      }

      // Integrate
      for (const n of nodes) {
        if (dragRef.current.node && dragRef.current.node.id === n.id) continue;
        n.vx *= damping;
        n.vy *= damping;
        n.x += n.vx;
        n.y += n.vy;
      }

      // Draw
      ctx.clearRect(0, 0, width, height);

      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(148,163,184,0.35)";
      ctx.beginPath();
      for (const l of links) {
        ctx.moveTo(l.a.x, l.a.y);
        ctx.lineTo(l.b.x, l.b.y);
      }
      ctx.stroke();

      const selected = selectedId ? byIdRef.current.get(selectedId) : null;
      const hover = hoverRef.current;

      for (const n of nodes) {
        const r = n.kind === "external" ? 7 : 9;
        const isHover = hover && hover.id === n.id;
        const isSelected = selected && selected.id === n.id;
        const isDrag = dragRef.current.node && dragRef.current.node.id === n.id;
        ctx.beginPath();
        ctx.fillStyle = colorForNode(n);
        ctx.globalAlpha = isHover || isDrag ? 1 : 0.95;
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (isSelected || isHover || isDrag) {
          ctx.strokeStyle = "rgba(15,23,42,0.75)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Labels: hovered and selected node (plus small labels if the graph is small).
      const shouldLabelAll = nodes.length <= 40;
      ctx.font = "11px ui-sans-serif, system-ui, -apple-system";
      for (const n of nodes) {
        if (!shouldLabelAll && !(hover && hover.id === n.id) && !(selected && selected.id === n.id)) continue;
        const rawText = n.label || n.path || n.id;
        const text = ellipsize(rawText, shouldLabelAll ? 24 : 36);
        if (!text) continue;
        const padX = 12;
        const padY = 4;
        const w = ctx.measureText(text).width;
        let x = n.x + padX;
        let y = n.y + padY;
        if (x + w > width - 6) x = n.x - padX - w;
        x = Math.max(6, Math.min(width - w - 6, x));
        y = Math.max(14, Math.min(height - 8, y));
        ctx.fillStyle = "rgba(15,23,42,0.8)";
        ctx.fillText(text, x, y);
      }

      // Tooltip card for hovered node
      if (hover) {
        const text = ellipsize(hover.label || hover.path || hover.id, 80);
        ctx.font = "12px ui-sans-serif, system-ui, -apple-system";
        ctx.fillStyle = "rgba(15,23,42,0.9)";
        const pad = 8;
        const w = ctx.measureText(text).width + pad * 2;
        const h = 26;
        const x = Math.min(width - w - 8, Math.max(8, hover.x + 12));
        const y = Math.min(height - h - 8, Math.max(8, hover.y - h - 12));
        ctx.fillStyle = "rgba(248,250,252,0.95)";
        ctx.strokeStyle = "rgba(148,163,184,0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(15,23,42,0.9)";
        ctx.fillText(text, x + pad, y + 17);
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mouseleave", onLeave)
      canvas.removeEventListener("mousemove", onDragMove)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikiProjectId, toast, selectedId]);

  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const selectedNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) || null : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-slate-600">Wiki graph</div>
          <h1 className="mt-1 truncate text-2xl font-semibold">Nodes & relations</h1>
          <div className="mt-1 text-xs text-slate-500">
            {nodeCount} nodes · {edgeCount} edges
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/wiki/projects/${encodeURIComponent(wikiProjectId)}`}>
            <Button variant="secondary">Back</Button>
          </Link>
          <Link href={`/wiki/files/workspaces/${encodeURIComponent(wikiProjectId)}/index.md`}>
            <Button variant="ghost">Open index.md</Button>
          </Link>
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </header>

      <Separator className="my-8" />

      {err ? <div className="mb-4 text-xs text-red-300">{err}</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <div className="text-sm text-slate-600">Controls</div>
          <div className="mt-3 grid gap-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter nodes…" />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={includeExternal}
                onChange={(e) => setIncludeExternal(e.target.checked)}
                className="h-4 w-4"
              />
              Include unresolved links
            </label>
            <div className="text-xs text-slate-500">
              Tip: drag nodes to reposition. Click a node to open its markdown file.
            </div>
            <Separator className="my-2" />
            <div className="text-sm text-slate-600">Selected</div>
            {selectedNode ? (
              <div className="rounded-md border border-[color:var(--border)] px-3 py-2">
                <div className="truncate text-sm font-medium">{selectedNode.label || selectedNode.path || selectedNode.id}</div>
                {selectedNode.kind === "page" && selectedNode.path ? (
                  <div className="mt-1 truncate text-xs text-slate-500">{selectedNode.path}</div>
                ) : null}
                {selectedNode.type ? <div className="mt-1 text-xs text-slate-500">Type: {selectedNode.type}</div> : null}
                {selectedNode.tags && selectedNode.tags.length ? (
                  <div className="mt-1 text-xs text-slate-500">Tags: {selectedNode.tags.join(", ")}</div>
                ) : null}
              </div>
            ) : (
              <div className="text-xs text-slate-500">Click a node to see its details.</div>
            )}
          </div>
        </Card>

        <Card className="md:col-span-2">
          <div className="text-sm text-slate-600">Graph</div>
          <div className="mt-3">
            <canvas ref={canvasRef} className="w-full rounded-md border border-[color:var(--border)] bg-white" />
          </div>
        </Card>
      </div>
    </div>
  );
}
