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

export default function SessionDetailPage() {
  const params = useParams<{ projectId: string; sessionId: string }>();
  const projectId = decodeURIComponent(params.projectId);
  const sessionId = decodeURIComponent(params.sessionId);

  const [session, setSession] = useState<Session | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaved, setTitleSaved] = useState("");
  const [titleErr, setTitleErr] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
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
