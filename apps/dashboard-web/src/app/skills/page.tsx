"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { apiGet } from "@/lib/http";
import { useToast } from "@/components/ui/toast";

type Skill = {
  id: string;
  root: string;
  rel: string;
  name: string;
  description: string;
  bytes?: number | null;
  updatedAt?: string | null;
};

function slugFromName(name: string) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function SkillsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Skill | null>(null);
  const [content, setContent] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; skills: Skill[] }>("/api/v1/skills");
      setSkills(r.skills || []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function openSkill(s: Skill) {
    setSelected(s);
    setContent("");
    setLoading(true);
    setErr(null);
    try {
      const r = await apiGet<{ ok: boolean; content: string }>(`/api/v1/skills/content?id=${encodeURIComponent(s.id)}`);
      setContent(r.content || "");
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
    if (!qq) return skills;
    return skills.filter((s) => {
      const hay = `${s.name} ${s.description} ${s.rel}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [skills, q]);

  function copyInvoke(s: Skill) {
    const slug = slugFromName(s.name);
    const cmd = slug ? `/${slug}` : "/<skill>";
    try {
      navigator.clipboard.writeText(cmd);
      toast({ title: "Copied", description: cmd });
    } catch {
      toast({ title: "Copy failed", description: cmd });
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm text-slate-600">Tools</div>
          <h1 className="mt-1 text-2xl font-semibold">Skills</h1>
          <div className="mt-1 text-xs text-slate-500">Browse installed `SKILL.md` files mounted into the API container.</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="secondary">Back</Button>
          </Link>
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </header>

      <Separator className="my-8" />

      {err ? <div className="mb-4 text-xs text-red-300">{err}</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="min-w-0 md:col-span-1">
          <div className="text-sm text-slate-600">Search</div>
          <div className="mt-3 grid gap-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, description…" />
            <div className="text-xs text-slate-500">{filtered.length} skills</div>
          </div>
          <div className="mt-5 grid gap-2">
            {filtered.slice(0, 80).map((s) => (
              <button
                key={s.id}
                onClick={() => openSkill(s)}
                className={`w-full min-w-0 max-w-full overflow-hidden rounded-md border px-3 py-2 text-left ${
                  selected?.id === s.id ? "border-slate-400 bg-slate-50" : "border-[color:var(--border)]"
                }`}
              >
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="mt-0.5 break-words text-xs leading-snug text-slate-500">
                  {s.description || s.rel}
                </div>
              </button>
            ))}
            {filtered.length > 80 ? <div className="text-xs text-slate-500">Showing first 80 results.</div> : null}
            {!filtered.length ? <div className="text-sm text-slate-600">No skills found.</div> : null}
          </div>
        </Card>

        <Card className="min-w-0 md:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-slate-600">Details</div>
              <div className="mt-1 truncate text-lg font-semibold">{selected ? selected.name : "Select a skill"}</div>
              {selected ? <div className="mt-1 truncate text-xs text-slate-500">{selected.rel}</div> : null}
            </div>
            {selected ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" onClick={() => copyInvoke(selected)}>
                  Copy invoke
                </Button>
              </div>
            ) : null}
          </div>

          {selected ? (
            <div className="mt-4 grid gap-2 text-xs text-slate-600">
              {selected.description ? <div>{selected.description}</div> : null}
              <div className="text-slate-500">
                {selected.updatedAt ? `Updated: ${new Date(selected.updatedAt).toLocaleString()}` : "Updated: —"}{" "}
                {selected.bytes != null ? `· ${selected.bytes} bytes` : ""}
              </div>
            </div>
          ) : null}

          <Separator className="my-5" />

          {selected ? (
            content ? (
              <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-xs text-slate-800">
                {content}
              </pre>
            ) : (
              <div className="text-sm text-slate-600">{loading ? "Loading…" : "No content loaded."}</div>
            )
          ) : (
            <div className="text-sm text-slate-600">Pick a skill on the left to view its `SKILL.md`.</div>
          )}
        </Card>
      </div>

      {loading ? <div className="mt-6 text-sm text-slate-600">Loading…</div> : null}
    </div>
  );
}
