"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPut } from "@/lib/http";
import { useToast } from "@/components/ui/toast";

type WikiPage = {
  path: string;
  meta: any;
  body: string;
  content: string;
};

export default function WikiViewPage() {
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams<{ path: string[] }>();
  const pathParts = params.path || [];
  const pagePath = useMemo(() => pathParts.map(decodeURIComponent).join("/"), [pathParts]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState<WikiPage | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftType, setDraftType] = useState("concept");
  const [draftTags, setDraftTags] = useState("");
  const [draftBody, setDraftBody] = useState("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; path: string; meta: any; body: string; content: string }>(
        `/api/v1/wiki/page?path=${encodeURIComponent(pagePath)}`
      );
      const next: WikiPage = { path: r.path, meta: r.meta, body: r.body || "", content: r.content || "" };
      setPage(next);
      const title = typeof r.meta?.title === "string" ? r.meta.title : "";
      const type = typeof r.meta?.type === "string" ? r.meta.type : "concept";
      const tags = Array.isArray(r.meta?.tags) ? r.meta.tags.join(", ") : "";
      setDraftTitle(title);
      setDraftType(type);
      setDraftTags(tags);
      setDraftBody(next.body);
    } catch (e) {
      setErr(String(e));
      setPage(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagePath]);

  async function save() {
    setLoading(true);
    setErr(null);
    try {
      await apiPut("/api/v1/wiki/page", {
        path: pagePath,
        title: draftTitle.trim(),
        type: draftType,
        tags: draftTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        body: draftBody,
      });
      toast({ title: "Saved", description: pagePath });
      setEditOpen(false);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteThis() {
    if (!window.confirm(`Delete "${pagePath}"?`)) return;
    setLoading(true);
    setErr(null);
    try {
      await apiDelete(`/api/v1/wiki/page?path=${encodeURIComponent(pagePath)}`);
      toast({ title: "Deleted", description: pagePath });
      router.push("/wiki");
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const title = (page?.meta?.title as string) || pagePath;
  const updated = page?.meta?.updated ? String(page.meta.updated) : "";
  const tags = Array.isArray(page?.meta?.tags) ? page?.meta?.tags : [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-slate-600">Wiki page</div>
          <h1 className="mt-1 truncate text-2xl font-semibold">{title}</h1>
          <div className="mt-1 truncate text-xs text-slate-500">{pagePath}</div>
          {updated ? <div className="mt-1 text-xs text-slate-500">Updated: {updated}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setEditOpen((v) => !v)}>{editOpen ? "Close" : "Edit"}</Button>
          <Button variant="ghost" onClick={deleteThis} disabled={loading}>
            Delete
          </Button>
          <Link href="/wiki">
            <Button variant="secondary">Back</Button>
          </Link>
        </div>
      </header>

      <Separator className="my-8" />

      {err ? <div className="mb-4 text-xs text-red-300">{err}</div> : null}

      {editOpen ? (
        <Card>
          <div className="text-sm text-slate-600">Edit page</div>
          <div className="mt-3 grid gap-3">
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
            <Textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} className="min-h-[360px]" />
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={save} disabled={loading || !draftTitle.trim()}>
                Save
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        {tags.length ? <div className="text-xs text-slate-500">Tags: {tags.join(", ")}</div> : null}
        <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs text-slate-800">{page?.body || ""}</pre>
      </Card>

      {loading ? <div className="mt-6 text-sm text-slate-600">Loading…</div> : null}
    </div>
  );
}

