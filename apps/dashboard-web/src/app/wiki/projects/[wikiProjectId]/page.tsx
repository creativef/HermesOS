"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPatch, apiPost } from "@/lib/http";
import { useToast } from "@/components/ui/toast";

type WikiProject = {
  id: string;
  name: string;
  domain?: string | null;
  status: string;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
};

type WikiSource = {
  id: string;
  kind: string;
  title?: string | null;
  url?: string | null;
  createdAt: string;
  updatedAt: string;
};

type WikiBuild = {
  id: string;
  status: string;
  title?: string | null;
  goal?: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function WikiProjectPage() {
  const { toast } = useToast();
  const params = useParams<{ wikiProjectId: string }>();
  const wikiProjectId = useMemo(() => decodeURIComponent(params.wikiProjectId), [params.wikiProjectId]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [project, setProject] = useState<WikiProject | null>(null);
  const [sources, setSources] = useState<WikiSource[]>([]);
  const [builds, setBuilds] = useState<WikiBuild[]>([]);
  const [autoBuildOnSource, setAutoBuildOnSource] = useState(false);

  const [sourceKind, setSourceKind] = useState("text");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceContent, setSourceContent] = useState("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; wikiProject: WikiProject; sources: WikiSource[]; builds: WikiBuild[] }>(
        `/api/v1/wiki_projects/${encodeURIComponent(wikiProjectId)}`
      );
      setProject(r.wikiProject);
      setAutoBuildOnSource(Boolean(r.wikiProject?.metadata?.autoBuildOnSource));
      setSources(r.sources || []);
      setBuilds(r.builds || []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikiProjectId]);

  useEffect(() => {
    const es = new EventSource(`/api/v1/wiki_projects/${encodeURIComponent(wikiProjectId)}/stream`);
    es.addEventListener("changed", () => load());
    es.addEventListener("error", () => {
      // keep UI usable even if stream fails
    });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wikiProjectId]);

  async function addSource() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiPost<{ ok: boolean; autoBuildQueued?: boolean }>(
        `/api/v1/wiki_projects/${encodeURIComponent(wikiProjectId)}/sources`,
        {
          kind: sourceKind,
          title: sourceTitle.trim(),
          url: sourceUrl.trim(),
          content: sourceContent,
        }
      );
      toast({
        title: "Source added",
        description: r.autoBuildQueued ? "Auto-build queued" : sourceTitle.trim() || sourceUrl.trim() || sourceKind,
      });
      setSourceTitle("");
      setSourceUrl("");
      setSourceContent("");
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function toggleAutoBuild(next: boolean) {
    if (!project) return;
    setAutoBuildOnSource(next);
    try {
      const nextMeta = { ...(project.metadata || {}), autoBuildOnSource: next };
      const r = await apiPatch<{ ok: boolean; wikiProject: WikiProject }>(
        `/api/v1/wiki_projects/${encodeURIComponent(wikiProjectId)}`,
        { metadata: nextMeta }
      );
      setProject(r.wikiProject);
      toast({ title: next ? "Auto-build enabled" : "Auto-build disabled", description: "Applies to future sources" });
    } catch (e) {
      setAutoBuildOnSource(Boolean(project.metadata?.autoBuildOnSource));
      toast({ title: "Failed to update setting", description: String(e) });
    }
  }

  async function startBuild() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiPost<{ ok: boolean; build: WikiBuild }>(
        `/api/v1/wiki_projects/${encodeURIComponent(wikiProjectId)}/builds`,
        {}
      );
      toast({ title: "Build queued", description: r.build?.id || "Build" });
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const latestBuild = builds[0] || null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-slate-600">Wiki project</div>
          <h1 className="mt-1 truncate text-2xl font-semibold">{project?.name || wikiProjectId}</h1>
          <div className="mt-1 truncate text-xs text-slate-500">{project?.domain || "—"}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/wiki">
            <Button variant="secondary">Back</Button>
          </Link>
          <Link href={`/wiki/projects/${encodeURIComponent(wikiProjectId)}/graph`}>
            <Button variant="ghost">Graph</Button>
          </Link>
          <Link href={`/wiki/files/workspaces/${encodeURIComponent(wikiProjectId)}/index.md`}>
            <Button variant="ghost">Open workspace files</Button>
          </Link>
          <Button onClick={startBuild} disabled={loading}>
            Build wiki
          </Button>
        </div>
      </header>

      <Separator className="my-8" />

      {err ? <div className="mb-4 text-xs text-red-300">{err}</div> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-600">Sources</div>
            <div className="text-xs text-slate-500">{sources.length}</div>
          </div>
          <div className="mt-3 grid gap-3">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-[color:var(--border)] px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">Auto-build on new source</div>
                <div className="mt-0.5 text-xs text-slate-500">Queues a build automatically when you add sources (if no build is running).</div>
              </div>
              <input
                type="checkbox"
                checked={autoBuildOnSource}
                onChange={(e) => toggleAutoBuild(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
            <div className="grid gap-2 md:grid-cols-2">
              <select
                value={sourceKind}
                onChange={(e) => setSourceKind(e.target.value)}
                className="h-10 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--app-text)]"
              >
                <option value="text">text</option>
                <option value="url">url</option>
                <option value="youtube">youtube</option>
                <option value="transcript">transcript</option>
                <option value="pdf">pdf</option>
              </select>
              <Input value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} placeholder="Title (optional)" />
            </div>
            <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="URL (optional)" />
            <Textarea
              value={sourceContent}
              onChange={(e) => setSourceContent(e.target.value)}
              placeholder="Paste text, transcript, or notes (optional)"
              className="min-h-[160px]"
            />
            <div className="flex items-center justify-end">
              <Button onClick={addSource} disabled={loading}>
                Add source
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-2">
            {sources.slice(0, 10).map((s) => (
              <div key={s.id} className="rounded-md border border-[color:var(--border)] px-3 py-2">
                <div className="truncate text-sm font-medium">{s.title || s.url || s.id}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {s.kind} · {new Date(s.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
            {sources.length > 10 ? <div className="text-xs text-slate-500">+ {sources.length - 10} more…</div> : null}
            {!sources.length ? <div className="text-sm text-slate-600">No sources yet. Add one to build pages.</div> : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-600">Builds</div>
            <div className="text-xs text-slate-500">{builds.length}</div>
          </div>
          <div className="mt-3 grid gap-3">
            {latestBuild ? (
              <div className="rounded-md border border-[color:var(--border)] px-3 py-2">
                <div className="truncate text-sm font-medium">{latestBuild.title || latestBuild.id}</div>
                <div className="mt-0.5 text-xs text-slate-500">Status: {latestBuild.status}</div>
                <div className="mt-2 flex items-center gap-2">
                  <Link href={`/wiki/projects/${encodeURIComponent(wikiProjectId)}/builds/${encodeURIComponent(latestBuild.id)}`}>
                    <Button variant="secondary" size="sm">
                      Open timeline
                    </Button>
                  </Link>
                  <Link href={`/wiki/files/workspaces/${encodeURIComponent(wikiProjectId)}/index.md`}>
                    <Button variant="ghost" size="sm">
                      View index.md
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">No builds yet.</div>
            )}

            <div className="grid gap-2">
              {builds.slice(0, 8).map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--border)] px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{b.title || b.id}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {b.status} · {new Date(b.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Link href={`/wiki/projects/${encodeURIComponent(wikiProjectId)}/builds/${encodeURIComponent(b.id)}`}>
                    <Button variant="ghost" size="sm">
                      Open
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {loading ? <div className="mt-6 text-sm text-slate-600">Loading…</div> : null}
    </div>
  );
}
