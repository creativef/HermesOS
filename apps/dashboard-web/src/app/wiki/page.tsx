"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiPost } from "@/lib/http";
import { useToast } from "@/components/ui/toast";

type WikiProject = {
  id: string;
  name: string;
  domain?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export default function WikiProjectsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [projects, setProjects] = useState<WikiProject[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; projects: WikiProject[] }>("/api/v1/wiki_projects");
      setProjects(r.projects || []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createProject() {
    if (!name.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await apiPost<{ ok: boolean; wikiProject: WikiProject }>("/api/v1/wiki_projects", {
        name: name.trim(),
        domain: domain.trim(),
      });
      toast({ title: "Wiki project created", description: r.wikiProject?.name || name.trim() });
      setCreateOpen(false);
      setName("");
      setDomain("");
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
          <div className="text-sm text-slate-600">Knowledge</div>
          <h1 className="mt-1 text-2xl font-semibold">Wiki Projects</h1>
          <div className="mt-1 text-xs text-slate-500">The llm-wiki ecosystem lives here (separate from Companies/Projects).</div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateOpen((v) => !v)}>{createOpen ? "Close" : "New wiki project"}</Button>
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Link href="/wiki/files">
            <Button variant="ghost">Browse files</Button>
          </Link>
        </div>
      </header>

      <Separator className="my-8" />

      {createOpen ? (
        <Card>
          <div className="text-sm text-slate-600">Create wiki project</div>
          <div className="mt-3 grid gap-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Personal Health)" />
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Domain (optional)" />
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={createProject} disabled={loading || !name.trim()}>
                Create
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {err ? <div className="mt-3 text-xs text-red-300">{err}</div> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-lg font-medium">{p.name}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{p.domain || "—"}</div>
                <div className="mt-2 text-xs text-slate-600">Status: {p.status}</div>
              </div>
              <div className="flex flex-col gap-2">
                <Link href={`/wiki/projects/${encodeURIComponent(p.id)}`}>
                  <Button variant="secondary">Open</Button>
                </Link>
              </div>
            </div>
          </Card>
        ))}
        {!projects.length ? <div className="text-sm text-slate-600">No wiki projects yet.</div> : null}
      </div>

      {loading ? <div className="mt-6 text-sm text-slate-600">Loading…</div> : null}
    </div>
  );
}

