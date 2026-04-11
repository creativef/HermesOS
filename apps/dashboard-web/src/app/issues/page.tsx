"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function IssuesPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-slate-600">Workspace</div>
          <h1 className="mt-1 text-2xl font-semibold">Issues</h1>
        </div>
        <Link href="/">
          <Button variant="secondary">Back</Button>
        </Link>
      </div>
      <Card className="mt-6">
        <div className="text-sm text-slate-700">
          This view is scaffolded. Next iteration: connect it to real “issues” (e.g., stalled sessions, error events, failed Hermes calls,
          or project blockers).
        </div>
      </Card>
    </div>
  );
}
