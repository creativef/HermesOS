"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiPatch, apiPost } from "@/lib/http";
import { Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { getApiKey } from "@/lib/auth";
import { HelpTip } from "@/components/help-tip";
import { useToast } from "@/components/ui/toast";

type Message = { id: string; type: string; createdAt: string; payload: any };
type Session = { id: string; title?: string | null; status?: string };
type MessageJob = {
  id: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedUsd?: number | null;
  durationMs?: number | null;
  error?: string | null;
};
type Schedule = {
  id: string;
  name: string;
  enabled: boolean;
  intervalSeconds?: number | null;
  timezone?: string | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  config?: any;
  runTemplate?: any;
  createdAt?: string;
};

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

export default function SessionDetailPage() {
  const params = useParams<{ projectId: string; sessionId: string }>();
  const projectId = decodeURIComponent(params.projectId);
  const sessionId = decodeURIComponent(params.sessionId);
  const { toast } = useToast();

  const [session, setSession] = useState<Session | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaved, setTitleSaved] = useState("");
  const [titleErr, setTitleErr] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"interval" | "times_per_day">("interval");
  const [scheduleEvery, setScheduleEvery] = useState(60);
  const [scheduleUnit, setScheduleUnit] = useState<"minutes" | "hours" | "days">("minutes");
  const [scheduleTimesPerDay, setScheduleTimesPerDay] = useState(2);
  const [scheduleStartTime, setScheduleStartTime] = useState("09:00");
  const [scheduleStartAt, setScheduleStartAt] = useState<string>("");
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMode, setEditMode] = useState<"interval" | "times_per_day">("interval");
  const [editEvery, setEditEvery] = useState(60);
  const [editUnit, setEditUnit] = useState<"minutes" | "hours" | "days">("minutes");
  const [editTimesPerDay, setEditTimesPerDay] = useState(2);
  const [editStartTime, setEditStartTime] = useState("09:00");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [job, setJob] = useState<MessageJob | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isMounted = useRef(true);
  const streamRef = useRef<EventSource | null>(null);

  const canSend = useMemo(() => draft.trim().length > 0, [draft]);
  const canSaveTitle = useMemo(() => titleDraft.trim() !== titleSaved.trim(), [titleDraft, titleSaved]);
  const scheduleIntervalSeconds = useMemo(() => {
    const n = Number(scheduleEvery || 0);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (scheduleUnit === "hours") return Math.round(n * 3600);
    if (scheduleUnit === "days") return Math.round(n * 86400);
    return Math.round(n * 60);
  }, [scheduleEvery, scheduleUnit]);
  const editIntervalSeconds = useMemo(() => {
    const n = Number(editEvery || 0);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (editUnit === "hours") return Math.round(n * 3600);
    if (editUnit === "days") return Math.round(n * 86400);
    return Math.round(n * 60);
  }, [editEvery, editUnit]);
  const canCreateSchedule = useMemo(() => {
    if (!scheduleEnabled) return true;
    if (scheduleMode === "interval") return scheduleIntervalSeconds != null && scheduleIntervalSeconds >= 60;
    if (scheduleMode === "times_per_day")
      return scheduleTimesPerDay >= 1 && scheduleTimesPerDay <= 24 && /^\d{2}:\d{2}$/.test(scheduleStartTime);
    return false;
  }, [scheduleEnabled, scheduleIntervalSeconds, scheduleMode, scheduleStartTime, scheduleTimesPerDay]);
  const canSaveScheduleEdit = useMemo(() => {
    if (!editingScheduleId) return true;
    if (editMode === "interval") return editIntervalSeconds != null && editIntervalSeconds >= 60;
    return editTimesPerDay >= 1 && editTimesPerDay <= 24 && /^\d{2}:\d{2}$/.test(editStartTime);
  }, [editingScheduleId, editIntervalSeconds, editMode, editStartTime, editTimesPerDay]);
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
  const editTimesPerDayPreview = useMemo(() => {
    if (!editingScheduleId || editMode !== "times_per_day") return null;
    const count = Math.max(1, Math.min(24, Number(editTimesPerDay || 0)));
    const start = parseTimeToMinutes(editStartTime);
    if (!count || start == null) return null;
    const step = 1440 / count;
    const times: string[] = [];
    for (let i = 0; i < count; i++) times.push(minutesToTimeOfDay(start + i * step));
    return times.join(", ");
  }, [editingScheduleId, editMode, editStartTime, editTimesPerDay]);
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
      const s = await apiGet<{ ok: boolean; session: Session }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`
      );
      setSession(s.session);
      const nextTitle = s.session?.title || "";
      setTitleDraft(nextTitle);
      setTitleSaved(nextTitle);

      const r = await apiGet<{ ok: boolean; messages: Message[] }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/messages`
      );
      setMessages(r.messages || []);

      const sch = await apiGet<{ ok: boolean; schedules: Schedule[] }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/schedules`
      );
      setSchedules(sch.schedules || []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId, sessionId]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (streamRef.current) {
        try {
          streamRef.current.close();
        } catch {}
        streamRef.current = null;
      }
    };
  }, []);

  async function send() {
    if (!canSend) return;
    await submitMessage(draft, { clearDraft: true });
  }

  async function submitMessage(content: string, opts: { clearDraft?: boolean } = {}) {
    const text = String(content || "").trim();
    if (!text) return;
    setLoading(true);
    setErr(null);
    setJobErr(null);
    try {
      const r = await apiPost<{ ok: boolean; job: MessageJob }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
        { content: text }
      );
      if (opts.clearDraft) setDraft("");
      setJob(r.job);
      await watchJob(r.job.id);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function watchJob(jobId: string) {
    // Prefer SSE stream (more resilient); fallback to polling.
    let streamWorked = false;
    try {
      const apiKey = getApiKey();
      const streamUrl = `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(
        sessionId
      )}/message_jobs/${encodeURIComponent(jobId)}/stream?apiKey=${encodeURIComponent(apiKey)}`;
      const es = new EventSource(streamUrl);
      streamRef.current = es;
      streamWorked = true;
      const close = () => {
        try {
          es.close();
        } catch {}
        if (streamRef.current === es) streamRef.current = null;
      };
      es.addEventListener("status", (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(String(ev.data || "{}"));
          if (payload?.job) setJob(payload.job);
        } catch {}
      });
      es.addEventListener("done", async (ev: MessageEvent) => {
        try {
          const payload = JSON.parse(String(ev.data || "{}"));
          if (payload?.job) setJob(payload.job);
          if (payload?.job?.status === "failed" || payload?.job?.status === "timeout") {
            setJobErr(payload?.job?.error || "Hermes job failed.");
          }
        } catch {}
        close();
        await load();
      });
      es.addEventListener("error", () => {
        // EventSource will auto-reconnect; polling fallback below is a safety net.
      });
      if (!isMounted.current) close();
    } catch {
      streamWorked = false;
    }

    if (!streamWorked) {
      const startedAt = Date.now();
      while (isMounted.current) {
        if (Date.now() - startedAt > 10 * 60 * 1000) {
          setJobErr("Still waiting for Hermes. Reload messages later to see if it completed.");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const jr = await apiGet<{ ok: boolean; job: MessageJob }>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/message_jobs/${encodeURIComponent(jobId)}`
        );
        setJob(jr.job);
        if (jr.job.status === "succeeded") {
          await load();
          break;
        }
        if (jr.job.status === "failed" || jr.job.status === "timeout") {
          setJobErr(jr.job.error || "Hermes job failed.");
          await load();
          break;
        }
      }
    }
  }

  async function retryJob() {
    if (!job) return;
    setLoading(true);
    setErr(null);
    setJobErr(null);
    try {
      const r = await apiPost<{ ok: boolean; job: MessageJob }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/message_jobs/${encodeURIComponent(job.id)}/retry`,
        {}
      );
      setJob(r.job);
      await watchJob(r.job.id);
    } catch (e) {
      setJobErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveTitle() {
    setLoading(true);
    setTitleErr(null);
    try {
      const r = await apiPatch<{ ok: boolean; session: Session }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
        { title: titleDraft }
      );
      setSession(r.session);
      const nextTitle = r.session?.title || "";
      setTitleDraft(nextTitle);
      setTitleSaved(nextTitle);
    } catch (e) {
      setTitleErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function copyMessage(m: Message) {
    const text = m.payload?.text ? String(m.payload.text) : JSON.stringify(m.payload ?? {}, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for contexts where Clipboard API is unavailable.
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "true");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }

    setCopiedId(m.id);
    window.setTimeout(() => {
      setCopiedId((cur) => (cur === m.id ? null : cur));
    }, 1400);
  }

  async function resendMessage(m: Message) {
    const text = m.payload?.text ? String(m.payload.text) : "";
    await submitMessage(text, { clearDraft: false });
  }

  function formatWhen(iso?: string | null) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return String(iso);
    }
  }

  function scheduleLabel(s: Schedule) {
    const cfg = s.config && typeof s.config === "object" ? s.config : null;
    if (cfg?.mode === "interval" && cfg?.every && cfg?.unit) return `Every ${cfg.every} ${cfg.unit}`;
    if (cfg?.mode === "times_per_day" && cfg?.count && cfg?.startTime) return `${cfg.count}×/day (start ${cfg.startTime})`;
    if (cfg?.mode === "daily_times" && Array.isArray(cfg?.times) && cfg.times.length) return `Daily at ${cfg.times.join(", ")}`;
    if (s.intervalSeconds) return `Every ${s.intervalSeconds}s`;
    return "Interval";
  }

  async function createSchedule() {
    if (!scheduleEnabled) return;
    if (!canCreateSchedule) return;
    setLoading(true);
    setErr(null);
    try {
      let startAtIso: string | undefined = undefined;
      if (scheduleStartAt) {
        const d = new Date(scheduleStartAt);
        if (!Number.isNaN(d.getTime())) startAtIso = d.toISOString();
      }
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
      await apiPost<{ ok: boolean; schedule: Schedule }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/schedules`,
        {
          name: "Session automation",
          enabled: true,
          ...payload,
          ...(startAtIso ? { startAt: startAtIso } : {}),
          runTemplate: {
            title: `Scheduled: ${session?.title ? session.title : sessionId}`,
            goal: `Continue session: ${session?.title ? session.title : sessionId}`,
          },
        }
      );
      toast({
        title: "Schedule created",
        description:
          scheduleMode === "interval"
            ? `Will run every ${scheduleEvery} ${scheduleUnit}${scheduleStartAt ? ` (starting ${formatWhen(startAtIso || "")})` : ""}.`
            : `Will run ${scheduleTimesPerDay}×/day starting ${scheduleStartTime}${scheduleStartAt ? ` (starting ${formatWhen(startAtIso || "")})` : ""}.`,
      });
      setScheduleEnabled(false);
      setScheduleStartAt("");
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function toggleSchedule(s: Schedule, enabled: boolean) {
    setLoading(true);
    setErr(null);
    try {
      await apiPatch<{ ok: boolean; schedule: Schedule }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/schedules/${encodeURIComponent(
          s.id
        )}`,
        { enabled }
      );
      toast({ title: enabled ? "Schedule enabled" : "Schedule paused", description: s.name });
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteSchedule(s: Schedule) {
    const ok = window.confirm(`Delete schedule "${s.name}"?`);
    if (!ok) return;
    setLoading(true);
    setErr(null);
    try {
      await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/schedules/${encodeURIComponent(
          s.id
        )}`,
        { method: "DELETE", headers: { "x-api-key": getApiKey() } }
      );
      toast({ title: "Schedule deleted", description: s.name });
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  function beginEditSchedule(s: Schedule) {
    setEditingScheduleId(s.id);
    setEditName(s.name || "");
    const cfg = s.config && typeof s.config === "object" ? s.config : {};
    if (cfg?.mode === "times_per_day") {
      setEditMode("times_per_day");
      setEditTimesPerDay(Number(cfg.count || 2));
      setEditStartTime(typeof cfg.startTime === "string" ? cfg.startTime : "09:00");
    } else {
      setEditMode("interval");
      const seconds = typeof s.intervalSeconds === "number" && s.intervalSeconds > 0 ? s.intervalSeconds : 3600;
      const minutes = Math.max(1, Math.round(seconds / 60));
      setEditEvery(minutes);
      setEditUnit("minutes");
    }
  }

  async function saveScheduleEdit(s: Schedule) {
    setLoading(true);
    setErr(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const patch =
        editMode === "interval"
          ? {
              name: editName,
              timezone: tz,
              intervalSeconds: editIntervalSeconds,
              config: { mode: "interval", every: editEvery, unit: editUnit },
            }
          : {
              name: editName,
              timezone: tz,
              intervalSeconds: null,
              config: { mode: "times_per_day", count: editTimesPerDay, startTime: editStartTime },
            };
      await apiPatch<{ ok: boolean; schedule: Schedule }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/schedules/${encodeURIComponent(
          s.id
        )}`,
        patch
      );
      toast({ title: "Schedule updated", description: editName || s.id });
      setEditingScheduleId(null);
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
          <div className="text-sm text-slate-600">Session</div>
          <h1 className="mt-1 text-2xl font-semibold">{session?.title ? session.title : sessionId}</h1>
          <div className="mt-1 text-xs text-slate-500">Project: {projectId}</div>
          <div className="mt-1 text-xs text-slate-400">ID: {sessionId}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/projects/${encodeURIComponent(projectId)}`}>
            <Button variant="secondary">Back</Button>
          </Link>
        </div>
      </header>

      <Separator className="my-8" />

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-sm text-slate-600">Rename session</div>
              <HelpTip text="This only renames the dashboard session record. It does not rename anything inside Hermes." />
            </div>
            <div className="text-xs text-slate-500">This only renames the dashboard session record.</div>
          </div>
          <div className="flex w-full flex-col gap-2 md:w-[520px]">
            <div className="flex items-center gap-2">
              <Input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} placeholder="Session title" />
              <Button onClick={saveTitle} disabled={!canSaveTitle || loading}>
                Save
              </Button>
            </div>
            {titleErr ? <div className="text-xs text-red-300">{titleErr}</div> : null}
          </div>
        </div>
      </Card>

      <Separator className="my-8" />

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-sm text-slate-600">Automation</div>
              <HelpTip text="Interval scheduling (v1): runs are evenly spaced. Time-of-day scheduling comes next." />
            </div>
            <div className="text-xs text-slate-500">Create a schedule tied to this session (durable, survives restarts).</div>
          </div>
          <div className="flex w-full flex-col gap-2 md:w-[520px]">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
                disabled={loading}
              />
              Create schedule for this session
            </label>
            {scheduleEnabled ? (
              <div className="grid gap-2 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] p-3">
                <div className="grid gap-1">
                  <div className="text-xs text-slate-500">Mode</div>
                  <select
                    value={scheduleMode}
                    onChange={(e) => setScheduleMode(e.target.value as any)}
                    className="h-9 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-2 text-sm text-[color:var(--app-text)]"
                  >
                    <option value="interval">Interval (every X)</option>
                    <option value="times_per_day">Times per day</option>
                  </select>
                </div>

                {scheduleMode === "interval" ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
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
                    {!canCreateSchedule ? <span className="text-red-300">Interval must be ≥ 60 seconds.</span> : null}
                  </div>
                ) : null}

                {scheduleMode === "times_per_day" ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
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
                    {!canCreateSchedule ? <span className="text-red-300">Pick 1–24 times/day and a start time.</span> : null}
                  </div>
                ) : null}
                {scheduleMode === "times_per_day" ? (
                  <div className="text-xs text-slate-500">
                    {timesPerDayPreview ? (
                      <>
                        Runs daily at <span className="text-slate-700">{timesPerDayPreview}</span> ({localTz}).
                      </>
                    ) : (
                      <>Pick a start time and times/day to preview run times.</>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">Runs are evenly spaced; first scheduled run starts after the interval.</div>
                )}
                <div className="grid gap-1">
                  <div className="text-xs text-slate-500">Start at (optional)</div>
                  <Input
                    type="datetime-local"
                    value={scheduleStartAt}
                    onChange={(e) => setScheduleStartAt(e.target.value)}
                    className="h-9"
                  />
                  <div className="text-[11px] text-slate-500">If empty, first run is scheduled after the interval.</div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setScheduleEnabled(false)} disabled={loading}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={createSchedule} disabled={loading || !canCreateSchedule}>
                    Create schedule
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {schedules.map((s) => (
            <div
              key={s.id}
              className="flex flex-col gap-2 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] p-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {scheduleLabel(s)} · Next: <span className="text-slate-700">{formatWhen(s.nextRunAt)}</span>
                  {s.lastRunAt ? (
                    <>
                      {" "}· Last: <span className="text-slate-700">{formatWhen(s.lastRunAt)}</span>
                    </>
                  ) : null}
                </div>
                <div className="mt-1 truncate text-[11px] text-slate-400">{s.id}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => beginEditSchedule(s)} disabled={loading}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => toggleSchedule(s, !s.enabled)}
                  disabled={loading}
                >
                  {s.enabled ? "Pause" : "Resume"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteSchedule(s)} disabled={loading}>
                  Delete
                </Button>
                <div className="rounded-full bg-[color:var(--surface-2)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
                  {s.enabled ? "enabled" : "paused"}
                </div>
              </div>
              {editingScheduleId === s.id ? (
                <div className="mt-3 w-full rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] p-3">
                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="grid gap-1 md:col-span-1">
                      <div className="text-xs text-slate-500">Name</div>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9" />
                    </div>
                    <div className="grid gap-1 md:col-span-1">
                      <div className="text-xs text-slate-500">Mode</div>
                      <select
                        value={editMode}
                        onChange={(e) => setEditMode(e.target.value as any)}
                        className="h-9 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-2 text-sm text-[color:var(--app-text)]"
                      >
                        <option value="interval">Interval</option>
                        <option value="times_per_day">Times per day</option>
                      </select>
                    </div>
                    <div className="grid gap-1 md:col-span-1">
                      <div className="text-xs text-slate-500">Next run</div>
                      <div className="h-9 truncate rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-slate-600">
                        {formatWhen(s.nextRunAt)}
                      </div>
                    </div>
                  </div>

                  {editMode === "interval" ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className="text-slate-500">Every</span>
                      <Input
                        value={String(editEvery)}
                        onChange={(e) => setEditEvery(Number(e.target.value || 0))}
                        className="h-8 w-[92px]"
                      />
                      <select
                        value={editUnit}
                        onChange={(e) => setEditUnit(e.target.value as any)}
                        className="h-8 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-2 text-xs text-[color:var(--app-text)]"
                      >
                        <option value="minutes">minutes</option>
                        <option value="hours">hours</option>
                        <option value="days">days</option>
                      </select>
                    </div>
                  ) : null}

                  {editMode === "times_per_day" ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className="text-slate-500">Run</span>
                      <Input
                        value={String(editTimesPerDay)}
                        onChange={(e) => setEditTimesPerDay(Number(e.target.value || 0))}
                        className="h-8 w-[92px]"
                      />
                      <span className="text-slate-500">times/day starting</span>
                      <Input
                        type="time"
                        value={editStartTime}
                        onChange={(e) => setEditStartTime(e.target.value)}
                        className="h-8 w-[132px]"
                      />
                    </div>
                  ) : null}
                  {editMode === "times_per_day" ? (
                    <div className="mt-2 text-xs text-slate-500">
                      {editTimesPerDayPreview ? (
                        <>
                          Runs daily at <span className="text-slate-700">{editTimesPerDayPreview}</span> ({localTz}).
                        </>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-slate-500">Runs are evenly spaced; next run is recalculated on save.</div>
                  )}

                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditingScheduleId(null)} disabled={loading}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => saveScheduleEdit(s)} disabled={loading || !canSaveScheduleEdit}>
                      Save
                    </Button>
                  </div>
                  {!canSaveScheduleEdit ? (
                    <div className="mt-2 text-xs text-red-300">
                      {editMode === "interval" ? "Interval must be ≥ 60 seconds." : "Pick 1–24 times/day and a start time."}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {!schedules.length ? <div className="text-sm text-slate-600">No schedules yet.</div> : null}
        </div>
      </Card>

      <Separator className="my-8" />

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="text-sm text-slate-600">Send a message</div>
              <HelpTip text="Sends a user_message event, creates a MessageJob, and waits for Hermes to produce an assistant_message." />
            </div>
            <div className="mt-1 text-xs text-slate-500">This persists a user event, queues Hermes work, and updates when the reply is ready.</div>
          </div>
          <div className="flex w-full gap-2 md:w-[520px]">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message" />
            <Button onClick={send} disabled={!canSend || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
        {err ? <div className="mt-3 text-xs text-red-300">{err}</div> : null}
        {job ? (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-600">
            <div className="truncate">
              Job: <span className="text-slate-800">{job.id}</span>
            </div>
            <div className="flex items-center gap-2">
              {(job.status === "failed" || job.status === "timeout") && (
                <Button size="sm" variant="secondary" onClick={retryJob} disabled={loading}>
                  Retry
                </Button>
              )}
              <div className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700">{job.status}</div>
            </div>
          </div>
        ) : null}
        {job && (job.totalTokens != null || job.estimatedUsd != null || job.durationMs != null) ? (
          <div className="mt-2 text-xs text-slate-500">
            {job.totalTokens != null ? <>Tokens: <span className="text-slate-800">{job.totalTokens}</span></> : null}
            {job.durationMs != null ? (
              <>
                {" "}· Time: <span className="text-slate-800">{Math.round(job.durationMs / 1000)}s</span>
              </>
            ) : null}
            {job.estimatedUsd != null ? (
              <>
                {" "}· Est. cost: <span className="text-slate-800">${job.estimatedUsd.toFixed(4)}</span>
              </>
            ) : null}
            {job.model ? (
              <>
                {" "}· Model: <span className="text-slate-800">{job.model}</span>
              </>
            ) : null}
          </div>
        ) : null}
        {jobErr ? <div className="mt-2 text-xs text-red-300">{jobErr}</div> : null}
      </Card>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Hermes is working…
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        {messages.map((m) => (
          <Card key={m.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="text-xs text-slate-500">{new Date(m.createdAt).toLocaleString()}</div>
              <div className="flex items-center gap-2">
                {m.type === "user_message" ? (
                  <Button variant="ghost" size="sm" onClick={() => resendMessage(m)} disabled={loading}>
                    <RotateCcw className="h-4 w-4" />
                    Resend
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => copyMessage(m)}>
                  {copiedId === m.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedId === m.id ? "Copied" : "Copy"}
                </Button>
                <div className="rounded-full bg-[color:var(--surface-2)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
                  {m.type}
                </div>
              </div>
            </div>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs text-slate-800">
              {m.payload?.text ? String(m.payload.text) : JSON.stringify(m.payload, null, 2)}
            </pre>
          </Card>
        ))}
      </div>
    </div>
  );
}
