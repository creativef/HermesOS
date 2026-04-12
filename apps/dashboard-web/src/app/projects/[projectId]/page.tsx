"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiPost, apiPut } from "@/lib/http";
import { useToast } from "@/components/ui/toast";

type Session = {
  id: string;
  title?: string | null;
  status?: string;
  createdAt?: string;
};

type Run = {
  id: string;
  status: string;
  title?: string | null;
  goal: string;
  createdAt?: string;
  _count?: { steps?: number; approvals?: number; events?: number };
};

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = decodeURIComponent(params.projectId);
  const router = useRouter();
  const { toast } = useToast();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTitle, setNewTitle] = useState("Test session");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleEvery, setScheduleEvery] = useState(60);
  const [scheduleUnit, setScheduleUnit] = useState<"minutes" | "hours" | "days">("minutes");
  const [err, setErr] = useState<string | null>(null);

  const [brief, setBrief] = useState("");
  const [briefSavedValue, setBriefSavedValue] = useState("");
  const [briefErr, setBriefErr] = useState<string | null>(null);

  const canCreate = useMemo(() => newTitle.trim().length > 0, [newTitle]);
  const scheduleIntervalSeconds = useMemo(() => {
    const n = Number(scheduleEvery || 0);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (scheduleUnit === "hours") return Math.round(n * 3600);
    if (scheduleUnit === "days") return Math.round(n * 86400);
    return Math.round(n * 60);
  }, [scheduleEvery, scheduleUnit]);

  const canCreateScheduled = useMemo(() => {
    if (!scheduleEnabled) return true;
    return scheduleIntervalSeconds != null && scheduleIntervalSeconds >= 60;
  }, [scheduleEnabled, scheduleIntervalSeconds]);
  const briefDirty = useMemo(() => brief.trim() !== briefSavedValue.trim(), [brief, briefSavedValue]);

  async function loadSessionsAndRuns() {
    setLoading(true);
    setErr(null);
    try {
      const [sr, rr] = await Promise.all([
        apiGet<{ ok: boolean; sessions: Session[] }>(`/api/v1/projects/${encodeURIComponent(projectId)}/sessions`),
        apiGet<{ ok: boolean; runs: Run[] }>(`/api/v1/projects/${encodeURIComponent(projectId)}/runs?take=50`),
      ]);
      setSessions(sr.sessions || []);
      setRuns(rr.runs || []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadBrief() {
    setBriefErr(null);
    try {
      const r = await apiGet<{ ok: boolean; artifact: { body: string } | null }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/brief`
      );
      const text = r.artifact?.body || "";
      setBrief(text);
      setBriefSavedValue(text);
    } catch (e) {
      setBriefErr(String(e));
    }
  }

  useEffect(() => {
    loadSessionsAndRuns();
    loadBrief();
  }, [projectId]);

  async function createSession() {
    if (!canCreate) return;
    if (!canCreateScheduled) return;
    setLoading(true);
    setErr(null);
    try {
      await apiPost(`/api/v1/projects/${encodeURIComponent(projectId)}/sessions`, {
        title: newTitle,
        prompt: newTitle,
        ...(scheduleEnabled
          ? {
              schedule: {
                enabled: true,
                intervalSeconds: scheduleIntervalSeconds,
                name: "Session automation",
                config: { mode: "interval", every: scheduleEvery, unit: scheduleUnit },
              },
            }
          : {}),
      });
      await loadSessionsAndRuns();
      if (scheduleEnabled) {
        toast({
          title: "Schedule enabled",
          description: `This session will run every ${scheduleEvery} ${scheduleUnit}.`,
        });
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveBrief() {
    setLoading(true);
    setBriefErr(null);
    try {
      await apiPut(`/api/v1/projects/${encodeURIComponent(projectId)}/brief`, { body: brief });
      setBriefSavedValue(brief);
    } catch (e) {
      setBriefErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm text-slate-600">Project</div>
          <h1 className="mt-1 text-2xl font-semibold">{projectId}</h1>
        </div>
        <div className="flex w-full flex-col gap-2 md:w-[620px]">
          <div className="flex items-center gap-2">
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Session title" />
            <Button onClick={createSession} disabled={!canCreate || loading || !canCreateScheduled}>
              Create session
            </Button>
            <Link href="/projects">
              <Button variant="secondary">Back</Button>
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
                disabled={loading}
              />
              Schedule automation
            </label>
            {scheduleEnabled ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">Every</span>
                <Input
                  value={String(scheduleEvery)}
                  onChange={(e) => setScheduleEvery(Number(e.target.value || 0))}
                  className="h-8 w-[92px]"
                  placeholder="60"
                />
                <select
                  value={scheduleUnit}
                  onChange={(e) => setScheduleUnit(e.target.value as any)}
                  className="h-8 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-2 text-xs text-[color:var(--app-text)]"
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
                {!canCreateScheduled ? (
                  <span className="text-red-300">Interval must be ≥ 60 seconds.</span>
                ) : (
                  <span className="text-slate-500">Runs are evenly spaced (v1 interval scheduling).</span>
                )}
              </div>
            ) : null}
          </div>
          {err ? <div className="text-xs text-red-300">{err}</div> : null}
        </div>
      </header>

      <Separator className="my-8" />

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm text-slate-600">Context</div>
            <div className="mt-1 text-lg font-medium">Project brief</div>
            <div className="mt-1 text-xs text-slate-500">Saved as a context artifact (`project_brief`) for this project.</div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={saveBrief} disabled={!briefDirty || loading}>
              Save brief
            </Button>
            <Button variant="secondary" onClick={loadBrief} disabled={loading}>
              Reload
            </Button>
          </div>
        </div>
        <div className="mt-4">
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What is this project? Goals, constraints, desired tone…" />
          {briefErr ? <div className="mt-2 text-xs text-red-300">{briefErr}</div> : null}
          {!briefErr && briefDirty ? <div className="mt-2 text-xs text-slate-500">Unsaved changes.</div> : null}
        </div>
      </Card>

      <Separator className="my-8" />

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm text-slate-600">Orchestration</div>
            <div className="mt-1 text-lg font-medium">Runs</div>
            <div className="mt-1 text-xs text-slate-500">Durable, multi-step executions (plan → steps → approvals).</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                toast({
                  title: "Runs = durable orchestration",
                  description: "Use runs for multi-step execution with planning, logs, and approvals (survives restarts).",
                });
                router.push(`/projects/${encodeURIComponent(projectId)}/runs`);
              }}
            >
              New run
            </Button>
            <Button variant="secondary" onClick={loadSessionsAndRuns} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {runs.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-lg font-medium">{r.title || r.id}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{r.id}</div>
                  <div className="mt-2 text-xs text-slate-600">Status: {r.status || "unknown"}</div>
                  <div className="mt-1 text-xs text-slate-600">
                    Steps: {r._count?.steps ?? "?"} • Approvals: {r._count?.approvals ?? "?"}
                  </div>
                  <div className="mt-2 line-clamp-3 text-xs text-slate-700">{r.goal}</div>
                </div>
                <Link href={`/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(r.id)}`}>
                  <Button variant="secondary">Open</Button>
                </Link>
              </div>
            </Card>
          ))}
          {!runs.length ? <div className="text-sm text-slate-600">No runs yet.</div> : null}
        </div>
      </Card>

      <Separator className="my-8" />

      <div className="grid gap-4 md:grid-cols-2">
        {sessions.map((s) => (
          <Card key={s.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-lg font-medium">{s.title || s.id}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{s.id}</div>
                <div className="mt-2 text-xs text-slate-600">Status: {s.status || "unknown"}</div>
              </div>
              <Link href={`/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(s.id)}`}>
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
