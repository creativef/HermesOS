"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function WikiPage() {
  const url = (process.env.NEXT_PUBLIC_WIKI_URL || "http://localhost:5001").replace(/\/$/, "");

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm text-slate-600">Knowledge</div>
          <h1 className="mt-1 text-2xl font-semibold">LLM Wiki</h1>
          <div className="mt-1 text-xs text-slate-500">Browse the Hermes wiki knowledge base.</div>
        </div>
        <div className="flex items-center gap-2">
          <a href={url} target="_blank" rel="noreferrer">
            <Button variant="secondary">Open in new tab</Button>
          </a>
          <Link href="/">
            <Button variant="secondary">Back</Button>
          </Link>
        </div>
      </header>

      <Separator className="my-8" />

      <Card>
        <div className="h-[78vh] overflow-hidden rounded-xl border border-[color:var(--input-border)] bg-[color:var(--surface)]">
          <iframe title="LLM Wiki" src={url} className="h-full w-full" />
        </div>
      </Card>
    </div>
  );
}

