"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { apiGet } from "@/lib/http";
import { getDashboardApiWsUrl } from "@/lib/ws";

type WikiBuild = {
  id: string;
  status: string;
  title?: string | null;
  goal?: string | null;
  createdAt: string;
  updatedAt: string;
};

type WikiBuildStep = {
  id: string;
  index: number;
  kind: string;
  summary?: string | null;
  status: string;
  error?: string | null;
  output?: any;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedUsd?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
};

type WikiEvent = {
  id: string;
  level: string;
  message: string;
  payload?: any;
  createdAt: string;
};

export default function WikiBuildPage() {
  const params = useParams<{ wikiProjectId: string; buildId: string }>();
  const wikiProjectId = useMemo(() => decodeURIComponent(params.wikiProjectId), [params.wikiProjectId]);
  const buildId = useMemo(() => decodeURIComponent(params.buildId), [params.buildId]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [build, setBuild] = useState<WikiBuild | null>(null);
  const [steps, setSteps] = useState<WikiBuildStep[]>([]);
  const [events, setEvents] = useState<WikiEvent[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; build: WikiBuild; steps: WikiBuildStep[]; events: WikiEvent[] }>(
        `/api/v1/wiki_projects/${encodeURIComponent(wikiProjectId)}/builds/${encodeURIComponent(buildId)}`
      );
      setBuild(r.build);
      setSteps(r.steps || []);
      setEvents(r.events || []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikiProjectId, buildId]);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retry = 0;
    let debounce: any = null;

    const loadSoon = () => {
      if (debounce) return;
      debounce = window.setTimeout(() => {
        debounce = null;
        load();
      }, 250);
    };

    const connect = () => {
      if (closed) return;
      try {
        const url = getDashboardApiWsUrl("/api/v1/ws");
        ws = new WebSocket(url);
        ws.onopen = () => {
          retry = 0;
          ws?.send(JSON.stringify({ type: "subscribe", scope: "wikiBuild", wikiProjectId, buildId }));
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data || "{}"));
            if (msg.type === "wiki_build_events" && msg.buildId === buildId) loadSoon();
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => {
          if (closed) return;
          retry = Math.min(6, retry + 1);
          const wait = Math.min(10_000, 500 * Math.pow(2, retry));
          window.setTimeout(connect, wait);
        };
      } catch {
        // Fallback: periodic refresh
        const t = window.setInterval(load, 2500);
        return () => window.clearInterval(t);
      }
    };

    connect();
    return () => {
      closed = true;
      if (debounce) window.clearTimeout(debounce);
      try {
        ws?.close();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikiProjectId, buildId]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-slate-600">Wiki build</div>
          <h1 className="mt-1 truncate text-2xl font-semibold">{build?.title || buildId}</h1>
          <div className="mt-1 truncate text-xs text-slate-500">Status: {build?.status || "—"}</div>
          {build?.goal ? <div className="mt-1 text-xs text-slate-500">{build.goal}</div> : null}
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="text-sm text-slate-600">Steps</div>
          <div className="mt-3 grid gap-2">
            {steps.map((s) => (
              <div key={s.id} className="rounded-md border border-[color:var(--border)] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {s.index}. {s.summary || s.kind}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {s.kind} · {s.status}
                      {s.totalTokens != null ? ` · ${s.totalTokens} tokens` : ""}
                      {s.estimatedUsd != null ? ` · $${Number(s.estimatedUsd).toFixed(4)}` : ""}
                    </div>
                    {s.error ? <div className="mt-1 text-xs text-red-300">{s.error}</div> : null}
                  </div>
                </div>
                {typeof s.output?.text === "string" && s.output.text.trim() ? (
                  <pre className="mt-2 max-h-[200px] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-800">
                    {s.output.text.slice(0, 4000)}
                  </pre>
                ) : null}
              </div>
            ))}
            {!steps.length ? <div className="text-sm text-slate-600">No steps yet.</div> : null}
          </div>
        </Card>

        <Card>
          <div className="text-sm text-slate-600">Events</div>
          <div className="mt-3 grid gap-2">
            {events.slice(-120).map((e) => (
              <div key={e.id} className="rounded-md border border-[color:var(--border)] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="truncate text-xs text-slate-700">{e.message}</div>
                  <div className="shrink-0 text-[11px] text-slate-500">{new Date(e.createdAt).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
            {!events.length ? <div className="text-sm text-slate-600">No events yet.</div> : null}
          </div>
        </Card>
      </div>

      {loading ? <div className="mt-6 text-sm text-slate-600">Loading…</div> : null}
    </div>
  );
}
