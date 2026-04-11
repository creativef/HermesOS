"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { getApiKey, setApiKey } from "@/lib/auth";
import { apiGet } from "@/lib/http";
import { getSelectedCompanyId, getSelectedProjectId } from "@/lib/workspace";
import { UsageCharts } from "@/components/usage-charts";
import { HelpTip } from "@/components/help-tip";

type Overview = {
  ok: boolean;
  usage?: {
    cost_per_1k_tokens_usd?: number;
    range_start_utc?: string;
    months_back?: number;
    hours_back?: number;
    days_back?: number;
    weeks_back?: number;
    month_start_utc: string;
    current_month: { month_start_utc: string; tokens: number; usd: number };
    hourly?: Array<{ hour_start_utc: string; tokens: number; usd: number }>;
    daily?: Array<{ day_start_utc: string; tokens: number; usd: number }>;
    weekly?: Array<{ week_start_utc: string; tokens: number; usd: number }>;
    monthly: Array<{ month_start_utc: string; tokens: number; usd: number }>;
  };
  counts: {
    companies: number;
    projects: number;
    sessions: number;
    guidance_events: number;
    workspace_session_maps: number;
  };
  recent: {
    sessions: Array<{
      id: string;
      title: string | null;
      status: string;
      createdAt: string;
      project: { id: string; name: string };
    }>;
    events: Array<{
      id: string;
      eventType: string;
      createdAt: string;
      project: { id: string; name: string } | null;
      session: { id: string; title: string | null; projectId: string } | null;
    }>;
  };
};

export default function HomePage() {
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [apiErr, setApiErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    setApiKeyValue(getApiKey());
    setCompanyId(getSelectedCompanyId());
    setProjectId(getSelectedProjectId());
  }, []);

  const keyIsSet = useMemo(() => Boolean(apiKeyValue), [apiKeyValue]);

  async function loadOverview() {
    setLoading(true);
    setApiErr(null);
    try {
      const qs = new URLSearchParams();
      if (companyId) qs.set("companyId", companyId);
      if (projectId) qs.set("projectId", projectId);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const r = await apiGet<Overview>(`/api/v1/overview${suffix}`);
      setOverview(r);
    } catch (e) {
      setApiErr(String(e));
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!getApiKey()) return;
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, projectId]);

  const counts = overview?.counts;
  const usage = overview?.usage;
  const usageRate = typeof usage?.cost_per_1k_tokens_usd === "number" ? usage.cost_per_1k_tokens_usd : null;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="text-sm text-slate-600">Hermes Workspace</div>
            <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
            <p className="max-w-xl text-sm text-slate-700">A calm snapshot of activity across projects and sessions.</p>
          </div>
          <div className="flex w-full flex-col gap-2 md:w-[420px]">
            <div className="flex items-center gap-2">
              <Input
                value={apiKeyValue}
                onChange={(e) => setApiKeyValue(e.target.value)}
                placeholder="x-api-key (ADMIN_API_KEY)"
              />
              <HelpTip
                side="left"
                text="This is your admin API key for the local dashboard API. It is sent as the x-api-key header on /api/v1/* requests."
              />
              <Button
                onClick={() => {
                  setApiKey(apiKeyValue);
                  loadOverview();
                }}
              >
                Set key
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setApiKeyValue("devkey");
                  setApiKey("devkey");
                  loadOverview();
                }}
              >
                Use devkey
              </Button>
            </div>
            <div className="text-xs text-slate-500">
              API key: <span className={keyIsSet ? "text-emerald-700" : "text-amber-700"}>{keyIsSet ? "set" : "missing"}</span>
            </div>
            <div className="text-xs text-slate-500">
              Backend requires <code className="rounded bg-slate-100 px-1 text-slate-800">x-api-key</code> for all{" "}
              <code className="rounded bg-slate-100 px-1 text-slate-800">/api/v1/*</code>{" "}
              except health.
            </div>
          </div>
        </header>

        <Separator className="my-8" />

        {apiErr ? (
          <Card className="bg-red-50">
            <div className="text-sm text-red-800">API error</div>
            <div className="mt-2 text-xs text-red-700">{apiErr}</div>
          </Card>
        ) : null}

        <div className="grid gap-6 md:grid-cols-4">
          <Card className="md:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-600">Quick Access</div>
                <div className="mt-1 text-lg font-medium">Projects</div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={loadOverview} disabled={!keyIsSet || loading}>
                  Refresh
                </Button>
                <Link href="/health">
                  <Button variant="ghost">Health</Button>
                </Link>
                <Link href="/projects">
                  <Button disabled={!keyIsSet}>Open</Button>
                </Link>
              </div>
            </div>
            <div className="mt-4 text-sm text-slate-700">
              Browse projects, create sessions, and follow the session timeline with messages and guidance events.
            </div>
          </Card>

          <Card>
            <div className="text-sm text-slate-600">Projects</div>
            <div className="mt-2 text-3xl font-semibold">{counts ? counts.projects : "—"}</div>
            <div className="mt-1 text-xs text-slate-500">Tracked projects</div>
          </Card>
          <Card>
            <div className="text-sm text-slate-600">Sessions</div>
            <div className="mt-2 text-3xl font-semibold">{counts ? counts.sessions : "—"}</div>
            <div className="mt-1 text-xs text-slate-500">Total sessions</div>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <Card>
            <div className="text-sm text-slate-600">Guidance events</div>
            <div className="mt-2 text-3xl font-semibold">{counts ? counts.guidance_events : "—"}</div>
            <div className="mt-1 text-xs text-slate-500">Total events</div>
          </Card>
          <Card>
            <div className="text-sm text-slate-600">Companies</div>
            <div className="mt-2 text-3xl font-semibold">{counts ? counts.companies : "—"}</div>
            <div className="mt-1 text-xs text-slate-500">Organizations</div>
          </Card>
          <Card>
            <div className="text-sm text-slate-600">Workspace maps</div>
            <div className="mt-2 text-3xl font-semibold">{counts ? counts.workspace_session_maps : "—"}</div>
            <div className="mt-1 text-xs text-slate-500">Artifacts/mappings</div>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-slate-600">This month</div>
                <div className="mt-1 text-lg font-medium">Token usage</div>
              </div>
              <HelpTip text="Tokens are summed from MessageJobs (Hermes runs) recorded by the dashboard API." />
            </div>
            <div className="mt-3 text-3xl font-semibold">{usage ? usage.current_month.tokens.toLocaleString() : "—"}</div>
            <div className="mt-1 text-xs text-slate-500">Total tokens (all message jobs)</div>
          </Card>
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-slate-600">This month</div>
                <div className="mt-1 text-lg font-medium">AI cost</div>
              </div>
              <HelpTip text="Cost is an estimate: (totalTokens / 1000) × COST_PER_1K_TOKENS_USD on the dashboard API." />
            </div>
            <div className="mt-3 text-3xl font-semibold">
              {usage ? `$${Number(usage.current_month.usd || 0).toFixed(4)}` : "—"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {usageRate != null ? `Estimated at $${usageRate}/1K tokens` : "Set `COST_PER_1K_TOKENS_USD` to estimate costs"} · last 6 months shown below
            </div>
            <div className="mt-4 grid gap-2">
              {(usage?.monthly || []).slice(0, 6).map((m) => (
                <div key={m.month_start_utc} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs text-slate-700">{m.month_start_utc.slice(0, 7)}</div>
                  <div className="text-xs text-slate-600">
                    {m.tokens.toLocaleString()} tok · ${Number(m.usd || 0).toFixed(4)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="mt-6">
          <UsageCharts usage={usage} />
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Card>
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-sm text-slate-600">Recent</div>
                <div className="mt-1 text-lg font-medium">Sessions</div>
              </div>
              <Link href="/projects">
                <Button variant="ghost">All projects</Button>
              </Link>
            </div>
            <div className="mt-4 grid gap-2">
              {(overview?.recent.sessions || []).slice(0, 8).map((s) => (
                <Link
                  key={s.id}
                  href={`/projects/${encodeURIComponent(s.project.id)}/sessions/${encodeURIComponent(s.id)}`}
                  className="rounded-xl border border-slate-200 bg-white p-3 transition hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{s.title || s.id}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{s.project.name}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700">{s.status}</div>
                      <div className="mt-2 text-[11px] text-slate-500">{new Date(s.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                </Link>
              ))}
              {!overview && !apiErr ? (
                <div className="text-sm text-slate-600">Set your key and refresh to load overview.</div>
              ) : null}
            </div>
          </Card>

          <Card>
            <div className="text-sm text-slate-600">Recent</div>
            <div className="mt-1 text-lg font-medium">Guidance events</div>
            <div className="mt-4 grid gap-2">
              {(overview?.recent.events || []).slice(0, 10).map((e) => {
                const project = e.project || (e.session ? { id: e.session.projectId, name: e.session.projectId } : null);
                const href =
                  project && e.session
                    ? `/projects/${encodeURIComponent(project.id)}/sessions/${encodeURIComponent(e.session.id)}`
                    : project
                      ? `/projects/${encodeURIComponent(project.id)}`
                      : "/projects";
                return (
                  <Link
                    key={e.id}
                    href={href}
                    className="rounded-xl border border-slate-200 bg-white p-3 transition hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{e.eventType}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {project ? project.name : "unknown project"}
                          {e.session ? ` · ${e.session.title || e.session.id}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] text-slate-500">{new Date(e.createdAt).toLocaleString()}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
