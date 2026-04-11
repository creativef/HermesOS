"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { apiDelete, apiGet, apiPost } from "@/lib/http";

type Project = {
  id: string;
  name: string;
  slug: string;
  createdAt?: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canCreate = useMemo(() => newName.trim().length > 0, [newName]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; projects: Project[] }>("/api/v1/projects");
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
    if (!canCreate) return;
    setLoading(true);
    setErr(null);
    try {
      await apiPost("/api/v1/projects", { name: newName });
      setNewName("");
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteProject(project: Project) {
    if (deletingId) return;
    const label = project.name || project.id;
    if (!window.confirm(`Delete project "${label}"?`)) return;
    setDeletingId(project.id);
    setErr(null);
    try {
      await apiDelete(`/api/v1/projects/${encodeURIComponent(project.id)}`);
      await load();
    } catch (e) {
      const msg = String(e);
      // If the API refuses due to existing sessions, offer force delete.
      if (msg.startsWith("Error: 409") || msg.includes(" 409 ")) {
        if (
          window.confirm(
            `This project has sessions. Force delete "${label}" and ALL its sessions/events/jobs? This cannot be undone.`
          )
        ) {
          await apiDelete(`/api/v1/projects/${encodeURIComponent(project.id)}?force=1`);
          await load();
        }
      } else {
        setErr(msg);
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm text-slate-600">Workspace</div>
          <h1 className="mt-1 text-2xl font-semibold">Projects</h1>
        </div>
        <div className="flex w-full flex-col gap-2 md:w-[520px]">
          <div className="flex items-center gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New project name" />
            <Button onClick={createProject} disabled={!canCreate || loading}>
              Create
            </Button>
            <Link href="/">
              <Button variant="secondary">Home</Button>
            </Link>
          </div>
          {err ? <div className="text-xs text-red-300">{err}</div> : null}
        </div>
      </header>

      <Separator className="my-8" />

      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-lg font-medium">{p.name}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{p.id}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  className="text-red-700 hover:text-red-800"
                  onClick={() => deleteProject(p)}
                  disabled={Boolean(deletingId)}
                >
                  {deletingId === p.id ? "Deleting…" : "Delete"}
                </Button>
                <Link href={`/projects/${encodeURIComponent(p.id)}`}>
                  <Button variant="secondary">Open</Button>
                </Link>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {loading ? <div className="mt-6 text-sm text-slate-600">Loading…</div> : null}
    </div>
  );
}
