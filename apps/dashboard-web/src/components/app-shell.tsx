"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getApiKey, setApiKey } from "@/lib/auth";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/http";
import { getSelectedCompanyId, getSelectedProjectId, setSelectedCompanyId, setSelectedProjectId } from "@/lib/workspace";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { HelpTip } from "@/components/help-tip";
import { ToastProvider } from "@/components/ui/toast";

type Company = { id: string; name: string; slug: string };
type Project = { id: string; name: string; slug: string; companyId: string | null };

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [apiKey, setApiKeyState] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [companyId, setCompanyIdState] = useState("");
  const [projectId, setProjectIdState] = useState("");
  const [loading, setLoading] = useState(false);

  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
  const [createCompanyName, setCreateCompanyName] = useState("");
  const [createCompanyBrief, setCreateCompanyBrief] = useState("");
  const [createCompanyErr, setCreateCompanyErr] = useState<string | null>(null);

  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState("");
  const [createProjectBrief, setCreateProjectBrief] = useState("");
  const [createProjectCompanyId, setCreateProjectCompanyId] = useState<string | null>(null);
  const [createProjectErr, setCreateProjectErr] = useState<string | null>(null);

  const [editCompanyOpen, setEditCompanyOpen] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editCompanySlug, setEditCompanySlug] = useState("");
  const [editCompanyBrief, setEditCompanyBrief] = useState("");
  const [editCompanyErr, setEditCompanyErr] = useState<string | null>(null);

  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectSlug, setEditProjectSlug] = useState("");
  const [editProjectCompanyId, setEditProjectCompanyId] = useState<string | null>(null);
  const [editProjectBrief, setEditProjectBrief] = useState("");
  const [editProjectErr, setEditProjectErr] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    if (!companyId) return projects;
    return projects.filter((p) => p.companyId === companyId);
  }, [projects, companyId]);

  async function refreshWorkspace() {
    setLoading(true);
    try {
      const [cs, ps] = await Promise.all([
        apiGet<Company[]>("/api/v1/companies"),
        apiGet<{ ok: boolean; projects: Project[] }>("/api/v1/projects"),
      ]);
      setCompanies(cs || []);
      setProjects(ps.projects || []);
    } finally {
      setLoading(false);
    }
  }

  async function createCompanyFlow() {
    const name = createCompanyName.trim();
    if (!name) return;
    setLoading(true);
    setCreateCompanyErr(null);
    try {
      const slug = slugify(name);
      const company = await apiPost<{ id: string; name: string; slug: string }>("/api/v1/companies", { name, slug });
      const newCompanyId = company.id;

      const brief = createCompanyBrief.trim();
      if (brief) {
        await apiPut(`/api/v1/companies/${encodeURIComponent(newCompanyId)}/brief`, { body: brief });
      }

      await refreshWorkspace();
      setCompanyIdState(newCompanyId);
      setSelectedCompanyId(newCompanyId);
      // Reset project when company changes.
      setProjectIdState("");
      setSelectedProjectId("");

      setCreateCompanyName("");
      setCreateCompanyBrief("");
      setCreateCompanyOpen(false);
    } catch (e) {
      setCreateCompanyErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function createProjectFlow() {
    const name = createProjectName.trim();
    if (!name) return;
    setLoading(true);
    setCreateProjectErr(null);
    try {
      const created = await apiPost<{ ok: boolean; project: Project }>("/api/v1/projects", {
        name,
        companyId: createProjectCompanyId ?? null,
      });
      const newProjectId = created.project.id;
      const brief = createProjectBrief.trim();
      if (brief) {
        await apiPut(`/api/v1/projects/${encodeURIComponent(newProjectId)}/brief`, { body: brief });
      }

      await refreshWorkspace();
      setProjectIdState(newProjectId);
      setSelectedProjectId(newProjectId);

      setCreateProjectName("");
      setCreateProjectBrief("");
      setCreateProjectCompanyId(null);
      setCreateProjectOpen(false);
    } catch (e) {
      setCreateProjectErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function openEditCompany() {
    if (!companyId) return;
    const c = companies.find((x) => x.id === companyId);
    if (!c) return;
    setLoading(true);
    setEditCompanyErr(null);
    try {
      const r = await apiGet<{ ok: boolean; artifact: { body: string } | null }>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/brief`
      );
      const brief = r.artifact?.body || "";
      setEditCompanyName(c.name || "");
      setEditCompanySlug(c.slug || "");
      setEditCompanyBrief(brief);
      setEditCompanyOpen(true);
    } catch (e) {
      setEditCompanyErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveCompanyDetails() {
    if (!companyId) return;
    setLoading(true);
    setEditCompanyErr(null);
    try {
      const r = await apiPatch<{ ok: boolean; company: Company }>(`/api/v1/companies/${encodeURIComponent(companyId)}`, {
        name: editCompanyName.trim(),
        slug: editCompanySlug.trim(),
      });
      // Brief is stored separately as a context artifact.
      await apiPut(`/api/v1/companies/${encodeURIComponent(companyId)}/brief`, { body: editCompanyBrief });
      await refreshWorkspace();
      // Ensure selection still points at updated record.
      setCompanyIdState(r.company.id);
      setSelectedCompanyId(r.company.id);
      setEditCompanyOpen(false);
    } catch (e) {
      setEditCompanyErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteCompany() {
    if (!companyId) return;
    const c = companies.find((x) => x.id === companyId);
    const label = c ? c.name : companyId;
    if (!window.confirm(`Delete company "${label}"? Projects will remain but will be unassigned.`)) return;

    setLoading(true);
    setEditCompanyErr(null);
    try {
      await apiDelete(`/api/v1/companies/${encodeURIComponent(companyId)}`);
      await refreshWorkspace();
      setCompanyIdState("");
      setSelectedCompanyId("");
      setProjectIdState("");
      setSelectedProjectId("");
      setEditCompanyOpen(false);
    } catch (e) {
      setEditCompanyErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadProjectBrief(nextProjectId: string) {
    if (!nextProjectId) return "";
    const r = await apiGet<{ ok: boolean; artifact: { body: string } | null }>(
      `/api/v1/projects/${encodeURIComponent(nextProjectId)}/brief`
    );
    return r.artifact?.body || "";
  }

  async function openEditProject() {
    if (!projectId) return;
    const p = projects.find((x) => x.id === projectId);
    if (!p) return;
    setEditProjectErr(null);
    setEditProjectName(p.name || "");
    setEditProjectSlug(p.slug || "");
    setEditProjectCompanyId(p.companyId ?? null);
    try {
      setEditProjectBrief(await loadProjectBrief(p.id));
    } catch (e) {
      setEditProjectBrief("");
      setEditProjectErr(String(e));
    }
    setEditProjectOpen(true);
  }

  async function saveProjectDetails() {
    if (!projectId) return;
    setLoading(true);
    setEditProjectErr(null);
    try {
      const r = await apiPatch<{ ok: boolean; project: Project }>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
        name: editProjectName.trim(),
        slug: editProjectSlug.trim(),
        companyId: editProjectCompanyId,
      });
      await apiPut(`/api/v1/projects/${encodeURIComponent(projectId)}/brief`, { body: editProjectBrief });
      await refreshWorkspace();
      setProjectIdState(r.project.id);
      setSelectedProjectId(r.project.id);
      setEditProjectOpen(false);
    } catch (e) {
      setEditProjectErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteProject(force: boolean) {
    if (!projectId) return;
    const p = projects.find((x) => x.id === projectId);
    const label = p ? p.name : projectId;
    const prompt = force
      ? `Delete project "${label}" and ALL its sessions/events/jobs? This cannot be undone.`
      : `Delete project "${label}"? (Will fail if it has sessions unless you use Force delete.)`;
    if (!window.confirm(prompt)) return;

    setLoading(true);
    setEditProjectErr(null);
    try {
      const suffix = force ? "?force=1" : "";
      await apiDelete(`/api/v1/projects/${encodeURIComponent(projectId)}${suffix}`);
      await refreshWorkspace();
      setProjectIdState("");
      setSelectedProjectId("");
      setEditProjectOpen(false);
    } catch (e) {
      setEditProjectErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const k = getApiKey();
    setApiKeyState(k);
    setCompanyIdState(getSelectedCompanyId());
    setProjectIdState(getSelectedProjectId());
    if (k) refreshWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ToastProvider>
      <div className="min-h-screen">
        <div className="flex min-h-screen">
        <aside className="hidden w-[320px] shrink-0 border-r border-[color:var(--border)] bg-[color:var(--surface)] p-5 md:block">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-[color:var(--muted)]">Hermes Workspace</div>
              <div className="mt-1 text-lg font-semibold">Dashboard</div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeSwitcher />
              <Link href="/health">
                <Button variant="secondary" size="sm">
                  Health
                </Button>
              </Link>
            </div>
          </div>

          <Separator className="my-5" />

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-[color:var(--muted)]">Company</div>
                  <HelpTip side="right" text="Companies group projects. Pick one to scope the project list and overview." />
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={!apiKey || !companyId} onClick={openEditCompany}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!apiKey}
                    onClick={async () => {
                      setCreateCompanyErr(null);
                      setCreateCompanyName("");
                      setCreateCompanyBrief("");
                      setCreateCompanyOpen(true);
                    }}
                  >
                    Create
                  </Button>
                </div>
              </div>
              <select
                className="mt-2 h-10 w-full rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--app-text)]"
                value={companyId}
                onChange={(e) => {
                  const next = e.target.value;
                  setCompanyIdState(next);
                  setSelectedCompanyId(next);
                  // Reset project when company changes.
                  setProjectIdState("");
                  setSelectedProjectId("");
                }}
                disabled={!apiKey}
              >
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-[color:var(--muted)]">Project</div>
                  <HelpTip side="right" text="Projects contain sessions, messages, and project-level context (briefs/files later)." />
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={!apiKey || !projectId} onClick={openEditProject}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!apiKey}
                    onClick={async () => {
                      setCreateProjectErr(null);
                      setCreateProjectName("");
                      setCreateProjectBrief("");
                      // Default to currently selected company if any.
                      setCreateProjectCompanyId(companyId || null);
                      setCreateProjectOpen(true);
                    }}
                  >
                    Create
                  </Button>
                </div>
              </div>
              <select
                className="mt-2 h-10 w-full rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--app-text)]"
                value={projectId}
                onChange={(e) => {
                  const next = e.target.value;
                  setProjectIdState(next);
                  setSelectedProjectId(next);
                }}
                disabled={!apiKey}
              >
                <option value="">All projects</option>
                {filteredProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {projectId ? (
                <div className="mt-2">
                  <Link href={`/projects/${encodeURIComponent(projectId)}`}>
                    <Button variant="secondary" size="sm">
                      Open project
                    </Button>
                  </Link>
                </div>
              ) : null}
            </div>
          </div>

          <Separator className="my-5" />

          <div className="space-y-2">
            <div className="text-xs text-[color:var(--muted)]">Navigate</div>
            <div className="grid gap-2">
              <Link href="/">
                <Button variant="secondary" className="w-full justify-start">
                  Overview
                </Button>
              </Link>
              <Link href="/projects">
                <Button variant="ghost" className="w-full justify-start">
                  Companies & projects
                </Button>
              </Link>
              <Link href="/issues">
                <Button variant="ghost" className="w-full justify-start">
                  Issues
                </Button>
              </Link>
              <Link href="/wiki">
                <Button variant="ghost" className="w-full justify-start">
                  Wiki
                </Button>
              </Link>
            </div>
          </div>
        </aside>

        <Dialog open={createCompanyOpen} onOpenChange={setCreateCompanyOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create company</DialogTitle>
              <DialogDescription>Consolidated flow: create the company and optionally set its brief.</DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-3">
              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Company name</div>
                <Input
                  value={createCompanyName}
                  onChange={(e) => setCreateCompanyName(e.target.value)}
                  placeholder="e.g. Condense Inc"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Company brief (optional)</div>
                <Textarea
                  value={createCompanyBrief}
                  onChange={(e) => setCreateCompanyBrief(e.target.value)}
                  placeholder="What does this company do? Operating rules, tone, constraints, priorities…"
                />
              </div>

              {createCompanyErr ? <div className="text-xs text-red-300">{createCompanyErr}</div> : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setCreateCompanyOpen(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button onClick={createCompanyFlow} disabled={!apiKey || loading || createCompanyName.trim().length === 0}>
                  Create
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={editCompanyOpen} onOpenChange={setEditCompanyOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit company</DialogTitle>
              <DialogDescription>Update company name, slug, and brief.</DialogDescription>
            </DialogHeader>
            <div className="mt-5 space-y-3">
              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Company name</div>
                <Input value={editCompanyName} onChange={(e) => setEditCompanyName(e.target.value)} placeholder="Company name" autoFocus />
              </div>
              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Slug</div>
                <Input value={editCompanySlug} onChange={(e) => setEditCompanySlug(e.target.value)} placeholder="company-slug" />
              </div>
              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Brief</div>
                <Textarea
                  value={editCompanyBrief}
                  onChange={(e) => setEditCompanyBrief(e.target.value)}
                  placeholder="Company summary, operating rules, preferred tone, constraints…"
                />
              </div>
              {editCompanyErr ? <div className="text-xs text-red-300">{editCompanyErr}</div> : null}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={deleteCompany} disabled={!apiKey || loading}>
                  Delete
                </Button>
                <Button variant="ghost" onClick={() => setEditCompanyOpen(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button onClick={saveCompanyDetails} disabled={!apiKey || loading || editCompanyName.trim().length === 0}>
                  Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription>Consolidated flow: create the project and optionally set its brief.</DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-3">
              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Project name</div>
                <Input
                  value={createProjectName}
                  onChange={(e) => setCreateProjectName(e.target.value)}
                  placeholder="e.g. YTFC Content Engine"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Company (optional)</div>
                <select
                  className="h-10 w-full rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--app-text)]"
                  value={createProjectCompanyId || ""}
                  onChange={(e) => setCreateProjectCompanyId(e.target.value ? e.target.value : null)}
                >
                  <option value="">No company</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="text-[11px] text-[color:var(--muted-2)]">Defaults to the company currently selected in the sidebar.</div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Project brief (optional)</div>
                <Textarea
                  value={createProjectBrief}
                  onChange={(e) => setCreateProjectBrief(e.target.value)}
                  placeholder="Goals, constraints, expected outputs, tone…"
                />
              </div>

              {createProjectErr ? <div className="text-xs text-red-300">{createProjectErr}</div> : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setCreateProjectOpen(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button onClick={createProjectFlow} disabled={!apiKey || loading || createProjectName.trim().length === 0}>
                  Create
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={editProjectOpen} onOpenChange={setEditProjectOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit project</DialogTitle>
              <DialogDescription>Update project details, brief, and (optionally) reassign it to a company.</DialogDescription>
            </DialogHeader>
            <div className="mt-5 space-y-3">
              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Project name</div>
                <Input value={editProjectName} onChange={(e) => setEditProjectName(e.target.value)} placeholder="Project name" autoFocus />
              </div>
              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Slug</div>
                <Input value={editProjectSlug} onChange={(e) => setEditProjectSlug(e.target.value)} placeholder="project-slug" />
              </div>
              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Company</div>
                <select
                  className="h-10 w-full rounded-md border border-[color:var(--input-border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--app-text)]"
                  value={editProjectCompanyId || ""}
                  onChange={(e) => setEditProjectCompanyId(e.target.value ? e.target.value : null)}
                >
                  <option value="">No company</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <div className="text-xs text-[color:var(--muted)]">Brief</div>
                <Textarea
                  value={editProjectBrief}
                  onChange={(e) => setEditProjectBrief(e.target.value)}
                  placeholder="Project goals, constraints, expected outputs, tone…"
                />
              </div>
              {editProjectErr ? <div className="text-xs text-red-300">{editProjectErr}</div> : null}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => deleteProject(false)} disabled={!apiKey || loading}>
                  Delete
                </Button>
                <Button variant="secondary" onClick={() => deleteProject(true)} disabled={!apiKey || loading}>
                  Force delete
                </Button>
                <Button variant="ghost" onClick={() => setEditProjectOpen(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button onClick={saveProjectDetails} disabled={!apiKey || loading || editProjectName.trim().length === 0}>
                  Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <main className="flex-1">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
