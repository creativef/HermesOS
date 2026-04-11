"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiPost } from "@/lib/http";

type RunStep = {
  id: string;
  index: number;
  kind: string;
  status: string;
  input?: any;
  error?: string | null;
  hermesResponseId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
};

type RunEvent = {
  id: string;
  level: string;
  message: string;
  createdAt: string;
  payload?: any;
  stepId?: string | null;
};

type Approval = {
  id: string;
  status: string;
  prompt: string;
  createdAt?: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  stepId: string;
};

type ProjectRun = {
  id: string;
  projectId: string;
  sessionId?: string | null;
  status: string;
  title?: string | null;
  goal: string;
  createdAt?: string;
  updatedAt?: string;
  hermesLastResponseId?: string | null;
  steps: RunStep[];
  events: RunEvent[];
  approvals: Approval[];
};

function isTerminal(status: string) {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function formatWhen(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function stepTitle(step: RunStep) {
  const summary = step.input?.summary ? String(step.input.summary) : "";
  if (summary) return summary;
  const prompt = step.input?.prompt ? String(step.input.prompt) : "";
  if (prompt) return prompt.slice(0, 80);
  if (step.input?.type) return String(step.input.type);
  return step.kind;
}

export default function RunDetailPage() {
  const params = useParams<{ projectId: string; runId: string }>();
  const projectId = decodeURIComponent(params.projectId);
  const runId = decodeURIComponent(params.runId);

  const [run, setRun] = useState<ProjectRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);

  const pendingApprovals = useMemo(() => {
    return (run?.approvals || []).filter((a) => a.status === "pending");
  }, [run]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; run: ProjectRun }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`
      );
      setRun(r.run);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId, runId]);

  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }

    const status = run?.status || "";
    if (!status || isTerminal(status)) return;

    pollRef.current = window.setInterval(() => {
      load();
    }, 2000);

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [run?.status, projectId, runId]);

  async function cancelRun() {
    if (!run) return;
    if (!window.confirm(`Cancel run "${run.title ? run.title : run.id}"?`)) return;
    setLoading(true);
    setErr(null);
    try {
      await apiPost(`/api/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/cancel`, {});
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function decideApproval(approvalId: string, decision: "approved" | "rejected") {
    if (decisionBusyId) return;
    setDecisionBusyId(approvalId);
    setErr(null);
    try {
      await apiPost(`/api/v1/approvals/${encodeURIComponent(approvalId)}/decision`, { decision });
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setDecisionBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm text-slate-600">Run</div>
          <h1 className="mt-1 text-2xl font-semibold">{run?.title ? run.title : runId}</h1>
          <div className="mt-1 text-xs text-slate-500">Project: {projectId}</div>
          <div className="mt-1 text-xs text-slate-400">ID: {runId}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button variant="ghost" className="text-red-700 hover:text-red-800" onClick={cancelRun} disabled={loading || !run || isTerminal(run.status)}>
            Cancel
          </Button>
          <Link href={`/projects/${encodeURIComponent(projectId)}/runs`}>
            <Button variant="secondary">Back</Button>
          </Link>
        </div>
      </header>

      <Separator className="my-8" />

      <Card>
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="text-sm text-slate-600">Status</div>
            <div className="mt-1 text-lg font-medium">{run?.status || "loading"}</div>
            <div className="mt-2 text-xs text-slate-500">Created: {formatWhen(run?.createdAt)}</div>
            <div className="mt-1 text-xs text-slate-500">Updated: {formatWhen(run?.updatedAt)}</div>
            {run?.hermesLastResponseId ? (
              <div className="mt-1 text-xs text-slate-500">Hermes last response: {run.hermesLastResponseId}</div>
            ) : null}
          </div>
          {run?.sessionId ? <div className="text-xs text-slate-500">Session: {run.sessionId}</div> : null}
        </div>
        <div className="mt-4 text-sm text-slate-800 whitespace-pre-wrap">{run?.goal || ""}</div>
        {err ? <div className="mt-3 text-xs text-red-300">{err}</div> : null}
      </Card>

      {pendingApprovals.length ? (
        <>
          <Separator className="my-8" />
          <Card>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm text-slate-600">Approvals</div>
                <div className="mt-1 text-lg font-medium">Run blocked</div>
                <div className="mt-1 text-xs text-slate-500">Approve or reject to continue.</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              {pendingApprovals.map((a) => (
                <div key={a.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Approval</div>
                  <div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{a.prompt}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button onClick={() => decideApproval(a.id, "approved")} disabled={Boolean(decisionBusyId)}>
                      {decisionBusyId === a.id ? "Working…" : "Approve"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => decideApproval(a.id, "rejected")}
                      disabled={Boolean(decisionBusyId)}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}

      <Separator className="my-8" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="text-sm text-slate-600">Steps</div>
          <div className="mt-3 grid gap-2">
            {(run?.steps || []).map((s) => (
              <div key={s.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">
                      #{s.index} • {s.kind}
                    </div>
                    <div className="mt-1 text-sm text-slate-800">{stepTitle(s)}</div>
                    <div className="mt-1 text-xs text-slate-600">Status: {s.status}</div>
                    {s.error ? <div className="mt-1 text-xs text-red-300">Error: {s.error}</div> : null}
                    {s.hermesResponseId ? (
                      <div className="mt-1 text-xs text-slate-500">Hermes response: {s.hermesResponseId}</div>
                    ) : null}
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    {s.durationMs != null ? `${Math.round(Number(s.durationMs))}ms` : ""}
                    {s.startedAt ? <div>Start: {formatWhen(s.startedAt)}</div> : null}
                    {s.endedAt ? <div>End: {formatWhen(s.endedAt)}</div> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-sm text-slate-600">Events</div>
          <div className="mt-3 grid gap-2">
            {(run?.events || []).map((ev) => (
              <div key={ev.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">
                      {ev.level} • {formatWhen(ev.createdAt)}
                    </div>
                    <div className="mt-1 text-sm text-slate-800">{ev.message}</div>
                    {ev.stepId ? <div className="mt-1 text-[11px] text-slate-500">stepId: {ev.stepId}</div> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

