"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPut } from "@/lib/http";
import { useToast } from "@/components/ui/toast";

type WikiPageSummary = {
  path: string;
  title: string;
  type: string;
  tags: string[];
  updated: string;
};

export default function WikiFilesIndexPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("");

  const [createOpen, setCreateOpen] = useState(false);
  const [draftPath, setDraftPath] = useState("concepts/new-page.md");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftType, setDraftType] = useState("concept");
  const [draftTags, setDraftTags] = useState("wiki");
  const [draftBody, setDraftBody] = useState("# New page\n\n");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; pages: WikiPageSummary[] }>("/api/v1/wiki/pages");
      setPages(r.pages || []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return pages.filter((p) => {
      if (type && String(p.type || "").toLowerCase() !== type.toLowerCase()) return false;
      if (!qq) return true;
      const hay = `${p.title} ${p.path} ${(p.tags || []).join(" ")}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [pages, q, type]);

  async function createPage() {
    const path = draftPath.trim();
    if (!path) return;
    if (!draftTitle.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      await apiPut("/api/v1/wiki/page", {
        path,
        title: draftTitle.trim(),
        type: draftType,
        tags: draftTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        body: draftBody,
      });
      toast({ title: "Wiki page saved", description: path });
      setCreateOpen(false);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deletePage(path: string) {
    if (!window.confirm(`Delete wiki page "${path}"?`)) return;
    setLoading(true);
    setErr(null);
    try {
      await apiDelete(`/api/v1/wiki/page?path=${encodeURIComponent(path)}`);
      toast({ title: "Wiki page deleted", description: path });
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
          <div className="text-sm text-slate-600">Wiki</div>
          <h1 className="mt-1 text-2xl font-semibold">Files</h1>
          <div className="mt-1 text-xs text-slate-500">Raw markdown pages stored in `wiki/`.</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/wiki">
            <Button variant="secondary">Back</Button>
          </Link>
          <Button onClick={() => setCreateOpen((v) => !v)}>{createOpen ? "Close" : "New page"}</Button>
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </header>

      <Separator className="my-8" />

      {createOpen ? (
        <Card>
          <div className="text-sm text-slate-600">Create page</div>
          <div className="mt-3 grid gap-3">
            <Input value={draftPath} onChange={(e) => setDraftPath(e.target.value)} placeholder="concepts/attention.md" />
            <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="Title" />
            <div className="grid gap-2 md:grid-cols-2">
              <select
                value={draftType}
                onChange={(e) => setDraftType(e.target.value)}
                className="h-10 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--app-text)]"
              >
                <option value="entity">entity</option>
                <option value="concept">concept</option>
                <option value="comparison">comparison</option>
                <option value="query">query</option>
              </select>
              <Input value={draftTags} onChange={(e) => setDraftTags(e.target.value)} placeholder="tags (comma separated)" />
            </div>
            <Textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} className="min-h-[220px]" />
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={createPage} disabled={loading || !draftTitle.trim() || !draftPath.trim()}>
                Save
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mt-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, tags, path…" />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-10 rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--app-text)]"
          >
            <option value="">All types</option>
            <option value="entity">entity</option>
            <option value="concept">concept</option>
            <option value="comparison">comparison</option>
            <option value="query">query</option>
          </select>
        </div>
        <div className="text-xs text-slate-500">{filtered.length} pages</div>
      </div>

      {err ? <div className="mt-3 text-xs text-red-300">{err}</div> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {filtered.map((p) => (
          <Card key={p.path}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-lg font-medium">{p.title || p.path}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{p.path}</div>
                <div className="mt-2 text-xs text-slate-600">
                  Type: {p.type || "unknown"} · Updated: {p.updated || "—"}
                </div>
                {p.tags && p.tags.length ? <div className="mt-2 text-xs text-slate-500">Tags: {p.tags.join(", ")}</div> : null}
              </div>
              <div className="flex flex-col gap-2">
                <Link href={`/wiki/files/${encodeURIComponent(p.path)}`}>
                  <Button variant="secondary">Open</Button>
                </Link>
                <Button variant="ghost" onClick={() => deletePage(p.path)} disabled={loading}>
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {!filtered.length ? <div className="text-sm text-slate-600">No pages yet.</div> : null}
      </div>

      {loading ? <div className="mt-6 text-sm text-slate-600">Loading…</div> : null}
    </div>
  );
}

