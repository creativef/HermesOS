"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiPost } from "@/lib/http";
import { useToast } from "@/components/ui/toast";

type CountRow = { status?: string; enabled?: boolean; _count: { _all: number } };

type DoctorPayload = {
  ok: boolean;
  now: string;
  staleMinutes: number;
  hermes: any;
  counts: {
    projectRuns: CountRow[];
    runSteps: CountRow[];
    wikiBuilds: CountRow[];
    wikiBuildSteps: CountRow[];
    schedules: CountRow[];
    unreadNotifications: number;
  };
  stuck: {
    expiredLocks: {
      runs: any[];
      runSteps: any[];
      wikiBuilds: any[];
      wikiBuildSteps: any[];
    };
    staleNoLock: {
      runs: any[];
      wikiBuilds: any[];
    };
  };
};

function fmtCounts(rows: CountRow[], key: "status" | "enabled") {
  const out: Record<string, number> = {};
  for (const r of rows || []) {
    const k = key === "enabled" ? String(Boolean(r.enabled)) : String((r as any).status || "");
    out[k] = (out[k] || 0) + Number(r?._count?._all || 0);
  }
  return out;
}

function ago(iso: string) {
  try {
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  } catch {
    return iso;
  }
}

export default function DoctorPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<DoctorPayload | null>(null);
  const [apiHealth, setApiHealth] = useState<any>(null);
  const [hermesHealth, setHermesHealth] = useState<any>(null);
  const [staleMinutes, setStaleMinutes] = useState("10");

  const staleN = useMemo(() => {
    const n = Number.parseInt(staleMinutes, 10);
    return Number.isFinite(n) && n >= 1 ? n : 10;
  }, [staleMinutes]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [doctor, apiRaw, hermesRaw] = await Promise.all([
        apiGet<DoctorPayload>(`/api/v1/doctor?staleMinutes=${encodeURIComponent(String(staleN))}`),
        apiGet<any>(`/api/v1/health`, { auth: false }).catch((e) => ({ err: String(e) })),
        apiGet<any>(`/api/v1/hermes/health`, { auth: false }).catch((e) => ({ err: String(e) })),
      ]);
      setData(doctor);
      setApiHealth(apiRaw);
      setHermesHealth(hermesRaw);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reap(mode: "expired_only" | "expired_and_stale") {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiPost<{ ok: boolean; results: Record<string, number> }>(`/api/v1/doctor/reap`, {
        mode,
        staleMinutes: staleN,
      });
      const total = Object.values(r.results || {}).reduce((a, b) => a + Number(b || 0), 0);
      toast({ title: "Reaper executed", description: `${total} items re-queued` });
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function requeue(kind: string, id: string) {
    setLoading(true);
    setErr(null);
    try {
      await apiPost(`/api/v1/doctor/requeue`, { kind, id });
      toast({ title: "Re-queued", description: `${kind} ${id}` });
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const runCounts = fmtCounts(data?.counts?.projectRuns || [], "status");
  const runStepCounts = fmtCounts(data?.counts?.runSteps || [], "status");
  const wikiCounts = fmtCounts(data?.counts?.wikiBuilds || [], "status");
  const wikiStepCounts = fmtCounts(data?.counts?.wikiBuildSteps || [], "status");

  const expiredRuns = data?.stuck?.expiredLocks?.runs || [];
  const expiredRunSteps = data?.stuck?.expiredLocks?.runSteps || [];
  const expiredWikiBuilds = data?.stuck?.expiredLocks?.wikiBuilds || [];
  const expiredWikiSteps = data?.stuck?.expiredLocks?.wikiBuildSteps || [];
  const staleRuns = data?.stuck?.staleNoLock?.runs || [];
  const staleWikiBuilds = data?.stuck?.staleNoLock?.wikiBuilds || [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm text-slate-600">Diagnostics</div>
          <h1 className="mt-1 text-2xl font-semibold">Doctor</h1>
          <div className="mt-1 text-xs text-slate-500">Health checks + stuck-job reaper.</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="secondary">Back</Button>
          </Link>
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </header>

      <Separator className="my-8" />

      {err ? <div className="mb-4 text-xs text-red-300">{err}</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <div className="text-sm text-slate-600">Hermes</div>
          <div className="mt-2 text-sm text-slate-800">
            Status: {data?.hermes?.ok ? "ok" : "error"} {data?.hermes?.status ? `(${data.hermes.status})` : ""}
          </div>
          {!data?.hermes?.ok ? <div className="mt-2 text-xs text-red-300">{String(data?.hermes?.error || "")}</div> : null}
        </Card>

        <Card>
          <div className="text-sm text-slate-600">Queues</div>
          <div className="mt-2 grid gap-1 text-xs text-slate-700">
            <div>Runs: {Object.entries(runCounts).map(([k, v]) => `${k}:${v}`).join(" · ") || "—"}</div>
            <div>RunSteps: {Object.entries(runStepCounts).map(([k, v]) => `${k}:${v}`).join(" · ") || "—"}</div>
            <div>WikiBuilds: {Object.entries(wikiCounts).map(([k, v]) => `${k}:${v}`).join(" · ") || "—"}</div>
            <div>WikiSteps: {Object.entries(wikiStepCounts).map(([k, v]) => `${k}:${v}`).join(" · ") || "—"}</div>
            <div>Unread notifications: {data?.counts?.unreadNotifications ?? "—"}</div>
          </div>
        </Card>

        <Card>
          <div className="text-sm text-slate-600">Reaper</div>
          <div className="mt-3 grid gap-3">
            <div className="grid gap-2">
              <div className="text-xs text-slate-600">Stale threshold (minutes)</div>
              <Input value={staleMinutes} onChange={(e) => setStaleMinutes(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => reap("expired_only")} disabled={loading}>
                Reap expired locks
              </Button>
              <Button onClick={() => reap("expired_and_stale")} disabled={loading}>
                Reap expired + stale
              </Button>
            </div>
            <div className="text-xs text-slate-500">
              “Stale” means `running` + no lock + last update older than {staleN} minutes.
            </div>
          </div>
        </Card>
      </div>

      <Separator className="my-8" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="min-w-0">
          <div className="text-sm text-slate-600">Dashboard API (raw)</div>
          <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs text-slate-800">
            {JSON.stringify(apiHealth, null, 2)}
          </pre>
        </Card>
        <Card className="min-w-0">
          <div className="text-sm text-slate-600">Hermes (raw)</div>
          <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs text-slate-800">
            {JSON.stringify(hermesHealth, null, 2)}
          </pre>
        </Card>
      </div>

      <Separator className="my-8" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-600">Expired locks</div>
            <div className="text-xs text-slate-500">
              runs:{expiredRuns.length} · steps:{expiredRunSteps.length} · wiki:{expiredWikiBuilds.length} · wikiSteps:{expiredWikiSteps.length}
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            {expiredRuns.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--border)] px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.title || r.id}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">run · {r.status} · {ago(r.updatedAt)}</div>
                </div>
                <div className="shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => requeue("run", r.id)} disabled={loading}>
                    Requeue
                  </Button>
                </div>
              </div>
            ))}
            {expiredWikiBuilds.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--border)] px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{b.title || b.id}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">wikiBuild · {b.status} · {ago(b.updatedAt)}</div>
                </div>
                <div className="shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => requeue("wikiBuild", b.id)} disabled={loading}>
                    Requeue
                  </Button>
                </div>
              </div>
            ))}
            {!expiredRuns.length && !expiredWikiBuilds.length ? (
              <div className="text-sm text-slate-600">No expired run/build locks found.</div>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-600">Stale running (no lock)</div>
            <div className="text-xs text-slate-500">
              runs:{staleRuns.length} · wikiBuilds:{staleWikiBuilds.length}
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            {staleRuns.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--border)] px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.title || r.id}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">run · {r.status} · {ago(r.updatedAt)}</div>
                </div>
                <div className="shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => requeue("run", r.id)} disabled={loading}>
                    Requeue
                  </Button>
                </div>
              </div>
            ))}
            {staleWikiBuilds.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--border)] px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{b.title || b.id}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">wikiBuild · {b.status} · {ago(b.updatedAt)}</div>
                </div>
                <div className="shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => requeue("wikiBuild", b.id)} disabled={loading}>
                    Requeue
                  </Button>
                </div>
              </div>
            ))}
            {!staleRuns.length && !staleWikiBuilds.length ? <div className="text-sm text-slate-600">No stale items.</div> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
