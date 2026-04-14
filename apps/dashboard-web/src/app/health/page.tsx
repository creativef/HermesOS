"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function HealthPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/doctor");
  }, [router]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Health</h1>
        <Link href="/doctor">
          <Button variant="secondary">Go to Doctor</Button>
        </Link>
      </div>
      <Card className="mt-6">
        <div className="text-sm text-slate-700">Moved to the Doctor page.</div>
      </Card>
    </div>
  );
}
