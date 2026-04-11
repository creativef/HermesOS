"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiPost } from "@/lib/http";

type Run = {
  id: string;
  status: string;
  title?: string | null;
  goal: string;
  createdAt?: string;
  updatedAt?: string;
  _count?: { steps?: number; approvals?: number; events?: number };
};

function formatWhen(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusLabel(status: string) {
  return status || "unknown";
}

export default function ProjectRunsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = decodeURIComponent(params.projectId);

  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const canCreate = useMemo(() => goal.trim().length > 0, [goal]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; runs: Run[] }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/runs?take=50`
      );
      setRuns(r.runs || []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId]);

  async function createRun() {
    if (!canCreate) return;
    setLoading(true);
    setErr(null);
    try {
      await apiPost<{ ok: boolean; run: Run }>(`/api/v1/projects/${encodeURIComponent(projectId)}/runs`, {
        title: title.trim() || undefined,
        goal: goal.trim(),
      });
      setTitle("");
      setGoal("");
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm text-slate-600">Project</div>
          <h1 className="mt-1 text-2xl font-semibold">Runs</h1>
          <div className="mt-1 text-xs text-slate-500">{projectId}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Link href={`/projects/${encodeURIComponent(projectId)}`}>
            <Button variant="secondary">Back</Button>
          </Link>
        </div>
      </header>

      <Separator className="my-8" />

      <Card>
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm text-slate-600">New run</div>
            <div className="mt-1 text-lg font-medium">Create an orchestration run</div>
            <div className="mt-1 text-xs text-slate-500">The worker will plan (step 0) then execute durable steps.</div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={createRun} disabled={!canCreate || loading}>
              Create run
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal (required)" />
          {err ? <div className="text-xs text-red-300">{err}</div> : null}
        </div>
      </Card>

      <Separator className="my-8" />

      <div className="grid gap-4 md:grid-cols-2">
        {runs.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-lg font-medium">{r.title ? r.title : r.id}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{r.id}</div>
                <div className="mt-2 text-xs text-slate-600">Status: {statusLabel(r.status)}</div>
                <div className="mt-1 text-xs text-slate-600">
                  Steps: {r._count?.steps ?? "?"} • Approvals: {r._count?.approvals ?? "?"}
                </div>
                <div className="mt-1 text-xs text-slate-500">Created: {formatWhen(r.createdAt)}</div>
                <div className="mt-2 line-clamp-3 text-xs text-slate-700">{r.goal}</div>
              </div>
              <Link href={`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(r.id)}`}>
                <Button variant="secondary">Open</Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>

      {loading ? <div className="mt-6 text-sm text-slate-600">Loading…</div> : null}
    </div>
  );
}

