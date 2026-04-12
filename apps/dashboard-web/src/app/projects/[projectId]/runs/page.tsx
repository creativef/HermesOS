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
import { useToast } from "@/components/ui/toast";

type Run = {
  id: string;
  status: string;
  title?: string | null;
  goal: string;
  createdAt?: string;
  updatedAt?: string;
  _count?: { steps?: number; approvals?: number; events?: number };
};

type Session = { id: string; title?: string | null };

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

function minutesToTimeOfDay(minutes: number) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseTimeToMinutes(value: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export default function ProjectRunsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = decodeURIComponent(params.projectId);
  const { toast } = useToast();

  const [runs, setRuns] = useState<Run[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [sessionId, setSessionId] = useState<string>("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"interval" | "times_per_day">("interval");
  const [scheduleEvery, setScheduleEvery] = useState(60);
  const [scheduleUnit, setScheduleUnit] = useState<"minutes" | "hours" | "days">("minutes");
  const [scheduleTimesPerDay, setScheduleTimesPerDay] = useState(2);
  const [scheduleStartTime, setScheduleStartTime] = useState("09:00");
  const canCreate = useMemo(() => goal.trim().length > 0, [goal]);
  const scheduleIntervalSeconds = useMemo(() => {
    const n = Number(scheduleEvery || 0);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (scheduleUnit === "hours") return Math.round(n * 3600);
    if (scheduleUnit === "days") return Math.round(n * 86400);
    return Math.round(n * 60);
  }, [scheduleEvery, scheduleUnit]);
  const canCreateScheduled = useMemo(() => {
    if (!scheduleEnabled) return true;
    if (!sessionId) return false;
    if (scheduleMode === "interval") return scheduleIntervalSeconds != null && scheduleIntervalSeconds >= 60;
    return scheduleTimesPerDay >= 1 && scheduleTimesPerDay <= 24 && /^\d{2}:\d{2}$/.test(scheduleStartTime);
  }, [scheduleEnabled, scheduleIntervalSeconds, scheduleMode, scheduleStartTime, scheduleTimesPerDay, sessionId]);
  const timesPerDayPreview = useMemo(() => {
    if (!scheduleEnabled || scheduleMode !== "times_per_day") return null;
    const count = Math.max(1, Math.min(24, Number(scheduleTimesPerDay || 0)));
    const start = parseTimeToMinutes(scheduleStartTime);
    if (!count || start == null) return null;
    const step = 1440 / count;
    const times: string[] = [];
    for (let i = 0; i < count; i++) times.push(minutesToTimeOfDay(start + i * step));
    return times.join(", ");
  }, [scheduleEnabled, scheduleMode, scheduleStartTime, scheduleTimesPerDay]);
  const localTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "local time";
    }
  }, []);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [rr, sr] = await Promise.all([
        apiGet<{ ok: boolean; runs: Run[] }>(`/api/v1/projects/${encodeURIComponent(projectId)}/runs?take=50`),
        apiGet<{ ok: boolean; sessions: Session[] }>(`/api/v1/projects/${encodeURIComponent(projectId)}/sessions`),
      ]);
      setRuns(rr.runs || []);
      setSessions(sr.sessions || []);
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
    if (!canCreateScheduled) return;
    setLoading(true);
    setErr(null);
    try {
      let createdScheduleId: string | null = null;
      if (scheduleEnabled) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const payload =
          scheduleMode === "interval"
            ? {
                intervalSeconds: scheduleIntervalSeconds,
                config: { mode: "interval", every: scheduleEvery, unit: scheduleUnit },
                timezone: tz,
              }
            : {
                intervalSeconds: null,
                config: { mode: "times_per_day", count: scheduleTimesPerDay, startTime: scheduleStartTime },
                timezone: tz,
              };
        const sch = await apiPost<{ ok: boolean; schedule: { id: string } }>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/schedules`,
          {
            name: "Run schedule",
            enabled: true,
            ...payload,
            runTemplate: { title: title.trim() || "Scheduled run", goal: goal.trim() },
          }
        );
        createdScheduleId = sch.schedule.id;
        toast({
          title: "Schedule created",
          description:
            scheduleMode === "interval"
              ? `Will run every ${scheduleEvery} ${scheduleUnit}.`
              : `Will run ${scheduleTimesPerDay}×/day starting ${scheduleStartTime}.`,
        });
      }

      await apiPost<{ ok: boolean; run: Run }>(`/api/v1/projects/${encodeURIComponent(projectId)}/runs`, {
        title: title.trim() || undefined,
        goal: goal.trim(),
        ...(sessionId ? { sessionId } : {}),
        ...(createdScheduleId ? { scheduleId: createdScheduleId } : {}),
      });
      setTitle("");
      setGoal("");
      setScheduleEnabled(false);
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
            <Button onClick={createRun} disabled={!canCreate || loading || !canCreateScheduled}>
              Create run
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal (required)" />
          <div className="grid gap-2">
            <div className="text-xs text-slate-600">Attach to session (recommended)</div>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="h-10 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--app-text)]"
            >
              <option value="">No session</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title ? s.title : s.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
                disabled={loading}
              />
              Schedule this run
            </label>
            {scheduleEnabled ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={scheduleMode}
                  onChange={(e) => setScheduleMode(e.target.value as any)}
                  className="h-8 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-2 text-xs text-[color:var(--app-text)]"
                >
                  <option value="interval">Interval</option>
                  <option value="times_per_day">Times/day</option>
                </select>
                {scheduleMode === "interval" ? (
                  <>
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
                  </>
                ) : null}
                {scheduleMode === "times_per_day" ? (
                  <>
                    <span className="text-slate-500">Run</span>
                    <Input
                      value={String(scheduleTimesPerDay)}
                      onChange={(e) => setScheduleTimesPerDay(Number(e.target.value || 0))}
                      className="h-8 w-[92px]"
                      placeholder="2"
                    />
                    <span className="text-slate-500">times/day starting</span>
                    <Input
                      type="time"
                      value={scheduleStartTime}
                      onChange={(e) => setScheduleStartTime(e.target.value)}
                      className="h-8 w-[132px]"
                    />
                  </>
                ) : null}
                {!sessionId ? <span className="text-red-300">Select a session first.</span> : null}
              </div>
            ) : null}
          </div>
          {scheduleEnabled && scheduleMode === "times_per_day" ? (
            <div className="text-xs text-slate-500">
              {timesPerDayPreview ? (
                <>
                  Runs daily at <span className="text-slate-700">{timesPerDayPreview}</span> ({localTz}).
                </>
              ) : (
                <>Pick a start time and times/day to preview run times.</>
              )}
            </div>
          ) : null}
          {scheduleEnabled && scheduleMode === "interval" ? (
            <div className="text-xs text-slate-500">Runs are evenly spaced; first scheduled run starts after the interval.</div>
          ) : null}
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
