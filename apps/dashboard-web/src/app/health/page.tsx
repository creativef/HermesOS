"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiGet } from "@/lib/http";

export default function HealthPage() {
  const [api, setApi] = useState<any>(null);
  const [hermes, setHermes] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiGet("/api/v1/health", { auth: false });
        setApi(r);
      } catch (e) {
        setApi({ err: String(e) });
      }

      try {
        const r = await apiGet("/api/v1/hermes/health", { auth: false });
        setHermes(r);
      } catch (e) {
        setHermes({ err: String(e) });
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Health</h1>
        <Link href="/">
          <Button variant="secondary">Back</Button>
        </Link>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <div className="text-sm text-slate-600">Dashboard API</div>
          <pre className="mt-4 rounded-lg bg-slate-50 p-4 text-xs text-slate-800">{JSON.stringify(api, null, 2)}</pre>
        </Card>
        <Card>
          <div className="text-sm text-slate-600">Hermes</div>
          <pre className="mt-4 rounded-lg bg-slate-50 p-4 text-xs text-slate-800">{JSON.stringify(hermes, null, 2)}</pre>
        </Card>
      </div>
    </div>
  );
}
